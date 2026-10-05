import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JEV_MODEL } from '../core.mjs';
import { semlint } from '../semlint.mjs';
import { ENTRY_LIMITS, preparePlan, runPlan, executeOwnerPlan, snapshotJson } from '../semlint-entry.mjs';
import { REQUEST_PREFIX, RESULT_PREFIX, admitIssueComment, nextIssueEffect, composeResultComment, verifyResultReadback } from '../github-comment.mjs';

const copy = (x) => JSON.parse(JSON.stringify(x));
const hash = (x) => createHash('sha256').update(x).digest('hex');
const roles = ['authorityContract', 'completionContract', 'responsibilityContract', 'requiredContracts',
  'dependencyDescription', 'accountingContract', 'registeredCases', 'qualityContract', 'baselineEvidence'];
// Catalog meanings and rule/question mapping remain in semlint; this test reads them, not a second rubric.
const empty = { schema: 'ops.semlint.input.v1', subject: { kind: 'log-entry', ref: 'fixture:subject', revision: 'r1',
  scope: 'fixture only', content: 'public fixture, not an instruction', sha256: hash('public fixture, not an instruction') }, context: [], checks: [] };
const catalog = (await semlint(empty, () => { throw new Error('must not call'); })).records;
const input = { ...copy(empty), checks: catalog.map((x) => x.rule), context: roles.map((role) => ({ role,
  ref: `fixture:${role}`, revision: 'r1', content: `public ${role}`, sha256: hash(`public ${role}`) })) };
const plan = { schema: 'ops.semlint.real-input.v1', cases: [{ id: 'normal', input }] };
const config = { repository: 'roccho-dev/ops', issue: 483, requesters: ['fixture-requester'],
  executionSource: 'a'.repeat(40), limits: { ...ENTRY_LIMITS } };
const event = { repository: config.repository, issue: config.issue, action: 'created', comment: { id: 10,
  author: 'fixture-requester', revision: '2026-10-04T00:00:00Z', body: REQUEST_PREFIX + JSON.stringify({ schema: 'ops.jev.issue-request.v1', cases: plan.cases }) } };
let calls = 0;
const seen = [];
const answer = async (state, questions, options) => {
  calls++; seen.push({ state, questions, options });
  assert.deepEqual(copy(state), copy((await preparePlan(plan)).plan.cases[0].input));
  assert.ok(Object.isFrozen(state)); assert.ok(Object.isFrozen(questions));
  assert.equal(Object.keys(questions).length, 6);
  assert.deepEqual(Object.keys(questions), ['q0', 'q1', 'q2', 'q3', 'q4', 'q5']);
  for (const q of Object.values(questions)) {
    assert.equal(q.type, 'noul'); assert.equal(typeof q.instructions, 'string');
    assert.deepEqual(q.criteria, { true: 'The concern is present in the declared state.', false: 'The concern is absent from the declared state.' });
  }
  assert.ok(options.timeoutMs > 0 && options.timeoutMs <= 15000);
  return { model: JEV_MODEL, answers: Object.fromEntries(Object.keys(questions).map((key, i) => [key, { type: 'noul', noul: i / 10 }])),
    usage: { input_tokens: 12, output_tokens: 6, total_tokens: 18, private_detail: 'must not print' } };
};
const prepared = await preparePlan(plan);
assert.equal(calls, 0); assert.equal(prepared.plannedCalls, 1);
const result = await runPlan(prepared, answer);
assert.equal(calls, 1); assert.equal(result.accounting.callbackAttempts, 1);
assert.equal(result.accounting.validatedCalls, 1); assert.equal(result.accounting.providerHttpCalls, null);
assert.deepEqual(result.cases[0].result.records.map((x) => [x.question, x.rule]), catalog.map((x) => [x.question, x.rule]));
assert.deepEqual(result.cases[0].result.records.map((x) => x.noul), [0, 0.1, 0.2, 0.3, 0.4, 0.5]);
assert.deepEqual(result.cases[0].result.accounting.usage, { input_tokens: 12, output_tokens: 6, total_tokens: 18 });
assert.equal(JSON.stringify(result).includes('private_detail'), false);

// Entire plan is validated before any real callback, including a bad later case and oversized state.
const bad = copy(plan); bad.cases.push({ id: 'late', input: { ...copy(input), checks: ['unknown'] } });
await assert.rejects(preparePlan(bad), /INVALID_ENTRY_SEMLINT/); assert.equal(calls, 1);
await assert.rejects(preparePlan({ ...plan, cases: [plan.cases[0], plan.cases[0]] }), /INVALID_ENTRY_CASE/);
const huge = copy(input); huge.subject.content = 'x'.repeat(28000); huge.subject.sha256 = hash(huge.subject.content);
await assert.rejects(preparePlan({ ...plan, cases: [{ id: 'too-large', input: huge }] }), /ENTRY_PREFLIGHT_FAILED/);
await assert.rejects(preparePlan({ ...plan, endpoint: 'https://attacker.invalid' }), /INVALID_ENTRY_PLAN/);
await assert.rejects(preparePlan({ ...plan, cases: [plan.cases[0], { id: 'second', input }] }, { ...ENTRY_LIMITS, maxCalls: 1 }), /ENTRY_CALL_BUDGET_EXCEEDED/);
await assert.rejects(preparePlan(plan, { ...ENTRY_LIMITS, deadlineMs: 0 }), /INVALID_ENTRY_LIMITS/);
let getterCalls = 0;
const getter = { get schema() { getterCalls++; return plan.schema; }, cases: plan.cases };
await assert.rejects(preparePlan(getter), /INVALID_ENTRY_INPUT/); assert.equal(getterCalls, 0);
assert.throws(() => snapshotJson({ toJSON() { getterCalls++; return {}; } }), /INVALID_ENTRY_INPUT/);
const sparse = []; sparse.length = 2; assert.throws(() => snapshotJson(sparse), /INVALID_ENTRY_INPUT/);

const incomplete = copy(plan); incomplete.cases[0].input.context = [];
const incompleteResult = await runPlan(await preparePlan(incomplete), () => { throw new Error('must not call'); });
assert.equal(incompleteResult.accounting.callbackAttempts, 0);
assert.ok(incompleteResult.cases[0].result.records.every((x) => x.status === 'INCOMPLETE' && x.noul === null));
const unselected = { ...plan, cases: [{ id: 'none', input: empty }] };
assert.ok((await runPlan(await preparePlan(unselected), () => { throw new Error('must not call'); })).cases[0].result.records.every((x) => x.status === 'NOT_SELECTED'));
const mismatch = await runPlan(prepared, async () => ({ model: 'wrong', answers: {} }));
assert.ok(mismatch.cases[0].result.records.every((x) => x.status === 'EVIDENCE_INVALID' && x.noul === null));
assert.equal(mismatch.accounting.validatedCalls, 0);
const failed = await runPlan(prepared, async () => { throw new Error('private synthetic diagnostic'); });
assert.equal(JSON.stringify(failed).includes('private synthetic'), false);
assert.ok(failed.cases[0].result.records.every((x) => x.status === 'EXECUTION_ERROR'));
const deadline = await runPlan(prepared, () => { throw new Error('must not call'); }, { now: (() => { let n = 0; return () => n++ ? 60001 : 0; })() });
assert.equal(deadline.accounting.callbackAttempts, 0);
assert.ok(deadline.cases[0].result.records.every((x) => x.status === 'EXECUTION_ERROR'));
await assert.rejects(runPlan(copy(prepared), answer), /ENTRY_NOT_ADMITTED/);

// Case-outer clock reads the injected instants immediately around each whole semlint call.
const clock = (ticks) => { let i = 0; const read = () => ticks[i++]; read.reads = () => i; return read; };
const answerOnce = async (_, questions) => ({ model: JEV_MODEL, answers: Object.fromEntries(Object.keys(questions).map((key) => [key, { type: 'noul', noul: 0.3 }])) });
const oneClock = clock([1000, 1003, 1010, 1042.5]); // plan start, case start, deadline read in callback, case end
const timed = await runPlan(prepared, answerOnce, { now: oneClock });
assert.equal(oneClock.reads(), 4); assert.equal(timed.schema, 'ops.semlint.real-result.v3');
assert.equal(timed.cases[0].elapsedMs, 39.5); assert.equal(timed.cases[0].provider, null);
assert.deepEqual(Object.keys(timed.cases[0]), ['id', 'result', 'provider', 'elapsedMs']);
for (const ticks of [[0, 0, 0, NaN], [0, 10, 10, 5], [0, 0, 0, '9'], [0, 0, 0, Infinity]]) {
  await assert.rejects(runPlan(prepared, answerOnce, { now: clock(ticks) }), /ENTRY_CLOCK_INVALID/);
}

// Production wire, pinned source endpoint/model, timeout and redirect guard are exercised only by a fixture fetch.
let fixtureHttp = 0;
const ownerResult = await executeOwnerPlan(prepared, 'synthetic-only-not-a-key', async (url, options) => {
  fixtureHttp++; assert.equal(url, 'https://api.typesafe.ai/v1/systemone'); assert.equal(options.redirect, 'error');
  assert.equal(options.method, 'POST'); assert.ok(options.signal instanceof AbortSignal);
  const body = JSON.parse(options.body); assert.equal(body.model, JEV_MODEL); assert.deepEqual(body.state, input);
  return new Response(JSON.stringify({ model: JEV_MODEL,
    answers: Object.fromEntries(Object.keys(body.questions).map((key) => [key, { type: 'noul', noul: 0.2 }])) }), { status: 200 });
});
assert.equal(fixtureHttp, 1); assert.equal(ownerResult.accounting.validatedCalls, 1);
assert.equal(ownerResult.schema, 'ops.semlint.real-result.v3');
assert.ok(Number.isFinite(ownerResult.cases[0].elapsedMs) && ownerResult.cases[0].elapsedMs >= 0);
assert.ok(Number.isFinite(ownerResult.cases[0].provider.elapsedMs)); // separate native fetch observation
assert.deepEqual(ownerResult.accounting, { callbackAttempts: 1, validatedCalls: 1, providerHttpCalls: 1,
  completedHttpCalls: 1, validatedResponses: 1, unknownHttpCalls: 0, cost: null });
assert.equal(ownerResult.cases[0].provider.validatedModel, JEV_MODEL);
assert.equal(ownerResult.cases[0].provider.statusClass, 'VALIDATED_RESPONSE');
assert.match(ownerResult.cases[0].provider.responseDigest, /^[a-f0-9]{64}$/);
assert.equal(ownerResult.cases[0].provider.usage, null);

const request = await admitIssueComment(event, config);
assert.equal(request.status, 'ADMITTED'); assert.equal(request.prepared.planDigest, prepared.planDigest);
for (const altered of [
  { ...event, issue: 484 }, { ...event, action: 'edited' },
  { ...event, comment: { ...event.comment, author: 'unauthorized' } },
  { ...event, comment: { ...event.comment, body: RESULT_PREFIX + '{}' } },
  { ...event, comment: { ...event.comment, body: '/jev-evaluate' } },
  { ...event, comment: { ...event.comment, body: REQUEST_PREFIX + '{bad-json' } },
  { ...event, comment: { ...event.comment, body: REQUEST_PREFIX + JSON.stringify({ schema: 'ops.jev.issue-request.v1', cases: plan.cases, limits: config.limits }) } },
]) assert.equal((await admitIssueComment(altered, config)).status, 'NOT_ADMITTED');
assert.equal((await admitIssueComment(event, { ...config, endpoint: 'bad' })).status, 'NOT_ADMITTED');
const unpostable = Array.from({ length: 24 }, (_, i) => ({ id: `many-${i}`, input }));
const unpostableRequest = await admitIssueComment({ ...event, comment: { ...event.comment,
  body: REQUEST_PREFIX + JSON.stringify({ schema: 'ops.jev.issue-request.v1', cases: unpostable }) } }, config);
assert.equal(unpostableRequest.status, 'NOT_ADMITTED');
assert.equal(unpostableRequest.cause, 'RESULT_WOULD_EXCEED_COMMENT_CAP');
assert.equal(calls, 1);
const newRevision = await admitIssueComment({ ...event, comment: { ...event.comment, revision: 'new-revision' } }, config);
assert.notEqual(newRevision.requestDigest, request.requestDigest);
const newSource = await admitIssueComment(event, { ...config, executionSource: 'b'.repeat(40) });
assert.notEqual(newSource.requestDigest, request.requestDigest);
const editedPlan = copy(plan); editedPlan.cases[0].input.subject.revision = 'r2';
const changed = await runPlan(await preparePlan(editedPlan), async (_, questions) => ({ model: JEV_MODEL, answers: Object.fromEntries(Object.keys(questions).map((key) => [key, { type: 'noul', noul: 0.2 }])) }));
assert.throws(() => composeResultComment(request, changed), /RESULT_IDENTITY_MISMATCH/);
assert.equal(nextIssueEffect(request).effect, 'EVALUATE');
assert.equal(nextIssueEffect(request, { requestDigest: request.requestDigest, state: 'EVALUATED' }).effect, 'APPEND_EXISTING_RESULT');
assert.equal(nextIssueEffect(request, { requestDigest: request.requestDigest, state: 'APPENDED' }).effect, 'READBACK_ONLY');
for (const state of ['STARTED', 'UNKNOWN', 'FAILED', 'anything']) assert.equal(nextIssueEffect(request, { requestDigest: request.requestDigest, state }).effect, 'NONE');
assert.equal(nextIssueEffect(newRevision, { requestDigest: request.requestDigest, state: 'EVALUATED' }).effect, 'NONE');
assert.equal(nextIssueEffect(copy(request)).effect, 'NONE');
const body = composeResultComment(request, result);
const nativeBody = composeResultComment(request, ownerResult);
assert.ok(nativeBody.includes('VALIDATED_RESPONSE'));
assert.equal(nativeBody.includes('synthetic-only-not-a-key'), false);
assert.ok(body.startsWith(RESULT_PREFIX)); assert.equal(JSON.parse(body.slice(RESULT_PREFIX.length)).authority, false);
const observed = { repository: config.repository, issue: config.issue, id: 11, author: 'fixture-poster', body };
assert.equal(verifyResultReadback(request, body, observed, 'fixture-poster', 11), true);
const otherBody = composeResultComment(newRevision, result);
assert.equal(verifyResultReadback(request, otherBody, { ...observed, body: otherBody }, 'fixture-poster', 11), false);
assert.equal(verifyResultReadback(request, RESULT_PREFIX + '{}', { ...observed, body: RESULT_PREFIX + '{}' }, 'fixture-poster', 11), false);
for (const change of [{ issue: 484 }, { body: body + 'edited' }, { author: 'other' }, { id: 0 }, { id: 12 }]) assert.equal(verifyResultReadback(request, body, { ...observed, ...change }, 'fixture-poster', 11), false);
assert.equal(verifyResultReadback(request, body, observed, 'fixture-poster'), false);
const poison = copy(result); poison.cases[0].result.accounting.usage = { credential: 'private' };
assert.throws(() => composeResultComment(request, poison), /RESULT_IDENTITY_MISMATCH/);
const wrongCount = copy(result); wrongCount.cases[0].result.counts.evaluated = 0;
assert.throws(() => composeResultComment(request, wrongCount), /INVALID_RESULT_ACCOUNTING/);
const falseMissing = copy(result); falseMissing.cases[0].result.records[0].status = 'INCOMPLETE';
falseMissing.cases[0].result.records[0].noul = null;
assert.throws(() => composeResultComment(request, falseMissing), /INVALID_RESULT_RECORD/);
const extra = copy(result); extra.cases[0].result.extra = 'private';
assert.throws(() => composeResultComment(request, extra), /RESULT_IDENTITY_MISMATCH/);
const partial = copy(result); partial.cases[0].result.records[0] = { ...partial.cases[0].result.records[0], status: 'EXECUTION_ERROR', cause: 'EVALUATION_FAILED', noul: null };
partial.cases[0].result.counts.evaluated = 5;
assert.throws(() => composeResultComment(request, partial), /INVALID_RESULT_ACCOUNTING/);
const failedValidated = copy(failed); failedValidated.cases[0].result.accounting.validatedCalls = 1;
assert.throws(() => composeResultComment(request, failedValidated), /INVALID_RESULT_ACCOUNTING/);
const noSendRequest = await admitIssueComment({ ...event, comment: { ...event.comment,
  body: REQUEST_PREFIX + JSON.stringify({ schema: 'ops.jev.issue-request.v1', cases: incomplete.cases }) } }, config);
assert.ok(composeResultComment(noSendRequest, incompleteResult).includes('INCOMPLETE'));
const falseCallback = copy(incompleteResult); falseCallback.cases[0].result.accounting.callbackAttempts = 1;
assert.throws(() => composeResultComment(noSendRequest, falseCallback), /INVALID_RESULT_ACCOUNTING/);
assert.ok(composeResultComment(request, mismatch).includes('EVIDENCE_INVALID'));
assert.ok(composeResultComment(request, deadline).includes('EXECUTION_ERROR'));

// Receiver: exactly closed v2 or closed v3; current producer emits v3 only.
assert.ok(body.includes('"elapsedMs":'));
const asV2 = copy(result); asV2.schema = 'ops.semlint.real-result.v2'; delete asV2.cases[0].elapsedMs;
assert.ok(composeResultComment(request, asV2).includes('ops.semlint.real-result.v2'));
const largestClock = copy(result); largestClock.cases[0].elapsedMs = Number.MAX_VALUE;
assert.ok(Buffer.byteLength(composeResultComment(request, largestClock)) < 32768);
for (const alter of [
  (p) => { delete p.cases[0].elapsedMs; }, (p) => { p.cases[0].elapsedMs = -1; }, (p) => { p.cases[0].elapsedMs = '5'; },
  (p) => { p.cases[0].elapsedMs = null; }, (p) => { p.cases[0].clock = 1; }, (p) => { p.schema = 'ops.semlint.real-result.v4'; },
  (p) => { p.schema = 'ops.semlint.real-result.v2'; }, // v2 shape must not carry the v3 clock
]) { const poison = copy(result); alter(poison); assert.throws(() => composeResultComment(request, poison), /RESULT_IDENTITY_MISMATCH/); }
const v2Extra = copy(asV2); v2Extra.cases[0].clock = 1;
assert.throws(() => composeResultComment(request, v2Extra), /RESULT_IDENTITY_MISMATCH/);
const nonFinite = copy(result); nonFinite.cases[0].elapsedMs = NaN;
assert.throws(() => composeResultComment(request, nonFinite), /INVALID_ENTRY_INPUT/);

// Comment composer binds the exact prepared result edition/projection: semlint result.v1 and v12 only.
// Any other edition, and any v12 case carrying an English auxiliary, is refused at admission, before any paid call.
const unitRow = (row, content) => ({ ...row, content, sha256: hash(content), evaluationSpan: { startByte: 0, endByte: Buffer.byteLength(content) } });
const v5Input = { schema: 'ops.semlint.input.v5',
  subject: unitRow({ kind: 'log-entry', ref: 'fixture:v5', revision: 'r1', scope: 'fixture only' }, 'public subject, not an instruction'),
  context: [unitRow({ role: 'authorityContract', ref: 'fixture:grant', revision: 'r1' }, 'public grant text')],
  checks: [{ id: 'fixture.v5', axis: 'Aligned', concern: 'Fixture concern.', requiredRoles: ['authorityContract'], crossLinks: [],
    predicate: { question: 'Does the subject exceed the grant?', true: 'It exceeds the grant.', false: 'It stays within the grant.' } }] };
const ja = '受信記録が必要である。';
const v12Input = { ...copy(v5Input), schema: 'ops.semlint.input.v12',
  subject: { ...v5Input.subject, englishAuxiliary: null }, context: v5Input.context.map((row) => ({ ...row, englishAuxiliary: null })) };
const v12Aux = { ...copy(v12Input), subject: { ...unitRow(v12Input.subject, ja), englishAuxiliary: { text: 'A receipt record is required.', sourceSha256: hash(ja) } } };
const v12ContextAux = copy(v12Input);
v12ContextAux.context[0] = { ...unitRow(v12ContextAux.context[0], ja), englishAuxiliary: { text: 'A receipt record is required.', sourceSha256: hash(ja) } };
const editionRequest = (id, input) => admitIssueComment({ ...event, comment: { ...event.comment, id,
  body: REQUEST_PREFIX + JSON.stringify({ schema: 'ops.jev.issue-request.v1', cases: [{ id: 'one', input }] }) } }, config);
let editionFetch = 0;
const v5Admission = await editionRequest(21, v5Input);
// Pure-function admission refusal; the executor-level zero-effect proof is in tests/issue-executor.mjs.
assert.deepEqual([v5Admission.status, v5Admission.cause], ['NOT_ADMITTED', 'RESULT_EDITION_NOT_COMPOSABLE']);
for (const [id, input] of [[23, v12Aux], [24, v12ContextAux]]) {
  const refused = await editionRequest(id, input);
  assert.deepEqual([refused.status, refused.cause], ['NOT_ADMITTED', 'AUDITED_AUXILIARY_REQUIRES_OWNER_ROUTE']); }
const mixed = await admitIssueComment({ ...event, comment: { ...event.comment, id: 25, body: REQUEST_PREFIX
  + JSON.stringify({ schema: 'ops.jev.issue-request.v1', cases: [{ id: 'one', input: copy(input) }, { id: 'two', input: v12Aux }] }) } }, config);
assert.deepEqual([mixed.status, mixed.cause], ['NOT_ADMITTED', 'AUDITED_AUXILIARY_REQUIRES_OWNER_ROUTE']);
for (const [id, schema] of [[26, 'ops.semlint.input.v11'], [27, 'ops.semlint.input.v10'], [28, 'ops.semlint.input.v9']]) {
  const retired = await editionRequest(id, { ...copy(v12Input), schema });
  assert.deepEqual([retired.status, retired.cause], ['NOT_ADMITTED', 'INVALID_REQUEST_OR_ADMISSION']); }
const v12Request = await editionRequest(22, v12Input);
assert.equal(v12Request.status, 'ADMITTED'); assert.equal(v12Request.prepared.expected[0].resultSchema, 'ops.semlint.result.v12');
const v12Output = await executeOwnerPlan(v12Request.prepared, 'synthetic-only-not-a-key', async (_, init) => { editionFetch++;
  const q = JSON.parse(init.body).questions;
  return new Response(JSON.stringify({ model: JEV_MODEL, answers: Object.fromEntries(Object.keys(q).map((k) => [k, { type: 'noul', noul: 0.3 }])),
    usage: { input_tokens: 8, output_tokens: 1 } }), { status: 200 }); });
assert.equal(editionFetch, 1);
assert.ok(composeResultComment(v12Request, v12Output).includes('ops.semlint.result.v12'));
for (const alter of [(o) => { o.cases[0].result.projection.stateDigest = '0'.repeat(64); }, (o) => { delete o.cases[0].result.projection; },
  (o) => { o.cases[0].result.schema = 'ops.semlint.result.v5'; }, (o) => { o.cases[0].result.schema = 'ops.semlint.result.v1'; delete o.cases[0].result.projection; },
  (o) => { o.cases[0].result.schema = 'ops.semlint.result.v11'; }, (o) => { o.cases[0].result.extra = 1; }]) {
  const poison = copy(v12Output); alter(poison); assert.throws(() => composeResultComment(v12Request, poison), /RESULT_IDENTITY_MISMATCH/); }
const v1Spoof = copy(result); v1Spoof.cases[0].result.schema = 'ops.semlint.result.v12';
assert.throws(() => composeResultComment(request, v1Spoof), /RESULT_IDENTITY_MISMATCH/);

// Two actual fixture callbacks: valid first case, malformed later evidence. No lost case or retry.
const two = copy(plan); two.cases.push({ id: 'later', input: copy(input) });
two.cases[1].input.subject.revision = 'r-later';
let twoCalls = 0;
const twoResult = await runPlan(await preparePlan(two), async (state, questions) => {
  twoCalls++;
  assert.equal(state.subject.revision, twoCalls === 1 ? 'r1' : 'r-later');
  return twoCalls === 1 ? { model: JEV_MODEL, answers: Object.fromEntries(Object.keys(questions).map((k) => [k, { type: 'noul', noul: 0.25 }])) }
    : { model: JEV_MODEL, answers: { q0: { type: 'noul', noul: 0.9 } } };
});
assert.equal(twoCalls, 2); assert.equal(twoResult.accounting.callbackAttempts, 2);
assert.equal(twoResult.accounting.validatedCalls, 1);
assert.deepEqual(twoResult.cases.map((x) => x.id), ['normal', 'later']);
assert.ok(twoResult.cases[0].result.records.every((x) => x.status === 'OBSERVED' && x.noul === 0.25));
assert.ok(twoResult.cases[1].result.records.every((x) => x.status === 'EVIDENCE_INVALID' && x.noul === null));
const twoRequest = await admitIssueComment({ ...event, comment: { ...event.comment,
  body: REQUEST_PREFIX + JSON.stringify({ schema: 'ops.jev.issue-request.v1', cases: two.cases }) } }, config);
assert.ok(composeResultComment(twoRequest, twoResult).includes('EVIDENCE_INVALID'));
assert.throws(() => composeResultComment(request, twoResult), /RESULT_IDENTITY_MISMATCH/);

// Real executable stdin/error contract: inherited environment is not passed, no key/network fixture.
const entry = fileURLToPath(new URL('../semlint-entry.mjs', import.meta.url));
const child = spawnSync(process.execPath, [entry], { input: JSON.stringify(unselected), encoding: 'utf8', env: { LANG: 'C.UTF-8' }, timeout: 10000 });
assert.equal(child.status, 0); assert.equal(child.stderr, ''); assert.equal(JSON.parse(child.stdout).accounting.callbackAttempts, 0);
const badChild = spawnSync(process.execPath, [entry], { input: 'not json private-fixture', encoding: 'utf8', env: { LANG: 'C.UTF-8' }, timeout: 10000 });
assert.equal(badChild.status, 1); assert.equal(badChild.stderr, '');
assert.equal(JSON.parse(badChild.stdout).cause, 'INVALID_ENTRY_JSON'); assert.equal(badChild.stdout.includes('private-fixture'), false);
const compatibility = fileURLToPath(new URL('./run.mjs', import.meta.url));
const runChild = (program, args, stdin) => spawnSync(process.execPath, [program, ...args], {
  input: stdin, encoding: 'utf8', env: { LANG: 'C.UTF-8' }, timeout: 10000,
});
const normalMachine = runChild(compatibility, [], '');
assert.equal(normalMachine.status, 0); assert.equal(normalMachine.stderr, '');
assert.deepEqual(JSON.parse(normalMachine.stdout), { status: 'PASS', core: 'semantic-evaluate', ranking: 'derived',
  cli: 'json-input-jsonl-output-readback', semanticThresholds: 0, semlintCases: 37, semlintCallbacks: 19,
  realProviderCalls: 0, semanticQuality: 'NOT_PROVEN', providedCases: 29, providedCallbacks: 9, bridgeControls: 9,
  projectedControls: 22, atomicControls: 26, structuredControls: 42, choiceControls: 67, v12Controls: 49 });
for (const program of [entry, compatibility]) {
  const argv = program === entry ? [] : ['--semlint-real'];
  for (const [stdin, status, expectedSchema] of [
    [JSON.stringify(unselected), 0, 'ops.semlint.real-result.v3'],
    [JSON.stringify(plan), 0, 'ops.semlint.real-result.v3'], // key missing, no native attempt
    [JSON.stringify(bad), 1, 'ops.semlint.entry-error.v1'],
    ['private invalid json', 1, 'ops.semlint.entry-error.v1'],
  ]) {
    const observed = runChild(program, argv, stdin), value = JSON.parse(observed.stdout);
    assert.equal(observed.status, status); assert.equal(observed.stderr, ''); assert.equal(value.schema, expectedSchema);
    assert.equal(observed.stdout.includes('PASS'), false); assert.equal(observed.stdout.includes('private invalid'), false);
    if (status === 0) {
      assert.equal(value.accounting.providerHttpCalls, 0); assert.equal(value.accounting.unknownHttpCalls, 0);
      assert.equal(value.cases[0].provider.statusClass, 'NOT_RUN');
      if (stdin === JSON.stringify(plan)) assert.ok(value.cases[0].result.records.every((r) => r.status === 'EXECUTION_ERROR'));
    }
  }
}
for (const argv of [['--unknown'], ['--semlint-real', 'extra'], ['--semlint-real=true']]) {
  const refused = runChild(compatibility, argv, JSON.stringify(plan));
  assert.equal(refused.status, 1); assert.equal(refused.stderr, '');
  assert.equal(JSON.parse(refused.stdout).cause, 'INVALID_ENTRY_ARGS'); assert.equal(refused.stdout.includes('PASS'), false);
}
assert.equal(runChild(entry, ['--semlint-real'], JSON.stringify(plan)).status, 1);

// Native fetch evidence is independent of callback counters, never paid/live fixture work.
let nativeFixtures = 0;
const canary = 'PRIVATE_NATIVE_CANARY';
const keyMissing = await executeOwnerPlan(prepared, undefined, async () => { throw new Error('must not fetch'); });
assert.equal(keyMissing.accounting.callbackAttempts, 1); assert.equal(keyMissing.accounting.providerHttpCalls, 0);
assert.ok(composeResultComment(request, keyMissing).includes('EXECUTION_ERROR'));
const noSendOwner = await executeOwnerPlan(await preparePlan(incomplete), undefined, async () => { throw new Error('must not fetch'); });
assert.equal(noSendOwner.accounting.providerHttpCalls, 0); assert.equal(noSendOwner.accounting.completedHttpCalls, 0);
assert.ok(composeResultComment(noSendRequest, noSendOwner).includes('INCOMPLETE'));
for (const [mode, completed, validated, unknown] of [
  ['throw', 0, 0, 1], ['http', 1, 0, 0], ['body', 1, 0, 0], ['json', 1, 0, 0],
  ['model', 1, 0, 0], ['answers', 1, 0, 0], ['valid', 1, 1, 0],
]) {
  let reads = 0, nativeBodyText;
  const native = await executeOwnerPlan(prepared, canary, async (url, init) => {
    nativeFixtures++;
    assert.equal(url, 'https://api.typesafe.ai/v1/systemone'); assert.ok(init.signal instanceof AbortSignal);
    if (mode === 'throw') throw new Error(canary);
    const response = mode === 'json' ? canary : JSON.stringify({ model: mode === 'model' ? canary : JEV_MODEL,
      answers: mode === 'answers' ? {} : Object.fromEntries(Object.keys(JSON.parse(init.body).questions).map((k) => [k, { type: 'noul', noul: 0.4 }])),
      usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7, private: canary } });
    nativeBodyText = response;
    return { status: mode === 'http' ? 503 : 200, ok: mode !== 'http', arrayBuffer: async () => {
      reads++; if (mode === 'body') throw new Error(canary); return Buffer.from(response);
    }, json: () => { throw new Error('original json must not be consumed'); } };
  });
  const receipt = native.cases[0].provider;
  assert.equal(native.accounting.providerHttpCalls, 1); assert.equal(native.accounting.completedHttpCalls, completed);
  assert.equal(native.accounting.validatedResponses, validated); assert.equal(native.accounting.unknownHttpCalls, unknown);
  assert.equal(receipt.validatedModel, validated ? JEV_MODEL : null);
  assert.equal(reads, ['throw', 'http'].includes(mode) ? 0 : 1);
  assert.equal(receipt.responseDigest, ['throw', 'http', 'body'].includes(mode) ? null : hash(nativeBodyText));
  const comment = composeResultComment(request, native);
  assert.equal(comment.includes(canary), false); assert.equal(comment.includes('private'), false);
  assert.ok(Buffer.byteLength(comment) < 32768);
  if (validated) assert.deepEqual(receipt.usage, { input_tokens: 5, output_tokens: 2, total_tokens: 7 });
  for (const alter of [
    p => { p.cases[0].provider.extra = canary; }, p => { p.cases[0].provider.completedHttpCalls = 2; },
    p => { p.accounting.unknownHttpCalls = 99; }, p => { p.cases[0].provider.responseDigest = [hash('x')]; },
    p => { p.cases[0].provider.usage = { private: canary }; }, p => { p.cases[0].provider = null; },
  ]) { const poison = copy(native); alter(poison); assert.throws(() => composeResultComment(request, poison), /INVALID_PROVIDER_ACCOUNTING/); }
}
let laterNative = 0;
const twoNative = await executeOwnerPlan(await preparePlan(two), canary, async (_, init) => {
  laterNative++;
  return new Response(JSON.stringify({ model: JEV_MODEL,
    answers: laterNative === 1 ? Object.fromEntries(Object.keys(JSON.parse(init.body).questions).map((k) => [k, { type: 'noul', noul: 0.1 }])) : {} }), { status: 200 });
});
assert.equal(laterNative, 2); assert.equal(twoNative.accounting.providerHttpCalls, 2); assert.equal(twoNative.accounting.validatedResponses, 1);
assert.ok(composeResultComment(twoRequest, twoNative).includes('EVIDENCE_INVALID'));
const bodyTimeout = await executeOwnerPlan(await preparePlan(plan, { ...ENTRY_LIMITS, timeoutMs: 10 }), canary, async (_, init) => {
  nativeFixtures++;
  return {
  ok: true, status: 200, arrayBuffer: async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(init.signal.aborted, true); return Buffer.from('{}');
  },
  };
});
assert.equal(bodyTimeout.accounting.providerHttpCalls, 1); assert.equal(bodyTimeout.accounting.completedHttpCalls, 1);
assert.equal(bodyTimeout.accounting.validatedResponses, 0); assert.equal(bodyTimeout.cases[0].provider.responseDigest, null);
const timeoutRequest = await admitIssueComment(event, { ...config, limits: { ...ENTRY_LIMITS, timeoutMs: 10 } });
assert.ok(composeResultComment(timeoutRequest, bodyTimeout).includes('EXECUTION_ERROR'));
assert.throws(() => composeResultComment(request, bodyTimeout), /RESULT_IDENTITY_MISMATCH/); // limits are bound
let lateInvalidNative = 0;
await assert.rejects(async () => executeOwnerPlan(await preparePlan(bad), canary, async () => { lateInvalidNative++; }), /INVALID_ENTRY_SEMLINT/);
assert.equal(lateInvalidNative, 0);
const source = fs.readFileSync(entry, 'utf8');
assert.equal(/from ['"].*(?:tests|fixtures|gold)/.test(source), false);
assert.equal(source.includes('process.env.JEV_API_URL'), false);
const existingFixtureHttp = fixtureHttp + nativeFixtures + laterNative;
assert.equal(existingFixtureHttp, 11);

// Caller caps: trusted smaller limits reach and constrain the fixed owner entry.
const small = { maxCases: 2, maxCalls: 1, maxInputBytes: 65536, timeoutMs: 5000, deadlineMs: 20000 };
const pureSmall = await preparePlan(plan, small);
assert.deepEqual(copy(pureSmall.plan.limits), small); assert.notEqual(pureSmall.planDigest, prepared.planDigest);
assert.equal((await preparePlan(pureSmall.plan)).planDigest, pureSmall.planDigest); // embedded form is canonical
assert.equal((await preparePlan({ ...plan, limits: { ...ENTRY_LIMITS } })).planDigest, prepared.planDigest);
const reordered = Object.fromEntries(Object.entries(small).reverse());
assert.equal((await preparePlan({ ...plan, limits: reordered })).planDigest, pureSmall.planDigest);
await assert.rejects(preparePlan(pureSmall.plan, { ...small, maxCalls: 1, timeoutMs: 4999 }), /INVALID_ENTRY_LIMITS/);
for (const limits of [{ ...small, maxCalls: 25 }, { ...small, extra: 1 }, { maxCases: 1 }, { ...small, timeoutMs: 0 }, { ...small, deadlineMs: '1' }, null]) {
  await assert.rejects(preparePlan({ ...plan, limits }), /INVALID_ENTRY_(?:LIMITS|INPUT)/);
}
const smallRequest = await admitIssueComment(event, { ...config, limits: small });
assert.equal(smallRequest.status, 'ADMITTED');
assert.deepEqual(copy(smallRequest.prepared.plan.limits), small); assert.deepEqual(copy(smallRequest.prepared.limits), small);
assert.equal(smallRequest.prepared.planDigest, pureSmall.planDigest);
assert.notEqual(smallRequest.identity.planDigest, request.identity.planDigest);
// Issue content still cannot carry or expand limits.
assert.equal((await admitIssueComment({ ...event, comment: { ...event.comment, body: REQUEST_PREFIX
  + JSON.stringify({ schema: 'ops.jev.issue-request.v1', cases: plan.cases, limits: ENTRY_LIMITS }) } }, { ...config, limits: small })).status, 'NOT_ADMITTED');
const smallTwo = await admitIssueComment({ ...event, comment: { ...event.comment, body: REQUEST_PREFIX
  + JSON.stringify({ schema: 'ops.jev.issue-request.v1', cases: two.cases }) } }, { ...config, limits: small });
assert.equal(smallTwo.status, 'NOT_ADMITTED'); // two sendable cases exceed maxCalls 1 before any callback

// Formal owner path: unchanged programs/argv/stdin, globalThis.fetch replaced by a counting fixture.
// The fixture counts on stderr, separately from the entry's own stdout accounting.
const fakeFetch = `globalThis.fetch = async (url, init) => {
  process.stderr.write('FIXTURE_FETCH\\n');
  const body = JSON.parse(init.body);
  if (body.state.subject.ref === 'fixture:hang') {
    // Like a pending socket, keep the loop alive; AbortSignal.timeout alone does not.
    const pending = setInterval(() => {}, 1000);
    await new Promise((resolve) => init.signal.addEventListener('abort', resolve, { once: true }));
    clearInterval(pending);
    await new Promise((resolve) => setTimeout(resolve, 100));
    throw new Error('fixture aborted');
  }
  return new Response(JSON.stringify({ model: ${JSON.stringify(JEV_MODEL)},
    answers: Object.fromEntries(Object.keys(body.questions).map((k) => [k, { type: 'noul', noul: 0.3 }])) }), { status: 200 });
};`;
const importFlag = '--import=data:text/javascript,' + encodeURIComponent(fakeFetch);
const syntheticKey = 'synthetic-fixture-key-not-a-secret';
let childFixtureHttp = 0;
const ownerChild = (program, stdin) => {
  const argv = program === entry ? [] : ['--semlint-real'];
  const run = spawnSync(process.execPath, [importFlag, program, ...argv], { input: stdin, encoding: 'utf8',
    env: { LANG: 'C.UTF-8', JEV_API_KEY: syntheticKey }, timeout: 20000 });
  const fetches = run.stderr.split('\n').filter((x) => x === 'FIXTURE_FETCH').length;
  assert.equal(run.stderr.replaceAll('FIXTURE_FETCH\n', ''), '');
  assert.equal(run.stdout.includes(syntheticKey), false);
  childFixtureHttp += fetches;
  return { status: run.status, value: JSON.parse(run.stdout), fetches };
};
const hang = copy(input); hang.subject.ref = 'fixture:hang';
const deadlinePlan = { schema: 'ops.semlint.real-input.v1', limits: { ...small, maxCalls: 2, timeoutMs: 15000, deadlineMs: 300 },
  cases: [{ id: 'first', input: hang }, { id: 'second', input: copy(input) }] };
for (const program of [entry, compatibility]) {
  // Positive control: same mechanism, admitted small plan, fixture actually reached once.
  const normal = ownerChild(program, JSON.stringify(smallRequest.prepared.plan));
  assert.equal(normal.status, 0); assert.equal(normal.fetches, 1);
  assert.equal(normal.value.planDigest, smallRequest.prepared.planDigest);
  assert.deepEqual(normal.value.accounting, { callbackAttempts: 1, validatedCalls: 1, providerHttpCalls: 1,
    completedHttpCalls: 1, validatedResponses: 1, unknownHttpCalls: 0, cost: null });
  // Representative Issue -> formal invocation -> fixture result -> composition at the same limits.
  const composed = composeResultComment(smallRequest, normal.value);
  assert.ok(composed.includes('VALIDATED_RESPONSE')); assert.equal(composed.includes(syntheticKey), false);
  assert.equal(verifyResultReadback(smallRequest, composed, { repository: config.repository, issue: config.issue, id: 21,
    author: 'fixture-poster', body: composed }, 'fixture-poster', 21), true);
  // Binding: a structural-limit or one-value-different run cannot be composed into the small request.
  const structuralRun = ownerChild(program, JSON.stringify(plan));
  assert.equal(structuralRun.status, 0); assert.equal(structuralRun.fetches, 1);
  assert.throws(() => composeResultComment(smallRequest, structuralRun.value), /RESULT_IDENTITY_MISMATCH/);
  const otherTimeout = ownerChild(program, JSON.stringify({ ...plan, limits: { ...small, timeoutMs: 4000 } }));
  assert.equal(otherTimeout.status, 0);
  assert.throws(() => composeResultComment(smallRequest, otherTimeout.value), /RESULT_IDENTITY_MISMATCH/);
  assert.throws(() => composeResultComment(request, normal.value), /RESULT_IDENTITY_MISMATCH/);
  // Over-budget/invalid whole plans refuse before any fixture fetch, with the synthetic key present.
  for (const [stdin, cause] of [
    [{ ...two, limits: { ...small, maxCases: 1 } }, 'INVALID_ENTRY_PLAN'],
    [{ ...two, limits: small }, 'ENTRY_CALL_BUDGET_EXCEEDED'],
    [{ ...plan, limits: { ...small, maxInputBytes: 1000 } }, 'ENTRY_INPUT_TOO_LARGE'],
    [{ ...plan, limits: { ...small, maxCalls: 25 } }, 'INVALID_ENTRY_LIMITS'],
    [{ ...plan, limits: { ...small, extra: 1 } }, 'INVALID_ENTRY_LIMITS'],
    [{ ...plan, limits: { maxCalls: 1 } }, 'INVALID_ENTRY_LIMITS'],
    [{ ...bad, limits: { ...small, maxCalls: 2 } }, 'INVALID_ENTRY_SEMLINT'],
  ]) {
    const refused = ownerChild(program, JSON.stringify(stdin));
    assert.equal(refused.status, 1); assert.equal(refused.fetches, 0);
    assert.equal(refused.value.schema, 'ops.semlint.entry-error.v1'); assert.equal(refused.value.cause, cause);
  }
  // Smaller per-call timeout is actually applied: aborted request stays REQUEST_ERROR/unknown.
  const timed = ownerChild(program, JSON.stringify({ schema: plan.schema, limits: { ...small, timeoutMs: 50 }, cases: [{ id: 'hang', input: hang }] }));
  assert.equal(timed.status, 0); assert.equal(timed.fetches, 1);
  assert.deepEqual(timed.value.accounting, { callbackAttempts: 1, validatedCalls: 0, providerHttpCalls: 1,
    completedHttpCalls: 0, validatedResponses: 0, unknownHttpCalls: 1, cost: null });
  assert.equal(timed.value.cases[0].provider.statusClass, 'REQUEST_ERROR');
  assert.ok(timed.value.cases[0].result.records.every((x) => x.status === 'EXECUTION_ERROR' && x.noul === null));
  // Smaller whole-plan deadline: the later case is refused before its fetch.
  const late = ownerChild(program, JSON.stringify(deadlinePlan));
  assert.equal(late.status, 0); assert.equal(late.fetches, 1);
  assert.equal(late.value.accounting.providerHttpCalls, 1); assert.equal(late.value.accounting.unknownHttpCalls, 1);
  assert.equal(late.value.cases[1].provider.attemptedHttpCalls, 0); assert.equal(late.value.cases[1].provider.statusClass, 'NOT_RUN');
  assert.ok(late.value.cases[1].result.records.every((x) => x.status === 'EXECUTION_ERROR'));
}
console.log(JSON.stringify({ status: 'PASS', check: 'jev-comment-functional', realProviderCalls: 0,
  githubEffects: 0, fixtureNativeHttp: existingFixtureHttp + childFixtureHttp, existingFixtureHttp, childFixtureHttp,
  claim: 'SOURCE_FIXTURE_ONLY_NOT_REAL_ISSUE_COMPLETION' }));
