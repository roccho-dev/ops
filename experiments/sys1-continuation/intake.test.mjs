import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const moduleUrl=process.env.INTAKE_SUBJECT?pathToFileURL(process.env.INTAKE_SUBJECT):new URL('./progress.mjs',import.meta.url);
const {holdoutIntake}=await import(moduleUrl);
// Public artificial metadata, not a real independent package or hidden question set.
const expected=()=>({candidateDigest:'a'.repeat(64),criteriaDigest:'b'.repeat(64)});
const manifest=()=>({schema:'ops.sys1.holdout-manifest.v1',packageId:'synthetic-metadata',candidateDigest:'a'.repeat(64),
  author:{id:'author',receipt:'synthetic-author-receipt'},reviewer:{id:'reviewer',receipt:'synthetic-reviewer-receipt'},
  privateArtifact:{visibility:'sealed',locator:'synthetic-owner-reference',digest:'c'.repeat(64)},population:'synthetic scope',count:24,
  criteria:{digest:'b'.repeat(64),fixedBeforeEvaluation:'synthetic-contract-receipt'},
  exposure:{optimizerSaw:false,usedForTuning:false,receipt:'synthetic-history'}});
const check=(m=manifest(),e=expected(),optimizer='writer')=>holdoutIntake(m,optimizer,e);
const notReady=(m,e,optimizer)=>assert.notEqual(check(m,e,optimizer).status,'READY_FOR_INDEPENDENT_VERIFICATION');
test('matching metadata is only ready for independent verification, never P3 passed',()=>{
  assert.deepEqual(check(),{status:'READY_FOR_INDEPENDENT_VERIFICATION',missing:[],p3Complete:false});
});
test('missing package remains missing input',()=>assert.equal(check(null).status,'NEEDS_INPUT'));
test('missing expected binding cannot be inferred from submitted manifest',()=>{
  assert.notEqual(holdoutIntake(manifest(),'writer').status,'READY_FOR_INDEPENDENT_VERIFICATION');
});
for(const [name,change] of [
  ['different candidate',m=>m.candidateDigest='d'.repeat(64)],
  ['malformed candidate digest',m=>m.candidateDigest='frozen'],
  ['different evaluation criteria',m=>m.criteria.digest='e'.repeat(64)],
  ['malformed criteria digest',m=>m.criteria.digest='criteria'],
  ['author is optimizer',m=>m.author.id='writer'],
  ['reviewer is optimizer',m=>m.reviewer.id='writer'],
  ['same author and reviewer',m=>m.reviewer.id='author'],
  ['whitespace disguises author identity',m=>m.author.id=' writer '],
  ['optimizer has seen package',m=>m.exposure.optimizerSaw=true],
  ['package used for tuning',m=>m.exposure.usedForTuning=true],
  ['missing provenance receipt',m=>delete m.exposure.receipt],
  ['nonpositive sample count',m=>m.count=0]
])test('refuse readiness: '+name,()=>{const m=manifest();change(m);notReady(m);});
for(const [name,e] of [
  ['missing candidate binding',{criteriaDigest:'b'.repeat(64)}],
  ['missing criteria binding',{candidateDigest:'a'.repeat(64)}],
  ['malformed candidate binding',{candidateDigest:'frozen',criteriaDigest:'b'.repeat(64)}],
  ['malformed criteria binding',{candidateDigest:'a'.repeat(64),criteriaDigest:'criteria'}]
])test('refuse readiness: '+name,()=>notReady(manifest(),e));
for(const optimizer of ['',undefined,' writer '])test('require explicit canonical optimizer identity '+String(optimizer),()=>{
  assert.notEqual(holdoutIntake(manifest(),optimizer,expected()).status,'READY_FOR_INDEPENDENT_VERIFICATION');
});
for(const [name,change] of [
  ['top-level Gold',m=>m.gold=['SYNTHETIC_CANARY']],
  ['nested author payload',m=>m.author.gold=['SYNTHETIC_CANARY']],
  ['nested reviewer payload',m=>m.reviewer.questions=['SYNTHETIC_CANARY']],
  ['nested artifact payload',m=>m.privateArtifact.cases=['SYNTHETIC_CANARY']],
  ['nested criteria payload',m=>m.criteria.answers=['SYNTHETIC_CANARY']],
  ['nested history payload',m=>m.exposure.questions=['SYNTHETIC_CANARY']],
  ['unknown top-level extension',m=>m.extension={payload:'SYNTHETIC_CANARY'}]
])test('reject non-metadata field: '+name,()=>{
  const m=manifest();change(m);
  assert.throws(()=>check(m),error=>error.message==='HOLDOUT_CONTENT_MUST_NOT_ENTER_OPTIMIZER'&&!error.message.includes('SYNTHETIC_CANARY'));
});
test('binding checks do not mutate manifest or expected criteria',()=>{
  const m=manifest(),e=expected(),before=structuredClone({m,e});check(m,e);assert.deepEqual({m,e},before);
});
test('non-object nested metadata is rejected rather than interpreted as a package',()=>{
  const m=manifest();m.author=['author','receipt'];assert.throws(()=>check(m));
});
