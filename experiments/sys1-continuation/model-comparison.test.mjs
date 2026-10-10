import test from 'node:test';
import assert from 'node:assert/strict';
import {loadModelComparison,compareModels} from './compare-models.mjs';
const data=loadModelComparison();
const verify=d=>compareModels(d.base,d.other,d.otherPlan);
test('actual alternate-model results retain all quality loss and spent calls',()=>{
  const x=verify(data);assert.equal(x.exchangeExecutionVerified,true);assert.equal(x.qualityEquivalentOnTheseCases,false);
  assert.equal(x.retainBaseline,true);assert.equal(x.liveCallsInVerification,0);assert.equal(x.independentHoldout,false);
  assert.deepEqual(x.rows.map(r=>[r.baseline,r.alternate]),[[8,3],[8,4]]);
  assert.deepEqual(x.rows.map(r=>r.regressed.length),[5,4]);
});
for(const [name,change] of [
  ['different Gold',x=>x.otherPlan.suites[0].goldDigest='other'],
  ['unverified local model manifest',x=>x.other.runtime.modelDigest='missing'],
  ['inflated quality',x=>x.other.results[0].correct=8],
  ['hidden inference',x=>x.other.accounting.calls=0],
  ['unproven independent quality',x=>x.other.independentHoldout=true]
])test('reject '+name,()=>{const x=structuredClone(data);change(x);assert.throws(()=>verify(x));});
