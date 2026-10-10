import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const EXPECTED_MODEL='jev-1.13.0';
export const hasExpectation={
  yes:'本文に、実現すべき状態・必要な責務・入力と出力の対応・要件・受入条件のいずれかが宣言されている。',
  no:'本文に実現すべき状態の宣言がない。見出しの名前を除くと実施報告・観測・経緯だけである。'
};
export const hasObservation={
  yes:'本文が、実際に実施したこと・確認したこと・現時点の達成/未達/調査状況を報告している。',
  no:'本文は期待・役割・入出力の設計・条件・仮定・架空の受入例だけで、実際の観測を報告していない。'
};
export function classify(e,o) {
  if(!['yes','no'].includes(e)||!['yes','no'].includes(o)) throw Error('INVALID_ANSWER');
  return e==='yes'?(o==='yes'?'body_observation':'ok'):(o==='yes'?'expectation_missing':'unknown');
}
export function question(request, axis) {
  if(!['E','O'].includes(axis)) throw Error('INVALID_AXIS');
  return {text:request.text,criteria:axis==='E'?hasExpectation:hasObservation,
    instructions:request.instructions+'\n'+(axis==='E'
      ?'本問はEだけ：本文が実現すべき状態を一つでも宣言しているか。完成状態の表・責務・式も宣言である。Goal等の見出しだけでYesにしない。本文にそのような期待がなければNo。実施済みと書いてあるだけなら期待ではない。'
      :'本問はOだけ：本文が実際の出来事や達成状況を報告しているか。現在形の定義、完成状態の表、役割、将来条件や架空の入力例は報告ではない。実測の引用、確認済み/未確認の進捗一覧、HTMLコメント内の作業メモは報告に含める。comments配列内だけの観測は数えない。')};
}
export function projectBody(request) {
  const state=JSON.parse(request.text);
  if(typeof state.body!=='string'||!state.body.trim()) throw Error('INVALID_BODY');
  return {...request,text:JSON.stringify({body:state.body})};
}
export async function askSplit(request, askChoice, trace, {bodyOnly=false}={}) {
  const state=JSON.parse(request.text);
  // These are declared inputs, not inferences about an unseen Issue.
  if(state.purpose==='historical-record') return {label:'not_applicable',model:EXPECTED_MODEL,usage:null};
  if(state.complete===false) return {label:'unknown',model:EXPECTED_MODEL,usage:null};
  const modelRequest=bodyOnly?projectBody(request):request;
  const answers=[],usage={};
  for(const axis of ['E','O']) {
    const q=question(modelRequest,axis);
    const r=await askChoice(q);
    trace.push({axis,request:q,answer:r.label,model:r.model,usage:r.usage??null});
    if(r.model!==EXPECTED_MODEL) throw Error('MODEL_CHANGED');
    if(!['yes','no'].includes(r.label)) throw Error('INVALID_ANSWER');
    answers.push(r.label);
    for(const [k,v] of Object.entries(r.usage??{})) if(Number.isFinite(v)&&v>=0) usage[k]=(usage[k]??0)+v;
  }
  return {label:classify(...answers),model:EXPECTED_MODEL,usage};
}
export function sessionContract(original) {
  return {...original,task:original.task+'/independent-eo-session-v1',maxCallsPerCandidate:16,
    maxCandidates:4,maxTotalCalls:80,treatment:'single-choice vs independent E/O choice; same labels, cases and Gold'};
}

async function main() {
  const [mode,name,out]=process.argv.slice(2);
  if(!['evaluate','score'].includes(mode)||!['baseline','binary-eo-v1','binary-eo-v2','binary-eo-v3'].includes(name)||!out||process.argv.length!==5) throw Error('INVALID_COMMAND');
  const suiteName=process.env.TRIAL_SUITE??'role-boundaries';
  if(!['role-boundaries','original'].includes(suiteName)) throw Error('INVALID_SUITE');
  const suite=suiteName==='original'?ROOT:path.join(ROOT,'suites',suiteName);
  const core=await import('./run.mjs');
  const input=core.loadInput(path.join(ROOT,'candidates',name+'.json'),suite);
  const inheritedDigest=input.contractDigest;
  input.contract=sessionContract(input.contract);input.contractDigest=core.digest(input.contract);
  const write=(name,value)=>fs.writeFileSync(path.join(out,name),JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});
  fs.mkdirSync(out,{recursive:true});
  if(mode==='evaluate') {
    if(process.env.GITHUB_RUN_ATTEMPT&&process.env.GITHUB_RUN_ATTEMPT!=='1') throw Error('RERUN_FORBIDDEN');
    write('attempt.json',{candidate:core.digest(input.candidate),contract:input.contractDigest});
    const limit=name==='baseline'?8:16, traces=[];
    let calls=0,provider;
    const choice=async request=>{
      if(!process.env.JEV_API_KEY?.trim()) throw Error('AUTH_MISSING');
      const client=await import('../../packages/jev/src/client.mjs');
      provider??=client.bindJev({apiKey:process.env.JEV_API_KEY,fetch:(url,init)=>fetch(url,{...init,redirect:'error'})});
      let usage=null;
      const bounded={available:provider.available,post:async body=>{
        if(body.model!==input.contract.modelAlias||Buffer.byteLength(JSON.stringify(body))>24000) throw Error('INVALID_ANSWER');
        if(calls>=limit) throw Error('OVER_BUDGET');calls++;
        const d=await provider.post(body,{deadlineMs:15000});
        if(d.model!==EXPECTED_MODEL) throw Error('MODEL_CHANGED');
        if(!d.answers||Object.keys(d.answers).join()!=='live') throw Error('INVALID_ANSWER');
        const a=d.answers.live,p=a?.probabilities;
        if(!p||Math.abs(Object.values(p).reduce((n,v)=>n+v,0)-1)>1e-5||p[a.choice]<Math.max(...Object.values(p))-1e-6) throw Error('INVALID_ANSWER');
        usage=Object.fromEntries(Object.entries(d.usage??{}).filter(([k,v])=>['input_tokens','output_tokens','total_tokens'].includes(k)&&Number.isFinite(v)&&v>=0));
        return d;
      }};
      const r=await client.askJevChoice({...request,provider:bounded});
      return {label:r.choice.choice,model:r.model,usage};
    };
    const ask=async request=>{
      const trace=[];traces.push(trace);
      if(name!=='baseline') return askSplit(request,choice,trace,{bodyOnly:name==='binary-eo-v3'});
      const r=await choice(request);trace.push({axis:'single',request,answer:r.label,model:r.model,usage:r.usage});return r;
    };
    const p=await core.evaluate(input,ask,{mode:'live',sourceSha:process.env.TRIAL_SOURCE_SHA??null,
      runUrl:process.env.GITHUB_RUN_ID?`https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`:null});
    p.actualCalls=calls;p.inheritedContractDigest=inheritedDigest;
    p.projection='request is Core-level intent; modelTrace is the actual model requests';
    p.rows.forEach((r,i)=>{r.modelTrace=traces[i]??[];});
    write('predictions.json',p);
    if(p.rows.some(r=>r.status!=='ok')) process.exitCode=2;
  } else {
    if(process.env.JEV_API_KEY) throw Error('KEY_PRESENT_IN_SCORER');
    const raw=fs.readFileSync(path.join(suite,'expected.jsonl'),'utf8');
    if(core.digest(raw)!==input.contract.goldSha256) throw Error('GOLD_CHANGED');
    const predictions=JSON.parse(fs.readFileSync(path.join(out,'predictions.json'),'utf8'));
    if(predictions.inheritedContractDigest!==inheritedDigest) throw Error('CONTRACT_CHANGED');
    const result=core.score(input,raw.trim().split('\n').map(JSON.parse),predictions);
    result.inheritedContractDigest=inheritedDigest;
    result.treatment=name==='baseline'?'single-choice':name==='binary-eo-v3'?'body-only-independent-E/O-choice':'independent-E/O-choice';
    result.accounting={expectedMaxCalls:name==='baseline'?8:16,sessionMaxCalls:80,cost:null};
    write('scored.json',result);console.log('SYS1_EVAL_RESULT '+JSON.stringify(result));
    if(process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT,`target=${result.targetReached}\n`);
    if(result.status!=='EVALUATED') process.exitCode=2;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) main().catch(()=>{
  console.error('SYS1_SPLIT_STOP: contract/auth/model/transport error; no raw exception or automatic retry');process.exitCode=2;
});
