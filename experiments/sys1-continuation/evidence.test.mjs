import test from 'node:test';
import assert from 'node:assert/strict';
import {loadEvidence,verifyReceipt} from './verify.mjs';
import {remaining} from './progress.mjs';
const data=loadEvidence();
const verify=x=>verifyReceipt(x.receipt,x.plan,x.state,x.datasets);
test('retained actual receipt recomputes scores and settlement without extra calls',()=>{const r=verify(data);assert.equal(r.calls,20);assert.equal(r.remaining,remaining(data.state));assert.equal(r.modelCallsForThisVerification,0);});
for(const [name,change] of [
  ['erased mistaken prediction',x=>{x.receipt.results[0].rows[0].prediction='body_observation';}],
  ['modified corpus',x=>{x.datasets[1].inputs[0].input.goal='changed';}],
  ['incorrect consumed count',x=>{x.receipt.accounting.calls=0;}],
  ['omitted result',x=>{x.receipt.results[1].rows.pop();}],
  ['forged independent holdout',x=>{x.receipt.independentHoldout=true;}],
  ['unsettled run',x=>{x.state.runs[x.plan.id].status='reserved';}],
  ['another model claimed',x=>{x.receipt.model='different';}],
  ['stale receipt address',x=>{x.receipt.jobId=1;}]
])test('reject '+name,()=>{const x=structuredClone(data);change(x);assert.throws(()=>verify(x));});
