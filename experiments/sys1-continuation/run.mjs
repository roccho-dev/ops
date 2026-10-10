import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {evaluate,score} from './portable.mjs';
import {hash,remaining} from './progress.mjs';
import {issueCore} from './cores/issue.mjs';
import {dirtreeCore} from './cores/dirtree.mjs';
const ROOT=path.dirname(fileURLToPath(import.meta.url));
const read=p=>fs.readFileSync(path.resolve(ROOT,p),'utf8');
const json=p=>JSON.parse(read(p));
const lines=p=>read(p).trim().split('\n').map(JSON.parse);
const fail=code=>{throw Error(code);};
const candidate=json('../sys1-eval-loop/candidates/binary-eo-v3.json');
const planFile=process.env.TRIAL_PLAN??'plan.json';
if(!/^[a-z][a-z0-9-]*\.json$/.test(planFile))fail('INVALID_PLAN');
const spec=json(planFile);
const state=json('state.json');
// A composition list; the evaluator/ModelPort itself contains no Core-specific branches.
const plans=[
  {core:issueCore(candidate),inputs:lines('../sys1-eval-loop/cases.jsonl').map(({id,...input})=>({id,input})),gold:'../sys1-eval-loop/expected.jsonl'},
  {core:dirtreeCore,inputs:lines('suites/dirtree-overlap/cases.jsonl'),gold:'suites/dirtree-overlap/expected.jsonl'}
];
function verify() {
  if(hash(candidate)!==spec.frozenCandidateDigest)fail('FROZEN_CANDIDATE_CHANGED');
  remaining(state);
  const r=state.runs[spec.id];
  if(!r||r.binding!==hash(spec)||r.status!=='reserved'||r.reserved!==spec.maxCalls)fail('NO_EXECUTION_RESERVATION');
  for(let i=0;i<plans.length;i++) {
    const p=plans[i],s=spec.suites[i];
    if(p.core.id!==s.core||p.inputs.length!==8||hash(p.inputs)!==s.inputsDigest)fail('INPUT_CONTRACT_CHANGED');
  }
}
async function main() {
  const [mode,outDir]=process.argv.slice(2);
  if(!['verify','evaluate','score'].includes(mode)||(!outDir&&mode!=='verify'))fail('INVALID_COMMAND');
  verify();if(mode==='verify'){console.log('RESERVATION_VERIFIED '+JSON.stringify({id:spec.id,remainingAfterReservation:remaining(state)}));return;}
  fs.mkdirSync(outDir,{recursive:true});
  const file=name=>path.join(outDir,name+'.json');
  const write=(name,v)=>fs.writeFileSync(file(name),JSON.stringify(v)+'\n',{flag:'wx',mode:0o600});
  if(mode==='evaluate') {
    if(process.env.GITHUB_RUN_ATTEMPT&&process.env.GITHUB_RUN_ATTEMPT!=='1')fail('REPLAY_REFUSED');
    write('attempt',{binding:hash(spec),source:process.env.TRIAL_SOURCE_SHA??null});
    const adapter=spec.modelAdapter??'jev';
    if(!/^[a-z][a-z0-9-]*$/.test(adapter))fail('INVALID_ADAPTER');
    const {createModel}=await import('./models/'+adapter+'.mjs');
    const model=await createModel({key:process.env.JEV_API_KEY,limit:spec.maxCalls,expected:spec.expectedModel});
    const results=[];let broken=false;
    for(const p of plans) {
      const port=broken?{...model,which:async()=>{throw Error('PREVIOUS_FAILURE');}}:model;
      const r=await evaluate(p.core,p.inputs,port,{planDigest:hash(spec),source:process.env.TRIAL_SOURCE_SHA??null});
      if(!r.complete&&r.rows.some(x=>x.status==='error'&&!['STATE_TRUNCATED','INPUT_TOO_LONG','TOO_MANY_OPTIONS','UNSUPPORTED_MODEL'].includes(x.error)))broken=true;
      results.push(r);
    }
    const accounting=model.accounting();
    write('predictions',{schema:'ops.sys1.portable-run.v1',id:spec.id,planDigest:hash(spec),
      source:process.env.TRIAL_SOURCE_SHA??null,runId:process.env.GITHUB_RUN_ID??null,
      accounting,results});
    if(broken)process.exitCode=2;
  } else {
    if(process.env.JEV_API_KEY)fail('KEY_PRESENT_IN_SCORER');
    const predictions=JSON.parse(fs.readFileSync(file('predictions'),'utf8'));
    if(predictions.planDigest!==hash(spec)||predictions.results?.length!==plans.length)fail('RESULT_BINDING_CHANGED');
    const results=plans.map((p,i)=>{
      const raw=read(p.gold);
      if(hash(raw)!==spec.suites[i].goldDigest)fail('GOLD_CHANGED');
      return score(p.core,p.inputs,raw.trim().split('\n').map(JSON.parse),predictions.results[i]);
    });
    const output={...predictions,results,allDevelopmentTargets:results.every(r=>r.targetReached),
      P3:'NOT_VERIFIED',P4:'NO_AUTONOMOUS_LOOP_PROOF',P5:'TWO_CORE_PORTABILITY_ONLY',
      crossModelComparisonIncluded:false,productionAdoption:false};
    write('scored',output);
    // Inputs here are explicitly public development cases, never holdout material.
    console.log('PORTABLE_FULL '+JSON.stringify(output));
    const brief=results.map(r=>({core:r.core,correct:r.correct,total:r.total,errors:r.errors,confusion:r.confusion,target:r.targetReached,
      rows:r.rows.map(x=>({id:x.id,status:x.status,label:x.output?.label,expected:x.expected,correct:x.correct,source:x.output?.source,subjects:x.output?.subjects}))}));
    console.log('PORTABLE_SUMMARY '+JSON.stringify({id:spec.id,source:output.source,runId:output.runId,accounting:output.accounting,
      results:brief,allDevelopmentTargets:output.allDevelopmentTargets,crossModelComparisonIncluded:false,independentHoldout:false}));
    if(results.some(r=>r.errors))process.exitCode=2;
  }
}
main().catch(()=>{console.error('CONTINUATION_STOP: contract/credential/execution failure; raw details withheld');process.exitCode=2;});
