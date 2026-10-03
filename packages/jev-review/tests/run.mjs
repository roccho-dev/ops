import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JEV_MODEL } from '../core.mjs';
import { evaluate } from '../review.mjs';
import { createHash } from 'node:crypto';
import { semlint } from '../semlint.mjs';
import { rankJudgments } from '../rank.mjs';
import { evaluateInput, parseJsonl, rowsForEvaluation, serializeJsonl, validateCliInput, writeAndReadback } from '../bin/jev-review.mjs';

const state = { purpose: 'fixture' };
const themes = ['purpose', 'scope'];
const items = [
  { theme: 'purpose', subject: ['candidate', 'a'], concern: 'May miss the purpose.' },
  { theme: 'purpose', subject: ['candidate', 'b'], concern: 'May miss the purpose.' },
  { theme: 'scope', subject: ['candidate', 'a'], concern: 'May leak scope.' },
];

let calls = 0;
const result = await evaluate(state, { themes, items }, async (_, questions) => {
  calls++;
  return {
    model: JEV_MODEL,
    answers: Object.fromEntries(Object.keys(questions).map((key, index) => [key, { type: 'noul', noul: [0.1, 0.9, 0.2][index] }])),
  };
});
assert.equal(calls, 1);
assert.equal(result.judgments.length, 3);
assert.deepEqual(result.coverage, [
  { theme: 'purpose', candidates: 2, evaluated: 2 },
  { theme: 'scope', candidates: 1, evaluated: 1 },
]);
const ranked = rankJudgments(result.judgments, { topK: 1, themes, items });
assert.deepEqual(ranked.map((group) => [group.theme, group.candidates, group.evaluated, group.returned]), [
  ['purpose', 2, 2, 1],
  ['scope', 1, 1, 1],
]);
assert.deepEqual(ranked[0].findings[0].subject, ['candidate', 'b']);

const empty = await evaluate(state, { themes: ['empty'], items: [] }, async () => { throw new Error('MUST_NOT_CALL'); });
assert.equal(empty.calls, 0);
assert.deepEqual(empty.coverage, [{ theme: 'empty', candidates: 0, evaluated: 0 }]);
assert.equal(rankJudgments([], { topK: 2, themes: ['empty'], items: [] })[0].status, 'empty');
assert.equal(rankJudgments([], { topK: 0, themes, items })[0].status, 'disabled');

await assert.rejects(() => evaluate(state, { themes: ['purpose'], items: items.slice(0, 1) }, async (_, questions) => ({
  model: 'other',
  answers: Object.fromEntries(Object.keys(questions).map((key) => [key, { type: 'noul', noul: 0.5 }])),
})), /JEV_MODEL_MISMATCH/);
assert.throws(() => rankJudgments(result.judgments.slice(0, 1), { topK: 1, themes, items }), /JUDGMENT_SET_MISMATCH/);
await assert.rejects(() => evaluate(state, { themes: ['purpose'], items: [items[0], structuredClone(items[0])] }, async () => ({})), /DUPLICATE_REVIEW_ITEM/);

const authRows = parseJsonl(fs.readFileSync(new URL('../artifact.jsonl', import.meta.url), 'utf8'));
assert.deepEqual(authRows, [{ artifact: 'jev-review', kind: 'artifact.auth.v1', requiredCapabilities: ['jev-api'] }]);

const cliInput = { state, themes, items, topK: 1 };
validateCliInput(cliInput);
assert.throws(() => validateCliInput({ ...cliInput, extra: true }), /INVALID_JEV_REVIEW_INPUT/);
assert.throws(() => validateCliInput({ state, themes, items, topK: 0 }), /INVALID_JEV_REVIEW_TOP_K/);
const cliResult = await evaluateInput(cliInput, async (_, questions) => ({
  model: JEV_MODEL,
  answers: Object.fromEntries(Object.keys(questions).map((key, index) => [key, { type: 'noul', noul: [0.1, 0.9, 0.2][index] }])),
  usage: { input_tokens: 3, output_tokens: 3 },
}));
const rows = rowsForEvaluation(cliInput, cliResult);
const encoded = serializeJsonl(rows);
assert.equal(encoded.endsWith('\n'), true);
assert.equal(encoded.split('\n').filter(Boolean).length, rows.length);
assert.deepEqual(parseJsonl(encoded), rows);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-review-'));
try {
  const out = path.join(tmp, 'result.jsonl');
  assert.deepEqual(writeAndReadback(out, rows), rows);
  const physical = fs.readFileSync(out, 'utf8');
  assert.equal(physical.split('\n').filter(Boolean).length, rows.length);
  assert.equal(physical.includes('}\\\\n{'), false);
  assert.throws(() => writeAndReadback(out, rows), /EEXIST/u);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// These labels are independent test expectations, never provider input.
const digest = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const ruleCases = [
  ['aligned.authority-grant', ['authorityContract'], 'Annotations grant no merge authority.', 'Return an annotation only.', 'Automatically merge based on this concern.'],
  ['closed.feedback-completion', ['completionContract'], 'DELIVERED does not establish actor/work/reentry completion.', 'DELIVERED; work remains unobserved.', 'Receipt 200 establishes C3 complete.'],
  ['unique.canonical-responsibility', ['responsibilityContract'], 'The declared base owns canonical meaning; aliases and delegated updates are legitimate.', 'Alias the accepted base and keep its owner.', 'Replace the base with an incompatible second canonical owner.'],
  ['minimal.necessary-layer', ['requiredContracts', 'dependencyDescription'], 'Preserve distinct judge/admission, failure/terminal protection and replaceability.', 'Keep distinct judge and admission responsibilities.', 'Add an intermediate facade with no required contract.'],
  ['measurable.attempt-accounting', ['accountingContract', 'registeredCases'], 'Retain all attempts, invalid evidence and observed wrong decisions.', 'Report successes, failures and invalid attempts separately.', 'Drop invalid and failed attempts and report all success.'],
  ['improving.comparable-evidence', ['qualityContract', 'baselineEvidence'], 'Compare the same population with cause/metric/regression evidence; justified tradeoffs and multiple causes are allowed.', 'Compare the same population and disclose both causes and protected regressions.', 'Change the population and call the higher score improvement.'],
];
const makeInput = (rule, roles, normative, content, kind = 'ci-artifact') => ({
  schema: 'ops.semlint.input.v1',
  subject: {kind, ref: 'fixture:subject', revision: 'r1', scope: 'entire fixture', content, sha256: digest(content)},
  context: roles.map((role) => ({role, ref: 'fixture:' + role, revision: 'r1', content: normative, sha256: digest(normative)})),
  checks: [rule],
});
let semlintCases = 0, semlintCallbacks = 0;
const mock = async (_, questions) => {
  semlintCallbacks++;
  return {model: JEV_MODEL, answers: Object.fromEntries(Object.keys(questions).map((key) => [key, {type: 'noul', noul: 0.5}]))};
};
for (const [rule, roles, normative, legal, broken] of ruleCases) {
  const payloads = [];
  for (const content of [legal, broken]) {
    const input = makeInput(rule, roles, normative, content, rule.startsWith('closed.') ? 'log-entry' : 'ci-artifact');
    const output = await semlint(input, async (s, q) => {
      payloads.push(JSON.stringify({s, q}));
      assert.equal(JSON.stringify({s,q}).includes('INDEPENDENT_GOLD_LABEL'), false);
      assert.deepEqual(s, input);
      assert.equal(Object.keys(q).length, 1);
      assert.ok(q.q0.instructions.includes(rule));
      return mock(s, q);
    });
    assert.equal(output.records.length, 6);
    assert.equal(output.records.find((x) => x.rule === rule).status, 'OBSERVED');
    assert.equal(output.records.find((x) => x.rule === rule).noul, 0.5);
    assert.equal(output.records.filter((x) => x.status === 'NOT_SELECTED').length, 5);
    assert.deepEqual(output.counts, {selected: 1, sendable: 1, evaluated: 1, missing: 0});
    assert.equal(output.accounting.callbackAttempts, 1);
    assert.equal(output.accounting.usage, null);
    assert.equal(output.accounting.providerHttpCalls, null);
    assert.equal(output.accounting.cost, null);
    semlintCases++;
  }
  assert.notEqual(payloads[0], payloads[1]); // binding, not truth classification
}
const sample = makeInput(...ruleCases[0].slice(0,3), ruleCases[0][3]);
const noCalls = async () => { throw new Error('MUST_NOT_CALL'); };
const emptyLint = await semlint({...sample, checks: []}, noCalls);
assert.equal(emptyLint.accounting.callbackAttempts, 0);
assert.equal(emptyLint.records.every((x) => x.status === 'NOT_SELECTED' && x.noul === null), true);
const missing = await semlint({...sample, context: []}, noCalls);
assert.equal(missing.records[0].status, 'INCOMPLETE');
assert.deepEqual(missing.records[0].missingRoles, ['authorityContract']);
const emptyContext = {...sample, context: [{...sample.context[0], content: '', sha256: digest('')}]};
assert.equal((await semlint(emptyContext, noCalls)).records[0].status, 'INCOMPLETE');
const mixed = await semlint({...sample, checks: [ruleCases[0][0], ruleCases[1][0]]}, mock);
assert.equal(mixed.records[0].status, 'OBSERVED');
assert.equal(mixed.records[1].status, 'INCOMPLETE');
assert.deepEqual(mixed.counts, {selected: 2, sendable: 1, evaluated: 1, missing: 1});
const grant = {...sample, context: [...sample.context, {...sample.context[0], ref: 'fixture:separate-grant', content: 'Separate authorized consumer may block.', sha256: digest('Separate authorized consumer may block.')} ]};
assert.equal((await semlint(grant, mock)).records[0].contextRefs.length, 2);
for (const change of [
  (x) => { x.extra = true; }, (x) => { x.subject.sha256 = '0'.repeat(64); },
  (x) => { x.checks.push(x.checks[0]); }, (x) => { x.context.push({...x.context[0]}); },
  (x) => { x.context.push({...x.context[0], content: 'conflicting', sha256: digest('conflicting')}); },
  (x) => { x.checks[0] = 'unknown'; }, (x) => { x.subject.content = '\ud800'; },
  (x) => { delete x.context[0]; }, (x) => { Object.defineProperty(x.subject, 'content', {get() { throw new Error('ACCESSOR_CANARY'); }}); },
]) {
  const input = structuredClone(sample); change(input);
  await assert.rejects(() => semlint(input, noCalls), /^Error: INVALID_SEMLINT_INPUT$/);
  semlintCases++;
}
const canary = 'SECRET_CANARY_NEVER_OUTPUT';
for (const [reply, status, cause] of [
  [() => ({model: 'other', answers: {q0: {type: 'noul', noul: 0.5}}}), 'EVIDENCE_INVALID', 'JEV_MODEL_MISMATCH'],
  [() => ({model: JEV_MODEL, answers: {extra: {type: 'noul', noul: 0.5}}}), 'EVIDENCE_INVALID', 'INVALID_JEV_ANSWERS'],
  [() => { throw new Error(canary); }, 'EXECUTION_ERROR', 'EVALUATION_FAILED'],
]) {
  const output = await semlint(sample, async () => reply());
  assert.equal(output.records[0].status, status); assert.equal(output.records[0].cause, cause);
  assert.equal(output.records[0].noul, null);
  assert.equal(output.accounting.callbackAttempts, 1); assert.equal(output.accounting.validatedCalls, 0);
  assert.equal(JSON.stringify(output).includes(canary), false); semlintCases++;
}
const oversized = structuredClone(sample); oversized.subject.content = 'x'.repeat(29000); oversized.subject.sha256 = digest(oversized.subject.content);
const budget = await semlint(oversized, noCalls);
assert.equal(budget.records[0].status, 'EXECUTION_ERROR'); assert.equal(budget.accounting.callbackAttempts, 0);
const mutable = structuredClone(sample);
let releaseSnapshot;
const snapshotGate = new Promise((resolve) => { releaseSnapshot = resolve; });
const pending = semlint(mutable, async (s,q) => { await snapshotGate; assert.equal(s.subject.content, sample.subject.content); return mock(s,q); });
mutable.subject.content = canary; mutable.context[0].content = canary; releaseSnapshot();
const snapResult = await pending;
assert.equal(snapResult.inputDigest, (await semlint(sample, mock)).inputDigest);
assert.equal(JSON.stringify(snapResult).includes(canary), false);
const usageResult = await semlint(sample, async (_,q) => ({model:JEV_MODEL, answers:{q0:{type:'noul',noul:0.5}}, usage:{input_tokens:2,[canary]:3}}));
assert.deepEqual(usageResult.accounting.usage, {input_tokens:2});
assert.equal(JSON.stringify(usageResult).includes(canary), false);
semlintCases += 8;
const all = {...sample, checks: ruleCases.map((row) => row[0]), context: ruleCases.flatMap(([rule,roles,normative]) => makeInput(rule,roles,normative,'material').context)};
const allResult = await semlint(all, mock);
assert.deepEqual(allResult.counts, {selected:6,sendable:6,evaluated:6,missing:0});
assert.equal(allResult.accounting.callbackAttempts, 1);
assert.equal(allResult.records.every((row) => row.status === 'OBSERVED' && row.noul === 0.5), true);
await assert.rejects(() => semlint(new Proxy({}, {getPrototypeOf() {throw new Error(canary);}}), noCalls), /^Error: INVALID_SEMLINT_INPUT$/);
const thrownProxy = await semlint(sample, async () => {throw new Proxy({}, {getOwnPropertyDescriptor() {throw new Error(canary);}});});
assert.equal(thrownProxy.records[0].cause, 'EVALUATION_FAILED');
assert.equal(JSON.stringify(thrownProxy).includes(canary), false);
semlintCases += 3;
let changingReads = 0;
const changing = {...sample, subject: new Proxy({...sample.subject}, {get(target,key) {
  if (key === 'content') return ++changingReads < 3 ? target.content : 'changed';
  return target[key];
}})};
const changingResult = await semlint(changing, async (s,q) => {
  assert.equal(s.subject.sha256, digest(s.subject.content));
  assert.equal(s.subject.content, sample.subject.content); return mock(s,q);
});
assert.equal(changingReads, 0); assert.equal(changingResult.records[0].status, 'OBSERVED');
const inconsistent = {...sample, subject: new Proxy({...sample.subject}, {getOwnPropertyDescriptor(target,key) {
  const p = Object.getOwnPropertyDescriptor(target,key);
  return key === 'content' ? {...p, value: 'changed'} : p;
}})};
await assert.rejects(() => semlint(inconsistent, noCalls), /^Error: INVALID_SEMLINT_INPUT$/);
semlintCases += 2;

// V2 supplies predicates; independent truth/threshold labels are not provider data.
const provided = {
  schema: 'ops.semlint.input.v2', subject: {...sample.subject}, context: [...sample.context],
  checks: [
    {id: 'fixture.authority.one', axis: 'Aligned', concern: 'This subject claims an unsupported authority.', requiredRoles: ['authorityContract'], crossLinks: ['Measurable']},
    {id: 'fixture.authority.two', axis: 'Aligned', concern: 'This subject silently changes the declared scope.', requiredRoles: [], crossLinks: []},
    {id: 'fixture.feedback', axis: 'Closed', concern: 'Completion is claimed without the required observation.', requiredRoles: ['completionContract'], crossLinks: ['Measurable']},
  ],
};
let providedCases = 0, providedCallbacks = 0;
const providedMock = async (s,q) => {
  providedCallbacks++;
  assert.equal(Object.isFrozen(s.checks[0].requiredRoles), true);
  assert.equal(Object.isFrozen(q), true);
  assert.equal(JSON.stringify({s,q}).includes('INDEPENDENT_GOLD_LABEL'), false);
  return {model:JEV_MODEL, answers:Object.fromEntries(Object.keys(q).map((key) => [key,{type:'noul',noul:0.5}])), usage:{input_tokens:4, output_tokens:1}};
};
const supplied = await semlint(provided, async (s,q) => {
  assert.deepEqual(s, provided);
  assert.deepEqual(Object.keys(q), ['q0','q1']);
  assert.ok(q.q0.instructions.includes(provided.checks[0].concern));
  assert.ok(q.q1.instructions.includes(provided.checks[1].concern));
  assert.deepEqual(q.q0.criteria, {true:'The concern is present in the declared state.', false:'The concern is absent from the declared state.'});
  return providedMock(s,q);
});
assert.equal(supplied.schema, 'ops.semlint.result.v2');
assert.deepEqual(supplied.counts, {selected:3,sendable:2,evaluated:2,missing:1});
assert.deepEqual(supplied.records.map((r)=>[r.rule,r.question,r.status]), [
  ['fixture.authority.one','Aligned','OBSERVED'], ['fixture.authority.two','Aligned','OBSERVED'], ['fixture.feedback','Closed','INCOMPLETE'],
]);
assert.deepEqual(supplied.records[2].missingRoles, ['completionContract']);
assert.deepEqual(supplied.records[0].crossLinks, ['Measurable']);
assert.deepEqual(supplied.accounting.usage, {input_tokens:4,output_tokens:1});
assert.equal(supplied.accounting.callbackAttempts,1);
assert.equal(supplied.accounting.providerHttpCalls,null);
assert.equal(supplied.accounting.cost,null);
providedCases++;
const nothing = await semlint({...provided,checks:[]}, noCalls);
assert.equal(nothing.schema,'ops.semlint.result.v2'); assert.deepEqual(nothing.records,[]);
assert.deepEqual(nothing.counts,{selected:0,sendable:0,evaluated:0,missing:0}); assert.equal(nothing.accounting.callbackAttempts,0);
const unavailable = await semlint({...provided,context:[],checks:[provided.checks[0]]}, noCalls);
assert.equal(unavailable.records[0].status,'INCOMPLETE'); assert.equal(unavailable.accounting.callbackAttempts,0);
const artifactOnly = await semlint({...provided,context:[],checks:[provided.checks[1]]},providedMock);
assert.equal(artifactOnly.records[0].status,'OBSERVED'); assert.deepEqual(artifactOnly.records[0].contextRefs,[]);
const legitimateGrant = await semlint({...provided,context:grant.context},providedMock);
assert.equal(legitimateGrant.records[0].contextRefs.length,2);
providedCases+=4;
for(const change of [
  x=>{x.schema='ops.semlint.input.v3';}, x=>{x.checks[0].extra=true;},
  x=>{x.checks[0].id='';}, x=>{x.checks[0].axis='Seventh';}, x=>{x.checks[0].concern='';},
  x=>{x.checks[0].concern='\ud800';}, x=>{x.checks[0].requiredRoles.push('authorityContract');},
  x=>{x.checks[0].requiredRoles=[''];}, x=>{x.checks[0].crossLinks=['Aligned'];},
  x=>{x.checks[0].crossLinks=['Measurable','Measurable'];}, x=>{x.checks[0].crossLinks=['Seventh'];},
  x=>{x.checks[1].id=x.checks[0].id;}, x=>{x.checks[0].requiredRoles='authorityContract';},
  x=>{delete x.checks[0].requiredRoles;}, x=>{delete x.checks[0].requiredRoles[0];},
  x=>{Object.defineProperty(x.checks[0],'concern',{get(){throw new Error(canary);}});},
  x=>{Object.defineProperty(x.checks[0].requiredRoles,'0',{get(){throw new Error(canary);}});},
]) {
  const x=structuredClone(provided); change(x);
  await assert.rejects(()=>semlint(x,noCalls),/^Error: INVALID_SEMLINT_INPUT$/);
  providedCases++;
}
const changedConcern=structuredClone(provided); changedConcern.checks[0].concern='A distinct declared violation predicate.';
const changedResult=await semlint(changedConcern,providedMock);
assert.notEqual(changedResult.inputDigest,supplied.inputDigest); assert.notEqual(changedResult.questionDigest,supplied.questionDigest);
const moving=structuredClone(provided); let releaseProvided;
const pendingProvided=semlint(moving,async(s,q)=>{
  await new Promise(resolve=>{releaseProvided=resolve;});
  assert.equal(s.checks[0].concern,provided.checks[0].concern);
  assert.deepEqual(s.checks[0].requiredRoles,provided.checks[0].requiredRoles);
  assert.ok(q.q0.instructions.includes(provided.checks[0].concern));
  return providedMock(s,q);
});
moving.checks[0].concern=canary; moving.checks[0].requiredRoles.push('other'); releaseProvided();
assert.equal((await pendingProvided).inputDigest,supplied.inputDigest);
let criterionReads=0;
const proxyCriteria={...provided,checks:[new Proxy({...provided.checks[0]}, {get(target,key){if(key==='concern')criterionReads++;return key==='concern'?canary:target[key];}})]};
const proxyResult=await semlint(proxyCriteria,async(s,q)=>{assert.equal(s.checks[0].concern,provided.checks[0].concern);return providedMock(s,q);});
assert.equal(criterionReads,0);assert.equal(proxyResult.records[0].status,'OBSERVED');
providedCases+=3;
for(const [reply,status,cause] of [
  [()=>({model:'other',answers:{q0:{type:'noul',noul:0.5}}}),'EVIDENCE_INVALID','JEV_MODEL_MISMATCH'],
  [()=>({model:JEV_MODEL,answers:{q0:{type:'noul',noul:0.5}}}),'EVIDENCE_INVALID','INVALID_JEV_ANSWERS'],
  [()=>{throw new Error(canary);},'EXECUTION_ERROR','EVALUATION_FAILED'],
]) {
  const result=await semlint(provided,async()=>{providedCallbacks++;return reply();});
  assert.equal(result.records[0].status,status); assert.equal(result.records[0].cause,cause);
  assert.equal(result.records[1].status,status);assert.equal(result.records[2].status,'INCOMPLETE');
  assert.equal(result.accounting.callbackAttempts,1);assert.equal(result.accounting.validatedCalls,0);
  assert.equal(JSON.stringify(result).includes(canary),false);providedCases++;
}
const largeCriterion=structuredClone(provided);largeCriterion.checks[0].concern='x'.repeat(29000);
const largeResult=await semlint(largeCriterion,noCalls);
assert.equal(largeResult.records[0].status,'EXECUTION_ERROR');assert.equal(largeResult.accounting.callbackAttempts,0);
assert.equal(largeResult.records[2].status,'INCOMPLETE'); providedCases++;
assert.equal((await semlint(sample,mock)).schema,'ops.semlint.result.v1');

console.log(JSON.stringify({
  status: 'PASS',
  core: 'semantic-evaluate',
  ranking: 'derived',
  cli: 'json-input-jsonl-output-readback',
  semanticThresholds: 0,
  semlintCases, semlintCallbacks, realProviderCalls: 0, semanticQuality: 'NOT_PROVEN',
  providedCases, providedCallbacks,
}));
