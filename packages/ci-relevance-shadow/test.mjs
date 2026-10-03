import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { digest, MODEL, prepareWinnowRelevance, joinBoundedCiReference, runWinnowRelevance } from './winnow.mjs';

const input = () => ({ baseSha: '1'.repeat(40), headSha: '2'.repeat(40), changedPaths: ['packages/a/a.mjs'], topK: 1,
  candidates: [{ name: 'a-check', script: 'packages/a/test.mjs' }, { name: 'b-check', script: 'packages/b/test.mjs' }] });
const response = () => ({ model: MODEL, answers: { q0: { type: 'noul', noul: 0.9 }, q1: { type: 'noul', noul: 0.2 } }, usage: { input_tokens: 12 } });
const fake = (data = response()) => async (_url, request) => {
  assert.equal(request.redirect, 'error');
  assert.equal(JSON.parse(request.body).model, MODEL);
  return { ok: true, json: async () => data };
};
const shadow = () => runWinnowRelevance(input(), { fetchImpl: fake() });
const reference = () => ({ headSha: input().headSha, checks: ['a-check', 'b-check'].map((name, index) => ({
  name, command: input().candidates[index].script, status: 'completed', conclusion: index ? 'failure' : 'success', durationMs: 10 + index,
  sourceSha: input().headSha, sourceReadback: `fixture:source-readback/${name}`,
})) });

test('bounded pairing retains identity, observed omitted failure and UNKNOWN value', async () => {
  const s = await shadow(), r = reference(), paired = joinBoundedCiReference(s, r);
  assert.deepEqual(s.wouldSelect, ['a-check']); assert.deepEqual(s.wouldOmit, ['b-check']);
  assert.equal(s.executionKind, 'injected-transport'); assert.equal(s.responseSha256, digest(s.response));
  assert.deepEqual(paired.observedOmittedFailures, ['b-check']); assert.equal(paired.referenceMeasuredDurationMs, 21);
  assert.equal(paired.schema, 'ops.winnowCiRelevanceJoin.v2');
  assert.equal(paired.referenceKind, 'bounded-ci-replay');
  assert.deepEqual(paired.referenceUniverse, input().candidates);
  assert.deepEqual(paired.referenceObservedFailures, ['b-check']);
  assert.ok(!Object.keys(paired).some((key) => key.startsWith('fullCi')));
  assert.equal(paired.result, 'UNKNOWN'); assert.equal(paired.observation, 'PAIRED');
  for (const packet of [s, paired]) { assert.equal(packet.authority, false); assert.equal(packet.effect, false); assert.equal(packet.referenceIsGroundTruth, false); }
});

for (const [name, mutate, expected] of [
  ['overclaimed full CI', r => { r.referenceKind = 'full-ci'; }, /SCOPE_MISMATCH/],
  ['same name wrong command', r => { r.checks[1].command = 'other command'; }, /COMMAND_MISMATCH/],
  ['missing command', r => { delete r.checks[1].command; }, /COMMAND_MISMATCH/],
  ['wrong head', r => { r.headSha = '3'.repeat(40); }, /REFERENCE_MISMATCH/],
  ['missing check', r => { r.checks.pop(); }, /INCOMPLETE/],
  ['extra unrelated check', r => { r.checks.push({ ...r.checks[0], name: 'unrelated' }); }, /INCOMPLETE/],
  ['duplicate check', r => { r.checks[1].name = r.checks[0].name; }, /INCOMPLETE/],
  ['null row', r => { r.checks[1] = null; }, /INCOMPLETE/],
  ['merge-state checkout', r => { r.checks[1].sourceSha = '3'.repeat(40); }, /SOURCE_UNVERIFIED/],
  ['missing checkout readback', r => { delete r.checks[0].sourceReadback; }, /SOURCE_UNVERIFIED/],
  ...['cancelled', 'timed_out', 'skipped', 'neutral', 'action_required', null, undefined, 'invented'].map(conclusion => [
    `non-result ${conclusion}`, r => { r.checks[1].conclusion = conclusion; }, /NOT_EXECUTED/]),
  ['unfinished status', r => { r.checks[1].status = 'in_progress'; }, /NOT_EXECUTED/],
  ...[undefined, null, '10', -1, NaN, Infinity].map(duration => [
    `unknown duration ${duration}`, r => { r.checks[1].durationMs = duration; }, /DURATION_UNKNOWN/]),
]) test(`reject reference: ${name}`, async () => { const s = await shadow(), r = reference(); mutate(r); assert.throws(() => joinBoundedCiReference(s, r), expected); });

for (const [name, mutate] of [
  ['forged selection', s => { s.wouldSelect = ['not-a-candidate']; }],
  ['duplicate selection', s => { s.wouldSelect = ['a-check', 'a-check']; }],
  ['forged omissions', s => { s.wouldOmit = []; }],
  ['changed ranking', s => { s.ranked.reverse(); }],
  ['changed candidate list', s => { s.candidates.reverse(); }],
  ['changed input', s => { s.input.changedPaths.push('other'); }],
  ['changed request', s => { s.request.state.changedPaths.push('other'); }],
  ['changed response', s => { s.response.answers.q0.noul = 0.1; }],
  ['authority escalation', s => { s.authority = true; }],
  ['effect escalation', s => { s.effect = true; }],
  ['reference as oracle', s => { s.referenceIsGroundTruth = true; }],
  ['coverage inflation', s => { s.coverage.requests = 100; }],
  ['invented provider', s => { s.observedModel = 'other'; }],
]) test(`reject altered shadow: ${name}`, async () => { const s = await shadow(); mutate(s); assert.throws(() => joinBoundedCiReference(s, reference())); });

for (const [name, mutate] of [
  ['missing answer', r => { delete r.answers.q1; }],
  ['extra answer', r => { r.answers.q2 = r.answers.q0; }],
  ['missing model', r => { delete r.model; }],
  ['wrong model', r => { r.model = 'another-model'; }],
  ['wrong type', r => { r.answers.q0.type = 'boolean'; }],
  ...[-0.1, 1.1, NaN, Infinity, '0.5', null].map(value => [`invalid score ${value}`, r => { r.answers.q0.noul = value; }]),
]) test(`reject provider: ${name}`, async () => { const r = response(); mutate(r); await assert.rejects(runWinnowRelevance(input(), { fetchImpl: fake(r) }), /INVALID_WINNOW_RESPONSE/); });

test('input is copied before await, and CI outcomes never reach provider', async () => {
  const i = input(); i.privateReference = { gold: 'never leak', conclusion: 'failure' };
  const s = await runWinnowRelevance(i, { fetchImpl: async (_url, request) => {
    assert.ok(!request.body.includes('never leak')); assert.ok(!request.body.includes('conclusion'));
    i.changedPaths.push('mutated-during-fetch'); i.candidates.reverse();
    return { ok: true, json: async () => response() };
  } });
  assert.deepEqual(s.changedPaths, ['packages/a/a.mjs']); assert.equal(s.candidates[0], 'a-check');
});

test('lexical tie break is deterministic, not confidence', async () => {
  const r = response(); r.answers.q1.noul = r.answers.q0.noul;
  const s = await runWinnowRelevance(input(), { fetchImpl: fake(r) });
  assert.deepEqual(s.wouldSelect, ['a-check']);
});

test('invalid inputs and budget fail before any provider request', async () => {
  let calls = 0; const fetchImpl = async () => { calls++; throw new Error('unreachable'); };
  for (const mutate of [i => { i.baseSha = 'main'; }, i => { i.changedPaths.push(i.changedPaths[0]); },
    i => { i.candidates[1].name = i.candidates[0].name; }, i => { i.topK = 0; },
    i => { i.candidates[0].script = 'x'.repeat(32768); }]) {
    const i = input(); mutate(i); await assert.rejects(runWinnowRelevance(i, { fetchImpl }));
  }
  await assert.rejects(runWinnowRelevance(input(), { fetchImpl, model: 'other' }), /INVALID_WINNOW_CONFIG/);
  assert.equal(calls, 0);
});

test('HTTP, parse and transport failures remain errors, never fabricated scores', async () => {
  await assert.rejects(runWinnowRelevance(input(), { fetchImpl: async () => ({ ok: false, status: 503 }) }), /WINNOW_HTTP_503/);
  await assert.rejects(runWinnowRelevance(input(), { fetchImpl: async () => ({ ok: true, json: async () => { throw new Error('bad json'); } }) }), /INVALID_WINNOW_JSON/);
  await assert.rejects(runWinnowRelevance(input(), { fetchImpl: async () => { throw new Error('timeout'); } }), /timeout/);
});


test('bounded reference survives row reordering, without a legacy full-CI API alias', async () => {
  const s = await shadow(), r = reference(); r.checks.reverse();
  const paired = joinBoundedCiReference(s, r);
  assert.deepEqual(paired.referenceUniverse, input().candidates);
  assert.equal((await import('./winnow.mjs')).joinFullCiReference, undefined);
  s.input.candidates[0].script = 'mutated after join';
  assert.deepEqual(paired.referenceUniverse, input().candidates);
});

test('preregistered terminal readback remains UNKNOWN, without another provider call', () => {
  const [receipt, ...members] = readFileSync(new URL('./raws.jsonl', import.meta.url), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(receipt.runId, 36566120584); assert.equal(receipt.runAttempt, 1);
  assert.equal(receipt.artifactId, 11032653624); assert.equal(receipt.jobConclusion, 'failure');
  assert.equal(receipt.result, 'UNKNOWN'); assert.equal(receipt.pairAdmissible, false);
  assert.equal(receipt.referenceKind, 'bounded-ci-replay'); assert.equal(receipt.broaderLaneA, 'UNFINISHED');
  const files = Object.fromEntries(members.map((member) => {
    assert.equal(createHash('sha256').update(member.content).digest('hex'), receipt.memberSha256[member.file]);
    return [member.file, JSON.parse(member.content)];
  }));
  const report = files['report.json'], r = files['reference.json'], s = files['shadow.json'];
  assert.equal(report.schema, 'ops.winnowCiRelevanceProof.v1'); // Preserve the original bytes, not a new run.
  assert.equal(report.reason, 'REFERENCE_NOT_EXECUTED'); assert.equal(report.result, 'UNKNOWN');
  assert.equal(report.providerAttempts, 1); assert.equal(report.attemptedReferenceChecks, 2); assert.equal(report.completedReferenceChecks, 1);
  assert.equal(report.authority, false); assert.equal(report.effect, false);
  assert.equal(s.headSha, receipt.headSha); assert.equal(r.headSha, receipt.headSha);
  assert.deepEqual(s.input, files['input.json']); assert.deepEqual(r.source, files['source.json']);
  assert.equal(r.sourceSha256, digest(r.source));
  assert.equal(s.inputSha256, digest(s.input)); assert.equal(s.requestSha256, digest(s.request)); assert.equal(s.responseSha256, digest(s.response));
  assert.equal(report.provider.observedModel, s.observedModel);
  assert.equal(r.checks[0].conclusion, 'success'); assert.equal(r.checks[1].conclusion, 'timed_out');
  assert.equal(r.checks[1].exitCode, 124);
  for (const row of r.checks) assert.equal(row.logSha256, receipt.memberSha256[`${row.name}.log`]);
  assert.ok(!('paired.json' in receipt.memberSha256));
  // Applying the corrected pure join to the SAME retained reference must still reject it.
  assert.throws(() => joinBoundedCiReference(s, r), /REFERENCE_NOT_EXECUTED/);
});

// Development mocks only: no retired root, prospective case, oracle or provider execution.
const detachedInput = () => ({ ...input(), treeSha: '4'.repeat(40),
  patches: [{ filename: 'packages/a/a.mjs', patch: '@@ -1 +1 @@\n-before\n+after\n' }],
  beforeFacts: null,
  candidates: [{ id: 'mock-workflow-a/job-test', name: 'test' }, { id: 'mock-workflow-b/job-test', name: 'test' }],
});
const detachedReference = i => ({ headSha: i.headSha, treeSha: i.treeSha,
  checks: i.candidates.map(c => ({ name: c.id, command: c.script, status: 'completed', conclusion: 'success',
    sourceSha: i.headSha, sourceTreeSha: i.treeSha, sourceReadback: 'development fixture only', durationMs: 1 })),
});

test('detached preparation preserves all identities, exact patches and explicit unknown facts without transport', () => {
  const i = detachedInput(); i.candidates.push({ id: 'mock-workflow-c/job-test', name: 'test' });
  i.patches[0].patch += '+ 日本語 \r\n';
  const original = structuredClone(i), prepared = prepareWinnowRelevance(i);
  assert.deepEqual(prepared.input, original);
  assert.deepEqual(prepared.request.state.candidates, original.candidates);
  assert.deepEqual(prepared.request.state.patches, original.patches);
  assert.equal(prepared.request.state.treeSha, i.treeSha); assert.equal(prepared.request.state.beforeFacts, null);
  assert.equal(Object.keys(prepared.request.questions).length, 3);
  assert.equal(prepared.inputSha256, digest(i)); assert.equal(prepared.requestSha256, digest(prepared.request));
  assert.equal(prepared.requestBytes, Buffer.byteLength(prepared.requestBody));
  assert.ok(prepared.request.state.candidates.every(c => !Object.hasOwn(c, 'script')));
  i.candidates.reverse(); i.patches[0].patch = 'changed after preparation';
  assert.deepEqual(prepared.input, original); assert.deepEqual(prepared.request.state.patches, original.patches);
});

test('identity-only mock scoring uses ids rather than duplicate labels and never invents commands', async () => {
  const i = detachedInput(), s = await runWinnowRelevance(i, { fetchImpl: fake() });
  assert.deepEqual(s.candidates, i.candidates.map(c => c.id));
  assert.deepEqual(s.wouldSelect, [i.candidates[0].id]); assert.deepEqual(s.wouldOmit, [i.candidates[1].id]);
  assert.equal(s.treeSha, i.treeSha); assert.equal(s.executionKind, 'injected-transport');
  assert.equal(s.authority, false); assert.equal(s.effect, false);
  // Missing declared commands must not pass via undefined === undefined.
  assert.throws(() => joinBoundedCiReference(s, detachedReference(i)), /REFERENCE_COMMAND_UNAVAILABLE/);
});

test('prepared and scored requests use one serialization path', async () => {
  const i = detachedInput(); i.beforeFacts = 'frozen mock pre-change fact';
  const p = prepareWinnowRelevance(i);
  assert.equal(p.request.state.beforeFacts, i.beforeFacts);
  const s = await runWinnowRelevance(i, { fetchImpl: async (_url, request) => {
    assert.equal(request.body, p.requestBody);
    return { ok: true, json: async () => response() };
  } });
  assert.equal(s.requestSha256, p.requestSha256); assert.equal(s.inputSha256, p.inputSha256);
});

for (const [name, mutate, error] of [
  ['missing tree', i => { delete i.treeSha; }, /INVALID_DETACHED_INPUT/],
  ['branch instead of tree', i => { i.treeSha = 'main'; }, /INVALID_DETACHED_INPUT/],
  ['missing patch', i => { delete i.patches; }, /INVALID_DETACHED_INPUT/],
  ['path mismatch', i => { i.patches[0].filename = 'different'; }, /INVALID_DETACHED_INPUT/],
  ['duplicate patch', i => { i.patches.push(i.patches[0]); }, /INVALID_DETACHED_INPUT/],
  ['unknown facts omitted', i => { delete i.beforeFacts; }, /INVALID_DETACHED_INPUT/],
  ['reference accidentally supplied', i => { i.reference = { conclusion: 'failure' }; }, /INVALID_DETACHED_INPUT/],
  ['outcome in candidate', i => { i.candidates[0].conclusion = 'success'; }, /INVALID_DETACHED_INPUT/],
  ['duplicate identity', i => { i.candidates[1].id = i.candidates[0].id; }, /INVALID_DETACHED_INPUT/],
  ['identity missing', i => { delete i.candidates[0].id; }, /INVALID_DETACHED_INPUT/],
  ['blank declared command', i => { i.candidates[0].script = ' '; }, /INVALID_DETACHED_INPUT/],
  ['inferred topK prohibited', i => { delete i.topK; }, /INVALID_RELEVANCE_INPUT/],
  ['out of budget patch', i => { i.patches[0].patch = 'x'.repeat(32768); }, /WINNOW_INPUT_BUDGET_EXCEEDED/],
]) test(`detached fail before transport: ${name}`, async () => {
  const i = detachedInput(); mutate(i); let calls = 0;
  assert.throws(() => prepareWinnowRelevance(i), error);
  await assert.rejects(runWinnowRelevance(i, { fetchImpl: async () => { calls++; throw new Error('unexpected transport'); } }), error);
  assert.equal(calls, 0);
});

test('entire supplied candidate universe stays bounded, without silent truncation to legacy two', () => {
  const i = detachedInput(); i.candidates = Array.from({ length: 64 }, (_, k) => ({ id: `mock-${k}`, name: 'test' }));
  assert.equal(prepareWinnowRelevance(i).request.state.candidates.length, 64);
  i.candidates.push({ id: 'mock-65', name: 'test' });
  assert.throws(() => prepareWinnowRelevance(i), /INVALID_RELEVANCE_INPUT/);
});

test('detached bounded join binds ids, commands and tree without claiming full-CI completion', async () => {
  const i = detachedInput(); for (const c of i.candidates) c.script = `test ${c.id}`;
  const s = await runWinnowRelevance(i, { fetchImpl: fake() }), r = detachedReference(i);
  const paired = joinBoundedCiReference(s, r);
  assert.deepEqual(paired.referenceUniverse, i.candidates); assert.equal(paired.treeSha, i.treeSha);
  assert.equal(paired.result, 'UNKNOWN'); assert.equal(paired.referenceKind, 'bounded-ci-replay');
  assert.equal(paired.authority, false); assert.equal(paired.effect, false);
  for (const mutate of [r => { r.treeSha = '5'.repeat(40); }, r => { delete r.checks[0].sourceTreeSha; },
    r => { r.checks[0].command = 'other'; }, r => { r.checks.pop(); },
    r => { r.checks[0].name = 'test'; }, r => { r.checks[0].conclusion = 'timed_out'; }]) {
    const altered = structuredClone(r); mutate(altered); assert.throws(() => joinBoundedCiReference(s, altered));
  }
  for (const mutate of [s => { s.treeSha = '5'.repeat(40); }, s => { s.input.patches[0].patch = 'changed'; },
    s => { s.input.beforeFacts = 'changed'; }, s => { s.input.candidates[0].id = 'changed'; }]) {
    const altered = structuredClone(s); mutate(altered); assert.throws(() => joinBoundedCiReference(altered, r));
  }
});
