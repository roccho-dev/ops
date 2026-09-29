import assert from 'node:assert/strict';
import { test } from 'node:test';
import { digest, MODEL, joinFullCiReference, runWinnowRelevance } from './winnow.mjs';

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
  name, status: 'completed', conclusion: index ? 'failure' : 'success', durationMs: 10 + index,
  sourceSha: input().headSha, sourceReadback: `fixture:source-readback/${name}`,
})) });

test('bounded pairing retains identity, observed omitted failure and UNKNOWN value', async () => {
  const s = await shadow(), r = reference(), paired = joinFullCiReference(s, r);
  assert.deepEqual(s.wouldSelect, ['a-check']); assert.deepEqual(s.wouldOmit, ['b-check']);
  assert.equal(s.executionKind, 'injected-transport'); assert.equal(s.responseSha256, digest(s.response));
  assert.deepEqual(paired.observedOmittedFailures, ['b-check']); assert.equal(paired.fullCiMeasuredDurationMs, 21);
  assert.equal(paired.result, 'UNKNOWN'); assert.equal(paired.observation, 'PAIRED');
  for (const packet of [s, paired]) { assert.equal(packet.authority, false); assert.equal(packet.effect, false); assert.equal(packet.referenceIsGroundTruth, false); }
});

for (const [name, mutate, expected] of [
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
]) test(`reject reference: ${name}`, async () => { const s = await shadow(), r = reference(); mutate(r); assert.throws(() => joinFullCiReference(s, r), expected); });

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
]) test(`reject altered shadow: ${name}`, async () => { const s = await shadow(); mutate(s); assert.throws(() => joinFullCiReference(s, reference())); });

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
