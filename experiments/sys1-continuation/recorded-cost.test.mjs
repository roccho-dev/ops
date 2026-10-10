import test from 'node:test';
import assert from 'node:assert/strict';
import {openTrial,transition} from './one-target.mjs';
const spec=()=>({id:'synthetic-total-cost-contract',world:{id:'synthetic-world',version:'v0',scope:'fixed'},goalDigest:'a'.repeat(64),coverageDigest:'b'.repeat(64),criteriaDigest:'c'.repeat(64),comparisonDigest:'d'.repeat(64),criteriaFixedRef:'fixed',permissionOwner:'owner',maxCycles:3,maxSteps:40,allowedEffects:[]});
const evidence=id=>({ref:id,author:'observer',reviewer:'external-reviewer',criteriaDigest:spec().criteriaDigest});
const data=(kind,id,other={})=>({kind,id,...other});
const cost=(n,paidUsd)=>({humanMinutes:n,sys2Calls:n,sys1Calls:n,ciSeconds:n,computeSeconds:n,reworkMinutes:n,paidUsd});
const observed=id=>data('OBSERVED',id,{worldId:'synthetic-world',worldVersion:'v0',coverageDigest:spec().coverageDigest,verdict:'GAP',evidence:evidence('obs-'+id)});
const proposed=id=>data('PROPOSED','p-'+id,{author:'writer',proposalDigest:'e'.repeat(64),questions:[{id:'q',reason:'why',route:'MISSING'}]});
const verified=id=>data('VERIFIED','v-'+id,{proposalDigest:'e'.repeat(64),verdict:'PASS',evidence:{...evidence('review-'+id),author:'writer'}});
const admitted=id=>data('ADMITTED','a-'+id,{operation:'NO_EFFECT',authorizationRef:'synthetic',proposalDigest:'e'.repeat(64),worldId:'synthetic-world',worldVersion:'v0'});
const readback=(id,values,verdict='GAP')=>data('READBACK','r-'+id,{worldId:'synthetic-world',worldVersion:'v0',coverageDigest:spec().coverageDigest,verdict,evidence:evidence('rb-'+id),cost:values});
const apply=(s,...events)=>events.reduce((v,e)=>transition(v,e).state,s);
const cycle=(s,id,values,verdict='GAP')=>apply(s,observed(id),proposed(id),verified(id),admitted(id),readback(id,values,verdict));
test('recorded readback costs survive the next observation and sum by dimension',()=>{
  const first=cycle(openTrial(spec()),'one',cost(2,1));
  assert.deepEqual(first.recordedReadbackCost,cost(2,1));
  const second=cycle(first,'two',cost(3,4),'NO_GAP');
  assert.equal(second.phase,'DONE');
  assert.deepEqual(second.recordedReadbackCost,cost(5,5));
  assert.deepEqual(second.active.readback.cost,cost(3,4));
});
test('unknown readback price stays unknown, not silently zero',()=>{
  const first=cycle(openTrial(spec()),'one',cost(2,null));
  const second=cycle(first,'two',cost(3,4),'NO_GAP');
  assert.equal(second.recordedReadbackCost.paidUsd,null);
  assert.equal(second.recordedReadbackCost.humanMinutes,5);
});
test('replayed readback cannot double-account accepted costs',()=>{
  const events=[observed('one'),proposed('one'),verified('one'),admitted('one'),readback('one',cost(2,1))];
  const first=apply(openTrial(spec()),...events);
  const duplicate=transition(first,events.at(-1));
  assert.equal(duplicate.changed,false);
  assert.equal(duplicate.state,first);
  assert.deepEqual(duplicate.state.recordedReadbackCost,cost(2,1));
});
test('non-finite aggregate is refused without mutating previous evidence',()=>{
  const first=cycle(openTrial(spec()),'one',cost(Number.MAX_VALUE,1));
  const untilReadback=apply(first,observed('two'),proposed('two'),verified('two'),admitted('two'));
  const unchanged=structuredClone(untilReadback);
  assert.throws(()=>transition(untilReadback,readback('two',cost(Number.MAX_VALUE,2))),/COST_OVERFLOW/);
  assert.deepEqual(untilReadback,unchanged);
});
