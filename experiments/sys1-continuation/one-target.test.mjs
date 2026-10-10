import test from 'node:test';
import assert from 'node:assert/strict';
import {openTrial,transition} from './one-target.mjs';
const spec=()=>({id:'author-created-trial',world:{id:'one-scope',version:'initial',scope:'one issue'},
  goalDigest:'a'.repeat(64),coverageDigest:'b'.repeat(64),criteriaDigest:'c'.repeat(64),comparisonDigest:'d'.repeat(64),
  criteriaFixedRef:'before-run',permissionOwner:'owner',maxCycles:2,maxSteps:30,allowedEffects:['change-draft']});
const ev=(id,kind,extra={})=>({id,kind,...extra});
const att=(ref,author='observer',reviewer='independent-syntactic-reviewer')=>({ref,author,reviewer,criteriaDigest:spec().criteriaDigest});
const observed=(id,verdict='GAP')=>ev(id,'OBSERVED',{worldId:'one-scope',worldVersion:'initial',coverageDigest:spec().coverageDigest,verdict,evidence:att('obs-'+id)});
const proposed=(id='p')=>ev(id,'PROPOSED',{author:'optimizer',proposalDigest:'e'.repeat(64),questions:[{id:'q1',reason:'missing objective evidence',route:'MISSING'}]});
const verified=(id='v',verdict='PASS')=>ev(id,'VERIFIED',{proposalDigest:'e'.repeat(64),verdict,evidence:att('review-'+id,'optimizer')});
const admitted=(operation='NO_EFFECT')=>ev('admit-'+operation,'ADMITTED',{operation,authorizationRef:'synthetic-permission',effectKey:'one-effect',proposalDigest:'e'.repeat(64),worldId:'one-scope',worldVersion:'initial'});
const receipt=()=>ev('effect','EFFECT_RECORDED',{worldId:'one-scope',worldVersion:'initial',effectKey:'one-effect',receiptRef:'synthetic-receipt',resultWorldVersion:'changed',actor:'actor'});
const cost=()=>({humanMinutes:5,sys2Calls:2,sys1Calls:1,ciSeconds:10,computeSeconds:2,reworkMinutes:null,paidUsd:null});
const readback=(id,verdict='GAP',worldVersion='initial')=>ev(id,'READBACK',{worldId:'one-scope',worldVersion,coverageDigest:spec().coverageDigest,verdict,evidence:att('rb-'+id,'observer','reviewer'),cost:cost()});
const many=(s,...events)=>events.reduce((v,e)=>transition(v,e).state,s);
const ready=()=>many(openTrial(spec()),observed('obs'),proposed(),verified());
test('goal, scope, coverage, criteria and comparison are immutable inputs',()=>{for(const field of ['goalDigest','coverageDigest','criteriaDigest','comparisonDigest']){const x=spec();x[field]='invalid';assert.throws(()=>openTrial(x));}});
test('finite cycles/steps and permissions required',()=>{const a=spec();a.maxCycles=0;assert.throws(()=>openTrial(a));a.maxCycles=2;a.allowedEffects=['x','x'];assert.throws(()=>openTrial(a));});
test('does not intake hidden gold',()=>assert.throws(()=>openTrial({...spec(),gold:[]})));
test('synthetic no-gap is a reported target, not independent general quality',()=>{const r=many(openTrial(spec()),observed('o','NO_GAP'));assert.equal(r.phase,'DONE');assert.equal(r.qualityProven,false);assert.equal(r.independentHoldout,false);});
test('unknown observation is blocked not no-gap',()=>assert.equal(many(openTrial(spec()),observed('o','UNKNOWN')).result,'NEEDS_OBSERVATION'));
test('must preserve full-scope coverage when observing',()=>{const e=observed('o');e.coverageDigest='wrong';assert.throws(()=>transition(openTrial(spec()),e));});
test('proposal distinguishes known and missing Core',()=>{const q=proposed();q.questions.push({id:'q2',reason:'relevant',route:'KNOWN',coreId:'core-id'});const r=many(openTrial(spec()),observed('o'),q);assert.deepEqual(r.active.proposal.questions.map(x=>x.route),['MISSING','KNOWN']);});
test('duplicate question and empty proposal rejected',()=>{const v=many(openTrial(spec()),observed('o'));const x=proposed();x.questions.push(x.questions[0]);assert.throws(()=>transition(v,x));x.questions=[];assert.throws(()=>transition(v,x));});
test('unreviewed proposal cannot be admitted',()=>assert.throws(()=>transition(many(openTrial(spec()),observed('o'),proposed()),admitted('change-draft'))));
test('review checks candidate identity and different reviewer',()=>{const v=many(openTrial(spec()),observed('o'),proposed());const x=verified();x.proposalDigest='wrong';assert.throws(()=>transition(v,x));x.proposalDigest='e'.repeat(64);x.evidence.reviewer='optimizer';assert.throws(()=>transition(v,x));});
test('review rejection and unknown remain distinct',()=>{const v=many(openTrial(spec()),observed('o'),proposed());assert.equal(transition(v,verified('v','REJECT')).state.phase,'DISCOVER');assert.equal(transition(v,verified('u','UNKNOWN')).state.phase,'BLOCKED');});
test('unpermitted effect blocked locally',()=>assert.equal(many(ready(),admitted('delete-base')).result,'PERMISSION_MISSING'));
test('no-effect still requires independent readback',()=>{const r=many(ready(),admitted());assert.equal(r.phase,'READBACK');assert.equal(r.result,'NOT_PROVEN');});
test('remaining Gap is reobserved, not completed',()=>{const r=many(ready(),admitted(),readback('r'));assert.equal(r.phase,'OBSERVE');assert.equal(r.cycles,1);});
test('readback with no gap is only target-level reported outcome',()=>{const r=many(ready(),admitted(),readback('r','NO_GAP'));assert.equal(r.phase,'DONE');assert.equal(r.qualityProven,false);});
test('unknown readback is not success',()=>assert.equal(many(ready(),admitted(),readback('r','UNKNOWN')).phase,'BLOCKED'));
test('two unresolved cycles stop within finite budget',()=>{const r=many(ready(),admitted(),readback('r'),observed('o2'),proposed('p2'),verified('v2'),ev('a2','ADMITTED',{operation:'NO_EFFECT',authorizationRef:'permission',proposalDigest:'e'.repeat(64),worldId:'one-scope',worldVersion:'initial'}),readback('r2'));assert.equal(r.result,'CYCLE_LIMIT');});
test('event idempotency and collision protection',()=>{const v=transition(openTrial(spec()),observed('o'));assert.equal(transition(v.state,observed('o')).changed,false);assert.throws(()=>transition(v.state,observed('o','UNKNOWN')));});
test('effect receipt alone does not make semantic outcome true',()=>{const v=many(ready(),admitted('change-draft'),receipt());assert.equal(v.phase,'READBACK');assert.equal(v.result,'NOT_PROVEN');});
test('readback must use current effect version',()=>{const v=many(ready(),admitted('change-draft'),receipt());assert.throws(()=>transition(v,readback('r')));const r=transition(v,readback('r','GAP','changed')).state;assert.equal(r.worldVersion,'changed');});
test('readback cannot self-review',()=>{const v=many(ready(),admitted());const r=readback('r');r.evidence.reviewer='optimizer';assert.throws(()=>transition(v,r));});
test('readback cannot shrink fixed total coverage',()=>{const v=many(ready(),admitted());const r=readback('r','NO_GAP');r.coverageDigest='new-subset';assert.throws(()=>transition(v,r));});
test('cost dimensions are all mandatory, unknown preserved as null',()=>{const v=many(ready(),admitted());const r=readback('r');delete r.cost.ciSeconds;assert.throws(()=>transition(v,r));assert.equal(transition(v,readback('r2')).state.active.readback.cost.paidUsd,null);});
test('resume requires new evidence, not same reference',()=>{const v=many(openTrial(spec()),observed('o','UNKNOWN'));assert.throws(()=>transition(v,ev('resume','RESUMED',{newEvidenceRef:'obs-o',reason:'repeat'})));assert.equal(transition(v,ev('resume2','RESUMED',{newEvidenceRef:'new-source',reason:'readback provided'})).state.phase,'OBSERVE');});
test('bounded number of events stops endless rejected proposals',()=>{const s=spec();s.maxSteps=4;const v=many(openTrial(s),observed('o'),proposed(),verified('v','REJECT'),proposed('p2'));assert.equal(transition(v,verified('v2','REJECT')).state.result,'STEP_LIMIT');});

test('completed trial keeps its terminal result after unrelated delivery at limit',()=>{
  const x=spec();x.maxSteps=5;
  const done=many(openTrial(x),observed('o'),proposed(),verified(),admitted(),readback('r','NO_GAP'));
  assert.equal(done.phase,'DONE');assert.equal(done.result,'TARGET_REPORTED_MET');
  const snapshot=structuredClone(done);
  assert.throws(()=>transition(done,observed('unrelated')),/TERMINAL_TRIAL/);
  assert.deepEqual(done,snapshot);
  assert.equal(transition(done,readback('r','NO_GAP')).changed,false);
});
test('stopped trial cannot silently rewrite its original stop reason',()=>{
  const x=spec();x.maxSteps=4;
  const stopped=many(openTrial(x),observed('o'),proposed(),verified('v','REJECT'),proposed('p2'),verified('v2','REJECT'));
  assert.equal(stopped.phase,'STOPPED');assert.equal(stopped.result,'STEP_LIMIT');
  const snapshot=structuredClone(stopped);
  assert.throws(()=>transition(stopped,verified('v3','REJECT')),/TERMINAL_TRIAL/);
  assert.deepEqual(stopped,snapshot);
});

test('admission rejects stale proposal identity before any effect',()=>{
  const s=ready(), e=admitted('change-draft'); e.proposalDigest='f'.repeat(64);
  assert.throws(()=>transition(s,e),/STALE_OR_UNBOUND_ADMISSION/);
  assert.equal(s.phase,'ADMIT'); assert.equal(s.events.length,3);
});
test('admission rejects another world even with operation in allowed list',()=>{
  const s=ready(), e=admitted('change-draft'); e.worldId='other-target';
  assert.throws(()=>transition(s,e),/STALE_OR_UNBOUND_ADMISSION/);
  assert.equal(s.phase,'ADMIT');
});
test('admission refuses stale version after world changes',()=>{
  const first=many(ready(),admitted('change-draft'),receipt(),readback('r','GAP','changed'));
  const next=many(first,ev('ob2','OBSERVED',{...observed('ob2'),worldVersion:'changed'}),proposed('p2'),verified('v2'));
  const bad=admitted('change-draft'); bad.id='admit-second';
  assert.throws(()=>transition(next,bad),/STALE_OR_UNBOUND_ADMISSION/);
  bad.worldVersion='changed';
  assert.equal(transition(next,bad).state.phase,'EFFECT');
});
