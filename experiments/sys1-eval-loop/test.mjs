import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {digest,loadInput,validateCases,validateCandidate,requestFor,evaluate,score,compare} from './run.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const input=loadInput(path.join(root,'candidates/baseline.json'));
const goldText=fs.readFileSync(path.join(root,'expected.jsonl'),'utf8');
const gold=goldText.trim().split('\n').map(JSON.parse);
const clone=structuredClone;
const fake=(labels=gold.map(g=>g.label))=>{
  let i=0;return async ()=>({label:labels[i++],model:'synthetic-double',usage:null});
};
const make=async()=>score(input,gold,await evaluate(input,fake()));

test('fixed corpus and Gold match preregistered digests',()=>{
  assert.equal(input.cases.length,8);assert.equal(digest(goldText),input.contract.goldSha256);
  assert.equal(input.contract.maxTotalCalls,16);assert.equal(input.contract.goldOrigin.authorIndependent,false);
});
test('request contains no ID, expected label, basis or scorer metadata',()=>{
  for (const c of input.cases) {
    const r=requestFor(c,input.candidate,input.contract), state=JSON.parse(r.text);
    assert.deepEqual(Object.keys(state).sort(),['body','comments','complete','purpose']);
    assert.equal(r.text.includes(c.id),false);
    for(const g of gold) assert.equal(r.text.includes(g.basis),false);
  }
});
test('candidate cannot replace evaluator or inject extra executable fields',()=>{
  assert.throws(()=>validateCandidate({...input.candidate,source:'process.env'}));
  assert.throws(()=>validateCandidate({...input.candidate,instructions:''}));
});
test('missing, duplicate or extra case fields are rejected',()=>{
  const c=clone(input.cases);c[1].id=c[0].id;assert.throws(()=>validateCases(c,input.contract));
  assert.throws(()=>validateCases(input.cases.slice(1),input.contract));
  assert.throws(()=>validateCases(input.cases.map(x=>({...x,expected:'ok'})),input.contract));
});
test('test doubles are labeled and never evidence of live quality',async()=>{
  const r=await make();assert.equal(r.mode,'test-double');assert.equal(r.correct,8);
  assert.equal(r.targetReached,true);assert.equal(r.qualityAdoptionAuthorized,false);
  assert.throws(()=>compare(r,r),/INCOMPLETE_OR_MOCK/);
});
test('candidate failures stop remaining calls and keep denominator',async()=>{
  let count=0;const p=await evaluate(input,async()=>{count++;throw new Error('SECRET_DO_NOT_PRINT');});
  assert.equal(count,1);assert.equal(p.rows.length,8);assert.equal(p.rows.filter(x=>x.status==='not_run').length,7);
  assert.equal(JSON.stringify(p).includes('SECRET_DO_NOT_PRINT'),false);
  const s=score(input,gold,p);assert.equal(s.accuracy,null);assert.equal(s.errors,8);assert.equal(s.targetReached,false);
});
test('unsupported label is not scored as success',async()=>{
  const p=await evaluate(input,async()=>({label:'invented',model:'double'}));
  assert.equal(p.rows[0].status,'error');assert.equal(score(input,gold,p).status,'STOP_EVALUATION_ERROR');
});
test('model drift within one evaluation blocks quality result',async()=>{
  let i=0;const p=await evaluate(input,async()=>({label:gold[i].label,model:`m${i++}`}));
  assert.equal(score(input,gold,p).status,'STOP_EVALUATION_ERROR');
});
test('missing and duplicate predictions are rejected',async()=>{
  const p=await evaluate(input,fake());p.rows.pop();assert.throws(()=>score(input,gold,p));
  const q=await evaluate(input,fake());q.rows[1].id=q.rows[0].id;assert.throws(()=>score(input,gold,q));
});
test('changed candidate, corpus or contract invalidate result binding',async()=>{
  const p=await evaluate(input,fake());
  for(const k of ['contractDigest','casesDigest','candidateDigest']) {
    const x=clone(p);x[k]='different';assert.throws(()=>score(input,gold,x));
  }
});
test('changed model request is not accepted by scorer',async()=>{
  const p=await evaluate(input,fake());p.rows[0].request.instructions='different';
  assert.throws(()=>score(input,gold,p));
});
test('missing and malformed Gold rejected',async()=>{
  const p=await evaluate(input,fake());assert.throws(()=>score(input,gold.slice(1),p));
  const g=clone(gold);g[0].label='invented';assert.throws(()=>score(input,g,p));
});
test('false positives and false negatives tracked separately',async()=>{
  const labels=gold.map(g=>g.label);labels[0]='body_observation';labels[1]='ok';
  const s=score(input,gold,await evaluate(input,fake(labels)));
  assert.equal(s.correct,6);assert.equal(s.falsePositives,1);assert.equal(s.falseNegatives,1);
});
test('paired comparison reports benefit, no effect, harm, and rejects drift',async()=>{
  // Deliberately constructed reports test arithmetic only, never live evidence.
  const good=await make();good.mode='live';const bad=clone(good);
  bad.rows[0].correct=false;bad.rows[0].prediction='body_observation';bad.correct=7;bad.candidateDigest='synthetic-bad';
  assert.equal(compare(bad,good).outcome,'EFFECT_OBSERVED');
  assert.equal(compare(good,good).outcome,'NO_EFFECT_OBSERVED');
  assert.equal(compare(good,bad).outcome,'HARM_OBSERVED');
  assert.deepEqual(compare(good,bad).regressed,[input.cases[0].id]);
  for(const k of ['contractDigest','casesDigest','goldDigest']) {
    const x=clone(good);x[k]='other';assert.throws(()=>compare(good,x));
  }
  const x=clone(good);x.models=['changed'];assert.throws(()=>compare(good,x),/MODEL_CHANGED/);
});
test('no key produces a zero-call blocked report without importing provider',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sys1-no-key-'));
  try {
    const env={...process.env};delete env.JEV_API_KEY;delete env.GITHUB_RUN_ATTEMPT;
    const r=spawnSync(process.execPath,[path.join(root,'run.mjs'),'evaluate','baseline',dir],{env,encoding:'utf8'});
    assert.equal(r.status,2);
    const p=JSON.parse(fs.readFileSync(path.join(dir,'predictions.json'),'utf8'));
    assert.equal(p.actualCalls,0);assert.equal(p.rows[0].error,'AUTH_MISSING');
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('a rerun is refused before any provider call',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sys1-rerun-'));
  try {
    const r=spawnSync(process.execPath,[path.join(root,'run.mjs'),'evaluate','baseline',dir],
      {env:{...process.env,GITHUB_RUN_ATTEMPT:'2'},encoding:'utf8'});
    assert.equal(r.status,2);assert.equal(fs.existsSync(path.join(dir,'predictions.json')),false);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
