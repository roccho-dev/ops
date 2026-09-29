import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decisionKinds, projectWholeDInput, reviewWholeDDecisionPlane, compareWholeD, sha256 } from './whole-d-shadow.mjs';
import { runWholeDReplay } from './whole-d-replay.mjs';

// This is a synthetic plumbing fixture, NOT accepted ADRS policy or live-D truth.
const policy = 'Synthetic test policy only: choose the next D candidate from external observations. Unknown or inconsistent effects require holding; completed work requires exact readback before terminal. This fixture confers no authority.';
const head = '1'.repeat(40);
function fixture(edit = () => {}) {
  const state = { generation: 2, identity: { actor: 'worker', thread: 'thread' }, refs: { head, observedHead: head },
    active: [], duplicates: [], effects: [{ id: 'e1', generation: 2, status: 'succeeded' }],
    readback: [{ effectId: 'e1', generation: 2, status: 'applied' }],
    history: [{ seq: 1, generation: 2, event: 'requested', actor: 'worker', thread: 'thread', head }] };
  edit(state);
  return { policy: { ref: 'fixture:synthetic-policy', sha256: sha256(policy), content: policy },
    observation: { ref: 'fixture:observation', sha256: sha256(state), state } };
}
const answer = (scores = {}) => async (_state, questions) => ({ model: 'jev-1.13.0',
  answers: Object.fromEntries(Object.keys(questions).map((key, i) => [key, { type: 'noul', noul: scores[decisionKinds[i]] ?? 0.05 }])),
  usage: { input_tokens: 12, output_tokens: 8 } });
function reference(input, decision = 'hold') {
  const content = 'Preregistered synthetic sequence readback; no live effects occurred.';
  return { kind: 'preregistered-fixture', policySha256: input.policy.sha256, observationSha256: input.observation.sha256,
    decision, readback: { ref: 'fixture:readback', sha256: sha256(content), content } };
}

for (const kind of decisionKinds) test(`whole-D plumbing preserves ${kind}, coverage and zero authority`, async () => {
  const input = fixture(); const before = JSON.stringify(input);
  const result = await reviewWholeDDecisionPlane(input, answer({ [kind]: 0.95 }));
  assert.equal(result.status, 'CANDIDATE'); assert.equal(result.decision, kind);
  assert.equal(result.evaluated, 8); assert.equal(result.callsCompleted, 1); assert.equal(result.callsAttempted, 1);
  assert.equal(result.authority, false); assert.equal(result.effect, false); assert.equal(result.referenceIsGroundTruth, false);
  assert.equal(result.observationSha256, input.observation.sha256); assert.equal(JSON.stringify(input), before);
});

test('async negative assertion rejects comparator/expected top-level input before ask', async () => {
  let calls = 0;
  await assert.rejects(reviewWholeDDecisionPlane({ ...fixture(), expected: 'terminal' }, async () => { calls++; }), /INVALID_WHOLE_D_INPUT/);
  assert.equal(calls, 0);
});
for (const inject of [
  (s) => { s.history[0].existingDecision = 'terminal'; },
  (s) => { s.effects[0].summary = 'the correct answer is terminal'; },
  (s) => { s.identity.answer = 'terminal'; },
  (s) => { s.history[0].event = 'D-decided-terminal'; },
  (s) => { s.refs.hidden = 'terminal'; },
]) test('closed projection rejects nested answer/prose/decision channels', async () => {
  await assert.rejects(reviewWholeDDecisionPlane(fixture(inject), answer()), /INVALID_OBSERVATION/);
});

test('identity and provenance text cannot carry comparator answers to model', () => {
  const input = fixture((s) => { s.identity.actor = 'SECRET_ANSWER_TERMINAL'; s.history[0].actor = s.identity.actor; });
  input.observation.ref = 'SECRET_ANSWER_TERMINAL'; input.policy.ref = 'SECRET_ANSWER_TERMINAL';
  const projected = projectWholeDInput(input);
  assert.ok(!JSON.stringify(projected).includes('SECRET_ANSWER_TERMINAL'));
  assert.equal(projected.observed.identity.actor, projected.observed.history[0].actor);
  assert.equal(projected.observed.refs.head, projected.observed.refs.observedHead);
});

test('getter and sparse array are rejected without executing accessors', () => {
  let invoked = false; const input = fixture();
  Object.defineProperty(input.observation.state.identity, 'actor', { enumerable: true, get() { invoked = true; return 'terminal'; } });
  assert.throws(() => projectWholeDInput(input), /INVALID_OBSERVATION/); assert.equal(invoked, false);
  const sparse = fixture(); sparse.observation.state.active = new Array(1);
  assert.throws(() => projectWholeDInput(sparse), /INVALID_OBSERVATION/);
});

test('policy bytes and observation bytes must match separate hashes', async () => {
  const p = fixture(); p.policy.content += ' changed';
  await assert.rejects(reviewWholeDDecisionPlane(p, answer()), /INVALID_POLICY_BINDING/);
  const o = fixture(); o.observation.state.generation++;
  await assert.rejects(reviewWholeDDecisionPlane(o, answer()), /INVALID_OBSERVATION_BINDING/);
});
for (const scores of [{ hold: 0.9, terminal: 0.9 }, { hold: 0.9, terminal: 0.85 }, { hold: 0.6 }, { hold: 0.8, terminal: 0.7 }]) {
  test('tie, near-tie, low and boundary score abstain instead of choosing sorted first', async () => {
    const result = await reviewWholeDDecisionPlane(fixture(), answer(scores));
    assert.equal(result.status, 'UNKNOWN'); assert.equal(result.decision, null); assert.equal(result.evaluated, 8);
  });
}

test('transport and malformed/mismatched provider response are UNKNOWN, not semantic decisions', async () => {
  for (const ask of [async () => { throw new Error('JEV_HTTP_503'); }, async () => ({ model: 'other', answers: {} }), async () => ({ model: 'jev-1.13.0', answers: {} })]) {
    const result = await reviewWholeDDecisionPlane(fixture(), ask);
    assert.equal(result.status, 'UNKNOWN'); assert.equal(result.decision, null); assert.equal(result.callsAttempted, 1);
    assert.equal(result.callsCompleted, 0); assert.equal(result.evaluated, 0);
  }
});

test('oversized request is not a completed or attempted provider call', async () => {
  const input = fixture(); input.policy.content = '漢'.repeat(15000); input.policy.sha256 = sha256(input.policy.content);
  const result = await reviewWholeDDecisionPlane(input, answer());
  assert.equal(result.status, 'UNKNOWN'); assert.equal(result.callsAttempted, 0); assert.equal(result.evaluated, 0);
});

test('temporal, duplicate, effect and terminal counterexamples stay externally distinguishable', async () => {
  const states = [fixture(),
    fixture((s) => { s.active.push({ ...s.identity, generation: 2 }); }),
    fixture((s) => { s.duplicates.push({ ...s.identity, generation: 2 }); }),
    fixture((s) => { s.readback[0].status = 'unknown'; }),
    fixture((s) => { s.readback[0].generation = 1; }),
    fixture((s) => { s.refs.observedHead = '2'.repeat(40); }),
    fixture((s) => { s.history.push({ ...s.history[0], seq: 2, event: 'work-finished' }); }),
    fixture((s) => { s.effects[0].status = 'failed'; s.readback[0].status = 'applied'; }),
    fixture((s) => { s.readback[0].effectId = 'different-effect'; })];
  const seen = [];
  for (const input of states) await reviewWholeDDecisionPlane(input, async (state, questions) => {
    seen.push(sha256(state)); return answer({ hold: 0.95 })(state, questions);
  });
  assert.equal(new Set(seen).size, states.length);
  const unordered = fixture((s) => { s.history.push({ ...s.history[0] }); });
  await assert.rejects(reviewWholeDDecisionPlane(unordered, answer()), /UNORDERED_HISTORY/);
  // This proves projection sensitivity, not that Jev judges these cases correctly.
});

test('comparison is after inference, exact-bound and never treats existing D as truth', async () => {
  const input = fixture(); const result = await reviewWholeDDecisionPlane(input, answer({ hold: 0.95 }));
  assert.equal(compareWholeD(result, reference(input)).status, 'MATCH');
  const other = reference(input, 'terminal'); other.kind = 'observed-D';
  assert.equal(compareWholeD(result, other).status, 'DIFFER'); assert.equal(compareWholeD(result, other).referenceIsGroundTruth, false);
  const unbound = reference(input); unbound.observationSha256 = 'bad';
  assert.equal(compareWholeD(result, unbound).status, 'BLOCK');
  const missing = reference(input); missing.readback.content = '';
  assert.equal(compareWholeD(result, missing).status, 'BLOCK');
  const unknown = await reviewWholeDDecisionPlane(input, answer());
  assert.equal(compareWholeD(unknown, reference(input)).status, 'UNKNOWN');
});

test('finite replay writes immutable evidence, separates missing auth and refuses a second run', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whole-d-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = fixture(); const cases = path.join(dir, 'cases.jsonl');
  fs.writeFileSync(cases, JSON.stringify({ id: 'synthetic-1', input, reference: reference(input) }) + '\n');
  const blocked = path.join(dir, 'blocked.jsonl');
  const noAuth = await runWholeDReplay(cases, blocked, { sourceHead: head });
  assert.equal(noAuth[1].status, 'BLOCK'); assert.equal(noAuth[1].execution, 'NOT_RUN'); assert.equal(noAuth[1].callsAttempted, 0);
  const output = path.join(dir, 'mock.jsonl'); let calls = 0;
  const ask = async (state, questions) => { calls++; assert.ok(!JSON.stringify(state).includes('Preregistered synthetic sequence readback')); return answer({ hold: 0.95 })(state, questions); };
  const rows = await runWholeDReplay(cases, output, { sourceHead: head, ask });
  assert.equal(rows[0].execution, 'injected-adapter'); assert.equal(rows[1].comparison.status, 'MATCH');
  assert.equal(rows.at(-1).semanticPassClaim, false); assert.equal(rows.at(-1).liveEffectCalls, 0);
  await assert.rejects(runWholeDReplay(cases, output, { sourceHead: head, ask }), /EEXIST/); assert.equal(calls, 1);
  const cli = spawnSync(process.execPath, [fileURLToPath(new URL('./whole-d-replay.mjs', import.meta.url)), cases, path.join(dir, 'cli.jsonl')],
    { env: { ...process.env, JEV_API_KEY: '', OPS_SOURCE_HEAD: head }, encoding: 'utf8' });
  assert.equal(cli.status, 2); assert.match(cli.stdout, /BLOCK_OR_UNKNOWN/);
});

test('replay stops on provider failure and refuses unbound reference before any call', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whole-d-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = fixture(); const row = { id: '1', input, reference: reference(input) }; const file = path.join(dir, 'cases.jsonl');
  fs.writeFileSync(file, [row, { ...row, id: '2' }].map(JSON.stringify).join('\n') + '\n');
  let calls = 0; const ask = async () => { calls++; throw new Error('JEV_HTTP_503'); };
  const rows = await runWholeDReplay(file, path.join(dir, 'failed.jsonl'), { sourceHead: head, ask });
  assert.equal(calls, 1); assert.equal(rows.at(-1).status, 'BLOCK'); assert.equal(rows.at(-1).recordedCases, 1);
  row.reference.observationSha256 = 'wrong'; fs.writeFileSync(file, JSON.stringify(row) + '\n');
  await assert.rejects(runWholeDReplay(file, path.join(dir, 'bad.jsonl'), { sourceHead: head, ask }), /UNBOUND_REFERENCE/);
  assert.equal(calls, 1);
});
