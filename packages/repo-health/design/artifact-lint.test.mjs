import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { CONCERNS, SCOPES, digest, reviewSemanticArtifact } from './artifact-lint.mjs';
import { JEV_MODEL } from '../../jev-review/core.mjs';

const done = [];
const check = async (id, fn) => { await fn(); done.push(id); };
const inputFor = (kind = 'issue', body = 'Worker emits concerns only. P alone may accept. Completion retains exact evidence.') => {
  const content = kind === 'issue' ? JSON.stringify({ title: 'Evidence-only lint', body })
    : kind === 'pr' ? JSON.stringify({ title: 'Evidence-only lint', body, baseSha: '1'.repeat(40), headSha: '2'.repeat(40) })
    : kind === 'design' ? JSON.stringify({ purpose: body, acceptance: ['retain exact evidence'], constraints: ['no authority'],
      in: ['snapshot'], out: ['evidence'], units: [{ id: 'w', kind: 'step', responsibility: 'emit concerns', in: ['snapshot'], out: ['evidence'], design: body }] })
    : body;
  return { kind, sourceRef: 'fixture:neutral-01', revision: kind === 'pr' ? '2'.repeat(40) : 'fixture-revision-1',
    scope: SCOPES[kind], content, contentSha256: digest(content), topK: 3 };
};
const reply = (questions, value = 0.5) => ({ model: JEV_MODEL, answers: Object.fromEntries(
  Object.keys(questions).map((key) => [key, { type: 'noul', noul: value }])) });
const ask = async (_, questions) => reply(questions);
const never = () => { throw new Error('MUST_NOT_CALL'); };
const verifySeal = (row) => { const { evidenceDigest, ...value } = row; assert.equal(evidenceDigest, digest(value)); };

await check('LD01-exact-source-all-kinds', async () => {
  for (const kind of Object.keys(SCOPES)) {
    const input = inputFor(kind);
    const r = await reviewSemanticArtifact(input, async (state, questions) => {
      assert.equal(state.artifact.content, input.content);
      assert.deepEqual(Object.keys(state), ['artifact']);
      assert.ok(!JSON.stringify(state).includes(input.sourceRef));
      assert.ok(!JSON.stringify(questions).includes(input.revision));
      assert.equal(Object.keys(questions).length, 6);
      return reply(questions);
    });
    assert.equal(r.execution.mode, 'injected'); assert.equal(r.execution.httpRequests, null);
    assert.equal(r.execution.status, 'OBSERVED'); assert.equal(r.execution.calls, 1);
    assert.equal(r.raw.length, 6); assert.deepEqual(r.coverage, { candidates: 6, evaluated: 6, returned: 3 });
    assert.equal(r.observedModel, JEV_MODEL); assert.deepEqual(r.structuralReference, []);
    assert.equal(r.projection.sourceBytes, r.projection.projectedBytes);
    assert.equal(r.projection.contentDigest, input.contentSha256);
    assert.equal(r.projection.sourceAuthentication, 'NOT_VERIFIED');
    assert.equal(r.projectionDigest, digest(r.request.state));
    assert.equal(r.requestDigest, digest(r.request)); assert.equal(r.responseDigest, digest(r.response));
    assert.equal(r.questionContractDigest, digest(r.questionContract)); verifySeal(r);
    assert.equal(r.comparison.status, 'UNKNOWN'); assert.equal(r.comparison.cost, null);
    assert.equal(r.authority, false); assert.equal(r.effect, false); assert.equal(r.effectAuthority, 0);
    for (const key of ['verdict', 'pass', 'accepted', 'merge', 'skip']) assert.equal(Object.hasOwn(r, key), false);
  }
});
await check('LD02-no-silent-projection-or-gold', async () => {
  const base = inputFor();
  for (const edit of [i => i.content += ' hidden contradiction', i => i.contentSha256 = 'sha256:bad',
    i => i.scope = 'summary', i => i.expected = 'valid', i => i.design = {}, i => i.sourceRef = '',
    i => i.revision = '', i => i.kind = '__proto__', i => i.topK = 1.5, i => i.topK = -1,
    i => i.topK = '3', i => i.topK = 7, i => { delete i.topK; }]) {
    const i = structuredClone(base); edit(i);
    await assert.rejects(() => reviewSemanticArtifact(i, never));
  }
  const accessor = { ...base }; Object.defineProperty(accessor, 'content', { enumerable: true, get: never });
  await assert.rejects(() => reviewSemanticArtifact(accessor, never), /INVALID_ARTIFACT_INPUT/);
  const hidden = { ...base, [Symbol('gold')]: true };
  await assert.rejects(() => reviewSemanticArtifact(hidden, never), /INVALID_ARTIFACT_INPUT/);
  const i = inputFor('pr'); i.revision = '3'.repeat(40);
  await assert.rejects(() => reviewSemanticArtifact(i, never), /INVALID_ARTIFACT_CONTENT/);
  const j = inputFor(); j.content = JSON.stringify({ title: 't', body: 'b', expected: 'defect' }); j.contentSha256 = digest(j.content);
  await assert.rejects(() => reviewSemanticArtifact(j, never), /INVALID_ARTIFACT_CONTENT/);
});
await check('LD03-empty-and-structural-are-not-artifact-verdicts', async () => {
  for (const input of [inputFor('contract', ''), inputFor('issue', ''), inputFor('issue', null)]) {
    const r = await reviewSemanticArtifact(input, ask);
    assert.deepEqual(r.structuralReference, [{ code: 'EMPTY_BODY' }]); assert.equal(r.execution.calls, 1);
  }
  const input = inputFor('design'); input.content = '{}'; input.contentSha256 = digest(input.content);
  const r = await reviewSemanticArtifact(input, ask);
  assert.equal(r.structuralReference[0].code, 'INVALID_DESIGN'); assert.equal(r.execution.calls, 1);
});
await check('LD04-disabled-and-budget-are-not-semantic-success', async () => {
  const r = await reviewSemanticArtifact({ ...inputFor(), topK: 0 }, never);
  assert.equal(r.execution.status, 'UNKNOWN'); assert.equal(r.execution.reason, 'DISABLED');
  assert.equal(r.execution.calls, 0); assert.equal(r.execution.transportInvocations, 0);
  assert.deepEqual(r.coverage, { candidates: 6, evaluated: 0, returned: 0 }); verifySeal(r);
  const large = await reviewSemanticArtifact(inputFor('contract', 'あ'.repeat(12000)), never);
  assert.equal(large.execution.reason, 'JEV_BUDGET_EXCEEDED'); assert.equal(large.execution.status, 'BLOCK');
  assert.equal(large.execution.transportInvocations, 0); assert.equal(large.raw.length, 0);
  assert.equal(large.source.content.length, 12000); // Never truncate to manufacture an evaluable artifact.
});
await check('LD05-invalid-provider-output-and-safe-errors', async () => {
  for (const edit of [r => r.model = 'other', r => delete r.answers.q0, r => r.answers.q0.noul = NaN,
    r => r.answers.q0.noul = 2, r => r.answers.q0.type = 'choice', r => r.answers.extra = { type: 'noul', noul: 1 }]) {
    const r = await reviewSemanticArtifact(inputFor(), async (_, q) => { const r = reply(q); edit(r); return r; });
    assert.equal(r.execution.status, 'UNKNOWN'); assert.equal(r.execution.calls, 0);
    assert.equal(r.coverage.evaluated, 0); assert.deepEqual(r.raw, []); assert.deepEqual(r.ranked, []);
    assert.equal(r.response, null); assert.equal(r.observedModel, null); verifySeal(r);
  }
  for (const [message, reason] of [['fake-secret-value', 'EXECUTION_FAILED'], ['JEV_HTTP_503', 'JEV_HTTP_503']]) {
    const r = await reviewSemanticArtifact(inputFor(), () => { throw Error(message); });
    assert.equal(r.execution.reason, reason); assert.equal(r.execution.status, 'UNKNOWN');
    assert.ok(!JSON.stringify(r).includes('fake-secret-value'));
  }
  const r = await reviewSemanticArtifact(inputFor(), () => { throw new DOMException('secret', 'TimeoutError'); });
  assert.equal(r.execution.reason, 'PROVIDER_TIMEOUT');
});
await check('LD06-immutable-inflight-source-and-request', async () => {
  const input = inputFor(), content = input.content;
  const result = reviewSemanticArtifact(input, async (state, questions) => {
    state.artifact.content = 'mutated'; input.content = 'mutated'; input.sourceRef = 'changed';
    const response = reply(questions); delete questions.q0; return response;
  });
  const r = await result;
  assert.equal(r.source.content, content); assert.equal(r.source.sourceRef, 'fixture:neutral-01');
  assert.equal(r.request.state.artifact.content, content); assert.equal(Object.keys(r.request.questions).length, 6); verifySeal(r);
});
await check('LD07-ranking-is-threshold-free-and-ties-are-retained', async () => {
  const r = await reviewSemanticArtifact(inputFor(), async (_, q) => ({ ...reply(q, 0), usage: { tokens: 12, cost: NaN, other: -1 } }));
  assert.equal(r.ranked[0].findings.length, 3); assert.ok(r.raw.every(v => v.noul === 0));
  assert.deepEqual(r.usage, { tokens: 12 }); assert.equal(r.comparison.status, 'UNKNOWN');
  assert.deepEqual(r.ranked[0].findings.map(v => v.subject[1]), ['acceptance', 'closure', 'contradiction']);
});
await check('LD08-cli-missing-auth-write-once-and-readback', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-d-'));
  try {
    const input = path.join(dir, 'input.json'), output = path.join(dir, 'result.jsonl');
    fs.writeFileSync(input, JSON.stringify(inputFor()));
    const env = { ...process.env };
    for (const key of ['JEV_API_KEY', 'SOPS_AGE_KEY', 'SOPS_AGE_KEY_FILE', 'SOPS_AGE_KEY_CMD']) delete env[key];
    const command = [fileURLToPath(new URL('./artifact-lint.mjs', import.meta.url)), input, output];
    const child = spawnSync(process.execPath, command, { env, encoding: 'utf8' });
    assert.equal(child.status, 1, child.stderr);
    const bytes = fs.readFileSync(output, 'utf8'), rows = bytes.trim().split('\n').map(JSON.parse);
    assert.equal(rows.length, 3); verifySeal(rows[0]); verifySeal(rows[1]); verifySeal(rows[1].result);
    assert.equal(rows[1].manifestDigest, rows[0].evidenceDigest);
    assert.equal(rows[1].result.execution.mode, 'live'); assert.equal(rows[2].status, 'BLOCK');
    assert.equal(rows[2].reason, 'JEV_API_KEY_REQUIRED'); assert.equal(rows[2].calls, 0); assert.equal(rows[2].httpRequests, 0);
    assert.equal(rows[2].evidenceDigest, rows[1].evidenceDigest);
    assert.equal(spawnSync(process.execPath, command, { env, encoding: 'utf8' }).status, 1);
    assert.equal(fs.readFileSync(output, 'utf8'), bytes);
    env.SOPS_AGE_KEY = 'fixture-secret'; command[2] = path.join(dir, 'decrypt.jsonl');
    const leak = spawnSync(process.execPath, command, { env, encoding: 'utf8' });
    assert.equal(JSON.parse(leak.stdout).reason, 'DECRYPT_CAPABILITY_LEAK');
    assert.ok(!fs.readFileSync(command[2], 'utf8').includes('fixture-secret'));
    fs.writeFileSync(input, '{invalid'); command[2] = path.join(dir, 'invalid.jsonl');
    const invalid = spawnSync(process.execPath, command, { env, encoding: 'utf8' });
    assert.equal(JSON.parse(invalid.stdout).reason, 'INVALID_ARTIFACT_INPUT');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
await check('LD09-preregistered-pair-is-data-not-quality-proof', async () => {
  const cases = fs.readFileSync(new URL('./artifact-lint.cases.jsonl', import.meta.url), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(cases.length, 2);
  const scores = [];
  for (const input of cases) {
    const r = await reviewSemanticArtifact(input, async (state, questions) => {
      assert.equal(state.artifact.content, input.content);
      assert.ok(!JSON.stringify(state).includes(input.sourceRef));
      assert.ok(!JSON.stringify(questions).includes(input.sourceRef));
      return reply(questions); // A tie is a completed execution, not a quality PASS.
    });
    assert.equal(r.execution.status, 'OBSERVED'); assert.equal(r.comparison.status, 'UNKNOWN');
    scores.push(r.raw.find(v => v.subject[1] === 'contradiction').noul);
  }
  assert.equal(scores[0], scores[1]);
});
console.log(JSON.stringify({ semanticLintShadowContract: 'PASS', tests: done, concernCandidates: CONCERNS.length, liveProviderExecuted: false }));
