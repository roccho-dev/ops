import test from 'node:test';
import assert from 'node:assert/strict';
import {openTrial,transition} from './one-target.mjs';
const spec=()=>({id:'resume-fixture',world:{id:'target',version:'v1',scope:'finite'},goalDigest:'a'.repeat(64),coverageDigest:'b'.repeat(64),criteriaDigest:'c'.repeat(64),comparisonDigest:'d'.repeat(64),criteriaFixedRef:'fixed',permissionOwner:'owner',maxCycles:2,maxSteps:12,allowedEffects:[]});
const ev=(id,kind,rest={})=>({id,kind,...rest});
const evidence=ref=>({ref,author:'observer',reviewer:'separate-reviewer',criteriaDigest:'c'.repeat(64)});
const observed=(id,ref,verdict='GAP')=>ev(id,'OBSERVED',{worldId:'target',worldVersion:'v1',coverageDigest:'b'.repeat(64),verdict,evidence:evidence(ref)});
const resume=()=>ev('resume','RESUMED',{newEvidenceRef:'fresh-proof',reason:'new material delivered'});
test('UNKNOWN cannot be reopened with stale observation after a claimed new ref',()=>{
 const blocked=transition(openTrial(spec()),observed('old','old-proof','UNKNOWN')).state;
 const resumed=transition(blocked,resume()).state;
 assert.equal(resumed.phase,'OBSERVE');
 assert.throws(()=>transition(resumed,observed('replay','old-proof')),/RESUME_EVIDENCE_MISMATCH/);
 assert.equal(resumed.phase,'OBSERVE');
 assert.equal(resumed.events.length,2);
});
test('resume consumes exactly claimed new ref and advances',()=>{
 const blocked=transition(openTrial(spec()),observed('old','old-proof','UNKNOWN')).state;
 const resumed=transition(blocked,resume()).state;
 const result=transition(resumed,observed('fresh','fresh-proof')).state;
 assert.equal(result.phase,'DISCOVER');
 assert.equal(result.active.observed.ref,'fresh-proof');
 assert.equal(result.active.resumeEvidenceRef,undefined);
});
test('normal observation needs no resume ref',()=>{
 assert.equal(transition(openTrial(spec()),observed('normal','normal-proof')).state.phase,'DISCOVER');
});
