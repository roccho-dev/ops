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

// Production wire, pinned source endpoint/model, timeout and redirect guard are exercised only by a fixture fetch.
let fixtureHttp = 0;
const ownerResult = await executeOwnerPlan(prepared, 'synthetic-only-not-a-key', async (url, options) => {
  fixtureHttp++; assert.equal(url, 'https://api.typesafe.ai/v1/systemone'); assert.equal(options.redirect, 'error');
  assert.equal(options.method, 'POST'); assert.ok(options.signal instanceof AbortSignal);
  const body = JSON.parse(options.body); assert.equal(body.model, JEV_MODEL); assert.deepEqual(body.state, input);
  return { ok: true, json: async () => ({ model: JEV_MODEL, answers: Object.fromEntries(Object.keys(body.questions).map((key) => [key, { type: 'noul', noul: 0.2 }])) }) };
});
assert.equal(fixtureHttp, 1); assert.equal(ownerResult.accounting.validatedCalls, 1);

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
assert.ok(composeResultComment(request, mismatch).includes('EVIDENCE_INVALID'));
assert.ok(composeResultComment(request, deadline).includes('EXECUTION_ERROR'));

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
const source = fs.readFileSync(entry, 'utf8');
assert.equal(/from ['"].*(?:tests|fixtures|gold)/.test(source), false);
assert.equal(source.includes('process.env.JEV_API_URL'), false);
console.log(JSON.stringify({ status: 'PASS', check: 'jev-comment-functional', realProviderCalls: 0,
  githubEffects: 0, fixtureNativeHttp: fixtureHttp, claim: 'SOURCE_FIXTURE_ONLY_NOT_REAL_ISSUE_COMPLETION' }));
