import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {digest,loadInput,requestFor,evaluate,score,compare} from './run.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const suite=path.join(root,'suites','role-boundaries');
const input=loadInput(path.join(root,'candidates','baseline.json'),suite);
const raw=fs.readFileSync(path.join(suite,'expected.jsonl'),'utf8');
const gold=raw.trim().split('\n').map(JSON.parse);
const response=(label)=>({label,model:input.contract.expectedModel});
const allCorrect=()=>{let i=0;return async()=>response(gold[i++].label);};

test('new suite is fixed, separately identified and not a holdout',()=>{
  assert.equal(digest(raw),input.contract.goldSha256);
  assert.equal(input.contract.caseCount,8);
  assert.equal(input.contract.holdout,'NOT_AVAILABLE');
  assert.equal(input.contract.goldOrigin.authorIndependent,false);
  assert.equal(input.contract.maxTotalCalls,16);
  assert.equal(input.contract.task,'issue-state-separation/role-boundaries-development-v2');
});
test('inputs do not expose IDs or gold basis; metadata does not reveal labels',()=>{
  for(const c of input.cases){
    const request=requestFor(c,input.candidate,input.contract);
    assert.equal(request.text.includes(c.id),false);
    assert.deepEqual(Object.keys(JSON.parse(request.text)).sort(),['body','comments','complete','purpose']);
    assert.equal(c.purpose,'task'); assert.equal(c.complete,true);
    for(const g of gold) assert.equal(request.text.includes(g.basis),false);
  }
});
test('independent suite loading does not modify observations or candidate',async()=>{
  const before=structuredClone(input); await evaluate(input,allCorrect()); assert.deepEqual(input,before);
});
test('declared model drift fails on first attempted case',async()=>{
  let calls=0;
  const p=await evaluate(input,async()=>{calls++;return {label:'ok',model:'different'};});
  assert.equal(calls,1); assert.equal(p.rows[0].error,'MODEL_CHANGED');
  assert.equal(p.rows.filter(x=>x.status==='not_run').length,7);
  const result=score(input,gold,p);assert.equal(result.accuracy,null);assert.equal(result.targetReached,false);
});
test('baseline target reached ends without forcing a candidate',async()=>{
  const s=score(input,gold,await evaluate(input,allCorrect()));
  assert.equal(s.correct,8); assert.equal(s.targetReached,true);assert.equal(s.mode,'test-double');
  assert.throws(()=>compare(s,s),/INCOMPLETE_OR_MOCK_COMPARISON/);
});
test('failure then correction reports change only on the matched contract',async()=>{
  // Constructed outputs exercise control/scoring only; no live quality claim.
  let i=0;
  const before=score(input,gold,await evaluate(input,async()=>response(i++===0?'body_observation':gold[i-1].label)));
  const candidate={...input.candidate,id:'synthetic-test',instructions:input.candidate.instructions+' test'};
  const afterInput={...input,candidate};
  const after=score(afterInput,gold,await evaluate(afterInput,allCorrect()));
  before.mode=after.mode='live';
  const result=compare(before,after);
  assert.equal(result.delta,1);assert.deepEqual(result.resolved,[input.cases[0].id]);
  assert.equal(result.best,after.candidateDigest);assert.equal(result.qualityAdoptionAuthorized,false);
});
test('equal candidates preserve old best and regressions remain visible',async()=>{
  const a=score(input,gold,await evaluate(input,allCorrect())); a.mode='live';
  const b=structuredClone(a); b.candidateDigest='test-other';
  assert.equal(compare(a,b).best,a.candidateDigest);
  b.rows[0].prediction='body_observation';b.rows[0].correct=false;b.correct=7;b.targetReached=false;
  assert.equal(compare(a,b).best,a.candidateDigest);assert.deepEqual(compare(a,b).regressed,[input.cases[0].id]);
});
test('changed suite digests refuse a historical or mixed comparison',async()=>{
  const a=score(input,gold,await evaluate(input,allCorrect()));a.mode='live';
  for(const key of ['contractDigest','casesDigest','goldDigest']){
    const b=structuredClone(a);b[key]='other';assert.throws(()=>compare(a,b),/CONTRACT_CHANGED/);
  }
});
test('altered corpus is rejected before any possible network request',()=>{
  const d=fs.mkdtempSync(path.join(os.tmpdir(),'sys1-suite-'));
  try{
    fs.copyFileSync(path.join(suite,'contract.json'),path.join(d,'contract.json'));
    fs.writeFileSync(path.join(d,'cases.jsonl'),JSON.stringify(input.cases[0])+'\n');
    assert.throws(()=>loadInput(path.join(root,'candidates','baseline.json'),d),/CORPUS_CHANGED/);
  }finally{fs.rmSync(d,{recursive:true,force:true});}
});
test('suite path traversal is rejected',()=>{
  const d=fs.mkdtempSync(path.join(os.tmpdir(),'sys1-path-'));
  try{
    const env={...process.env,TRIAL_SUITE:'../other'};delete env.JEV_API_KEY;
    const r=spawnSync(process.execPath,[path.join(root,'run.mjs'),'evaluate','baseline',d],{env,encoding:'utf8'});
    assert.equal(r.status,2);assert.equal(fs.existsSync(path.join(d,'attempt.json')),false);
  }finally{fs.rmSync(d,{recursive:true,force:true});}
});
test('same output attempt cannot run again even after an authentication failure',()=>{
  const d=fs.mkdtempSync(path.join(os.tmpdir(),'sys1-once-'));
  try{
    const env={...process.env,TRIAL_SUITE:'role-boundaries'};delete env.JEV_API_KEY;delete env.GITHUB_RUN_ATTEMPT;
    const args=[path.join(root,'run.mjs'),'evaluate','baseline',d];
    const first=spawnSync(process.execPath,args,{env,encoding:'utf8'});assert.equal(first.status,2);
    const report=fs.readFileSync(path.join(d,'predictions.json'),'utf8');
    assert.equal(JSON.parse(report).actualCalls,0);
    const second=spawnSync(process.execPath,args,{env,encoding:'utf8'});assert.equal(second.status,2);
    assert.equal(fs.readFileSync(path.join(d,'predictions.json'),'utf8'),report);
  }finally{fs.rmSync(d,{recursive:true,force:true});}
});
test('no-key separate scorer reports all unexecuted cases honestly',()=>{
  const d=fs.mkdtempSync(path.join(os.tmpdir(),'sys1-score-'));
  try{
    const env={...process.env,TRIAL_SUITE:'role-boundaries'};delete env.JEV_API_KEY;delete env.GITHUB_RUN_ATTEMPT;
    const run=(mode)=>spawnSync(process.execPath,[path.join(root,'run.mjs'),mode,'baseline',d],{env,encoding:'utf8'});
    assert.equal(run('evaluate').status,2);assert.equal(run('score').status,2);
    const s=JSON.parse(fs.readFileSync(path.join(d,'scored.json'),'utf8'));
    assert.equal(s.errors,8);assert.equal(s.actualCalls,0);assert.equal(s.accuracy,null);assert.equal(s.targetReached,false);
  }finally{fs.rmSync(d,{recursive:true,force:true});}
});
