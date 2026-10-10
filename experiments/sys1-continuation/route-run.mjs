import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {hash,remaining} from './progress.mjs';
import {evaluate,score} from './portable.mjs';
import {issueCore} from './cores/issue.mjs';
import {dirtreeCore} from './cores/dirtree.mjs';
import {routeCore,inputsFor,selections} from './cores/route.mjs';
const ROOT=path.dirname(fileURLToPath(import.meta.url));
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
const json=p=>JSON.parse(read(p));
const lines=s=>s.trim().split('\n').map(JSON.parse);
const candidate=json('../sys1-eval-loop/candidates/binary-eo-v3.json');
const catalog=[issueCore(candidate),dirtreeCore].map(({id,when})=>({id,when}));
const planPath=process.env.ROUTE_PLAN??'route-plan.json';
assert.match(planPath,/^route-plan(?:-v[0-9]+)?\.json$/);
const plan=json(planPath),cases=lines(read('route-cases.jsonl'));
const inputs=inputsFor(cases,catalog),identity=hash(plan);
function verify(){
  assert.equal(hash(read('route-cases.jsonl')),plan.casesDigest);
  assert.equal(hash(catalog),plan.catalogDigest);
  assert.equal(hash(read('cores/route.mjs')),plan.coreDigest);
  assert.equal(cases.length,plan.caseCount);assert.equal(catalog.length,plan.catalogCount);
  assert.equal(inputs.length,plan.maxCalls);
  const state=json('state.json');remaining(state);
  const reservation=state.runs[plan.id];
  assert.equal(reservation?.binding,identity);assert.equal(reservation?.status,'reserved');
  assert.equal(reservation?.reserved,plan.maxCalls);
}
async function main(){
  const [mode,dir]=process.argv.slice(2);
  assert.ok(['verify','evaluate','score'].includes(mode));verify();
  if(mode==='verify'){console.log('ROUTE_CONTRACT_READY '+JSON.stringify({id:plan.id,cases:cases.length,pairs:inputs.length,binding:identity}));return;}
  assert.ok(dir);fs.mkdirSync(dir,{recursive:true});
  const write=(name,x)=>fs.writeFileSync(path.join(dir,name+'.json'),JSON.stringify(x)+'\n',{flag:'wx',mode:0o600});
  if(mode==='evaluate'){
    assert.equal(process.env.GITHUB_RUN_ATTEMPT,'1');
    write('attempt',{binding:identity,source:process.env.TRIAL_SOURCE_SHA});
    const {createModel}=await import('./models/jev.mjs');
    const model=await createModel({key:process.env.JEV_API_KEY,limit:plan.maxCalls,expected:plan.expectedModel});
    const result=await evaluate(routeCore,inputs,model,{planDigest:identity,source:process.env.TRIAL_SOURCE_SHA});
    write('predictions',{schema:'ops.sys1.route-run.v1',id:plan.id,binding:identity,source:process.env.TRIAL_SOURCE_SHA,
      runId:process.env.GITHUB_RUN_ID,accounting:model.accounting(),result});
    if(!result.complete)process.exitCode=2;
  }else{
    assert.ok(!process.env.JEV_API_KEY);
    const raw=read('route-gold.jsonl');assert.equal(hash(raw),plan.goldDigest);
    const gold=lines(raw);
    assert.deepEqual(gold.map(x=>x.id),cases.map(x=>x.id));
    for(const g of gold){
      assert.ok(Array.isArray(g.selected)&&Array.isArray(g.unknown));
      const ids=[...g.selected,...g.unknown];
      assert.equal(new Set(ids).size,ids.length);assert.ok(ids.every(id=>catalog.some(c=>c.id===id)));
    }
    const expected=gold.flatMap(g=>catalog.map((c,i)=>({id:`${g.id}/${i}`,label:g.selected.includes(c.id)?'apply':g.unknown.includes(c.id)?'unknown':'skip'})));
    const p=JSON.parse(fs.readFileSync(path.join(dir,'predictions.json'),'utf8'));
    assert.equal(p.binding,identity);assert.equal(p.result.identity.planDigest,identity);
    assert.equal(p.source,process.env.TRIAL_SOURCE_SHA);assert.equal(p.result.identity.source,p.source);
    assert.equal(p.result.mode,'live');assert.equal(p.result.model,'jev-choice/'+plan.expectedModel);
    const scored=score(routeCore,inputs,expected,p.result);
    for(const r of scored.rows)for(const trace of r.traces)assert.equal(trace.model,plan.expectedModel);
    const groups=selections(cases,catalog,scored.rows).map((g,i)=>({...g,expected:gold[i],
      correct:!g.failed.length&&JSON.stringify(g.selected)===JSON.stringify(gold[i].selected)&&JSON.stringify(g.unknown)===JSON.stringify(gold[i].unknown)}));
    const setsCorrect=groups.filter(g=>g.correct).length;
    const output={...p,result:scored,groups,setsCorrect,setsTotal:cases.length,
      targetReached:scored.correct===plan.expectedPairsCorrect&&setsCorrect===plan.expectedSetsCorrect,
      independentHoldout:false,newCapabilityDiscoveryProven:false,executionAuthorized:false};
    write('scored',output);console.log('ROUTE_FULL '+JSON.stringify(output));
    console.log('ROUTE_SUMMARY '+JSON.stringify({id:p.id,source:p.source,runId:p.runId,binding:identity,accounting:p.accounting,
      pairsCorrect:scored.correct,pairsTotal:scored.total,errors:scored.errors,setsCorrect,setsTotal:cases.length,groups,
      targetReached:output.targetReached,independentHoldout:false,newCapabilityDiscoveryProven:false}));
    if(scored.errors)process.exitCode=2;
  }
}
main().catch(()=>{console.error('ROUTE_STOP: contract, reservation, credential or execution failure; no automatic retry');process.exitCode=2;});
