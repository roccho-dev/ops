import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {inputsFor,selections,routeCore} from './cores/route.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const hash=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const parseLines=s=>s.trim().split('\n').map(JSON.parse);
const evidence={
  before:JSON.parse(read('results/route-v1.json')),
  after:JSON.parse(read('results/route-v2.json')),
  plans:['route-plan.json','route-plan-v2.json'].map(p=>JSON.parse(read(p))),
  casesText:read('route-cases.jsonl'),goldText:read('route-gold.jsonl'),state:JSON.parse(read('state.json'))
};
function verify(x){
  const cases=parseLines(x.casesText),gold=parseLines(x.goldText),catalog=x.after.catalog;
  assert.deepEqual(gold.map(g=>g.id),cases.map(c=>c.id));
  const inputs=inputsFor(cases,catalog),scores=[];
  for(const [index,r] of [x.before,x.after].entries()){
    const p=x.plans[index];
    assert.equal(r.schema,'ops.sys1.route-receipt.v1');assert.equal(r.id,p.id);
    assert.equal(hash(p),r.binding);assert.equal(hash(catalog),p.catalogDigest);
    assert.equal(hash(x.casesText),p.casesDigest);assert.equal(hash(x.goldText),p.goldDigest);
    assert.equal(r.model,p.expectedModel);assert.match(r.source,/^[a-f0-9]{40}$/);
    assert.match(r.workflowCommit,/^[a-f0-9]{40}$/);
    assert.equal(r.independentHoldout,false);assert.equal(r.newCapabilityDiscoveryProven,false);
    assert.equal(r.executionAuthorized,false);assert.equal(r.accounting.cost,null);
    assert.deepEqual(r.rows.map(a=>a.id),inputs.map(a=>a.id));
    let correct=0;
    r.rows.forEach((row,i)=>{
      const expected=gold[Math.floor(i/catalog.length)],cap=catalog[i%catalog.length];
      assert.equal(new Set([...expected.selected,...expected.unknown]).size,expected.selected.length+expected.unknown.length);
      const label=expected.selected.includes(cap.id)?'apply':expected.unknown.includes(cap.id)?'unknown':'skip';
      assert.equal(row.expected,label);assert.ok(routeCore.labels.includes(row.label));
      if(row.label===label)correct++;
      for(const key of ['inputTokens','outputTokens'])assert.ok(Number.isSafeInteger(row[key])&&row[key]>=0);
    });
    const groups=selections(cases,catalog,r.rows.map(a=>({id:a.id,status:'ok',output:{label:a.label}})));
    const sets=groups.filter((g,i)=>JSON.stringify(g.selected)===JSON.stringify(gold[i].selected)&&JSON.stringify(g.unknown)===JSON.stringify(gold[i].unknown)).length;
    assert.equal(r.pairsCorrect,correct);assert.equal(r.pairsTotal,inputs.length);
    assert.equal(r.setsCorrect,sets);assert.equal(r.setsTotal,cases.length);
    assert.equal(r.targetReached,correct===p.expectedPairsCorrect&&sets===p.expectedSetsCorrect);
    assert.equal(r.accounting.calls,inputs.length);assert.equal(r.accounting.calls,p.maxCalls);
    assert.equal(r.accounting.usage.input_tokens,r.rows.reduce((n,a)=>n+a.inputTokens,0));
    assert.equal(r.accounting.usage.output_tokens,r.rows.reduce((n,a)=>n+a.outputTokens,0));
    const accounted=x.state.runs[r.id];assert.equal(accounted.status,'settled');
    assert.equal(accounted.binding,r.binding);assert.equal(accounted.actual,r.accounting.calls);
    assert.equal(accounted.receipt,`https://github.com/roccho-org/ops/actions/runs/${r.runId}/job/${r.jobId}`);
    scores.push({pairs:correct,sets});
  }
  for(const key of ['catalogDigest','casesDigest','goldDigest','expectedModel','expectedPairsCorrect','expectedSetsCorrect'])assert.equal(x.plans[0][key],x.plans[1][key]);
  const resolved=x.before.rows.filter((r,i)=>r.label!==r.expected&&x.after.rows[i].label===r.expected).map(r=>r.id);
  const regressed=x.before.rows.filter((r,i)=>r.label===r.expected&&x.after.rows[i].label!==r.expected).map(r=>r.id);
  return {scores,resolved,regressed,verificationCalls:0};
}
test('saved real route pair reconciles five fixes, no regression and consumed calls',()=>{
  const r=verify(evidence);
  assert.deepEqual(r.scores,[{pairs:11,sets:4},{pairs:16,sets:8}]);
  assert.deepEqual(r.resolved,['g81k/1','g59v/0','g24a/1','g68c/0','g68c/1']);
  assert.deepEqual(r.regressed,[]);assert.equal(r.verificationCalls,0);
});
for(const [name,change] of [
  ['missing prediction',x=>x.after.rows.pop()],
  ['hidden unknown mistake',x=>x.after.rows[12].label='apply'],
  ['changed reference',x=>x.goldText+=' '],
  ['inflated score',x=>x.before.pairsCorrect=16],
  ['unsettled spend',x=>x.state.runs[x.after.id].status='reserved'],
  ['erased calls',x=>x.after.accounting.calls=0],
  ['another model',x=>x.after.model='different'],
  ['false discovery completion',x=>x.after.newCapabilityDiscoveryProven=true],
  ['false independent quality',x=>x.after.independentHoldout=true],
  ['different run receipt',x=>x.after.runId='1']
])test('reject '+name,()=>{const x=structuredClone(evidence);change(x);assert.throws(()=>verify(x));});
