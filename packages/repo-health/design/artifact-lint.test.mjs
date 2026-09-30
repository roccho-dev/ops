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
// Development declarations only. No oracle/root, automatic diagnosis or real provider.
const mockProposal = (input) => {
  const bytes = Buffer.from(input.content, 'utf8');
  const locations = ['承認はPのみ。', 'W automatically accepts.'].map((quote) => {
    const startByte = bytes.indexOf(Buffer.from(quote, 'utf8'));
    assert.ok(startByte >= 0);
    return { startByte, endByte: startByte + Buffer.byteLength(quote, 'utf8'), quote };
  });
  return { contentSha256: input.contentSha256, candidates: [{ locations, defectKind: 'authority',
    defect: 'W automatic acceptance conflicts with P-only acceptance.',
    correctionEffect: 'Replace W automatic acceptance with a request for P approval.' }] };
};
const mockArtifact = (kind = 'contract') => inputFor(kind, '承認はPのみ。\nW automatically accepts.');

await check('LD10-category-scores-never-become-defect-identities', async () => {
  for (const value of [0, 1]) {
    const r = await reviewSemanticArtifact(inputFor(), async (_, q) => reply(q, value));
    assert.equal(r.execution.status, 'OBSERVED');
    assert.deepEqual(r.findingEvidence, { status: 'UNAVAILABLE', reason: 'CATEGORY_ONLY_OUTPUT',
      proposalDigest: null, candidates: null, findings: null });
    assert.equal(r.comparison.status, 'UNKNOWN'); verifySeal(r);
  }
});
await check('LD11-explicit-findings-bind-all-source-kinds', async () => {
  for (const kind of Object.keys(SCOPES)) {
    const input = mockArtifact(kind), proposals = mockProposal(input);
    const r = await reviewSemanticArtifact(input, async (state, questions) => {
      assert.equal(state.artifact.content, input.content);
      assert.deepEqual(Object.keys(state), ['artifact']);
      assert.equal(Object.keys(questions).length, 1);
      assert.ok(questions.q0.instructions.includes(proposals.candidates[0].defect));
      assert.ok(questions.q0.instructions.includes(proposals.candidates[0].correctionEffect));
      assert.ok(!questions.q0.instructions.includes(input.sourceRef));
      return reply(questions, 0); // Even zero is retained as a scored proposal, not a verdict.
    }, proposals);
    const evidence = r.findingEvidence, finding = evidence.findings[0];
    assert.equal(evidence.status, 'SCORED_PROPOSALS');
    assert.equal(evidence.proposalDigest, digest(evidence.candidates));
    const identity = { contentSha256: input.contentSha256, scope: input.scope,
      locations: finding.locations.map(({ startByte, endByte }) => ({ startByte, endByte })),
      defectKind: finding.defectKind, correctionEffect: finding.correctionEffect };
    assert.equal(finding.id, digest({ sourceRef: input.sourceRef, revision: input.revision, ...identity }));
    assert.deepEqual(r.raw[0].subject, ['artifact', finding.id]);
    assert.deepEqual(finding.locations, proposals.candidates[0].locations);
    assert.equal(finding.noul, 0); assert.equal(finding.defect, proposals.candidates[0].defect);
    assert.deepEqual(r.coverage, { candidates: 1, evaluated: 1, returned: 1 });
    assert.equal(r.execution.mode, 'injected'); assert.equal(r.execution.calls, 1);
    assert.equal(r.authority, false); assert.equal(r.effectAuthority, 0);
    assert.equal(r.comparison.status, 'UNKNOWN'); assert.equal(r.comparison.cost, null);
    assert.equal(r.requestDigest, digest(r.request)); assert.equal(r.responseDigest, digest(r.response)); verifySeal(r);
    for (const key of ['accepted', 'referenceId', 'verdict', 'recall', 'precision']) assert.ok(!Object.hasOwn(finding, key));
  }
});
await check('LD12-proposals-reject-tamper-before-evaluation', async () => {
  const input = mockArtifact();
  for (const edit of [
    p => p.contentSha256 = 'sha256:stale', p => p.expected = true, p => p.candidates[0].id = 'invented',
    p => p.candidates[0].accepted = true, p => p.candidates[0].defect = '',
    p => p.candidates[0].defectKind = '', p => p.candidates[0].correctionEffect = '',
    p => p.candidates[0].correctionEffect = '\ud800', p => p.candidates[0].locations = [],
    p => p.candidates[0].locations[0].startByte = -1,
    p => p.candidates[0].locations[0].startByte = 0.5,
    p => p.candidates[0].locations[0].endByte = 99999,
    p => p.candidates[0].locations[0].endByte = 0,
    p => p.candidates[0].locations[0].quote = 'invented source',
    p => p.candidates[0].locations[0].startByte = 1, // Splits a UTF-8 character.
    p => p.candidates[0].locations[0].referenceId = 'hidden',
    p => p.candidates = Array(1), p => p.candidates = Array(2 ** 32 - 1), p => p.candidates.push(...Array(6).fill(p.candidates[0])),
    p => { Object.defineProperty(p.candidates[0], 'defect', { enumerable: true, get: never }); },
    p => { Object.defineProperty(p.candidates, '0', { enumerable: true, get: never }); },
    p => { p.candidates[0][Symbol('gold')] = true; },
    p => { Object.defineProperty(p.candidates[0].locations[0], 'quote', { enumerable: true, get: never }); },
    p => { p.candidates[0].locations.push({ startByte: 0, endByte: 3, quote: '承' }); },
  ]) {
    const proposals = mockProposal(input); edit(proposals);
    await assert.rejects(() => reviewSemanticArtifact(input, never, proposals), /^(Error: )?(INVALID_FINDING_PROPOSALS|FINDING_SOURCE_MISMATCH)$/);
  }
  const changed = { ...input, content: input.content + ' changed' };
  changed.contentSha256 = digest(changed.content);
  await assert.rejects(() => reviewSemanticArtifact(changed, never, mockProposal(input)), /FINDING_SOURCE_MISMATCH/);
  const invalidText = { ...input, content: input.content + '\ud800' };
  invalidText.contentSha256 = digest(invalidText.content);
  await assert.rejects(() => reviewSemanticArtifact(invalidText, never, mockProposal(invalidText)), /INVALID_FINDING_PROPOSALS/);
});
await check('LD13-dedup-and-stable-identity-without-semantic-invention', async () => {
  const input = mockArtifact(), proposals = mockProposal(input);
  const base = await reviewSemanticArtifact(input, ask, proposals);
  const duplicate = structuredClone(proposals.candidates[0]);
  duplicate.locations.reverse(); duplicate.locations.push({ ...duplicate.locations[0] });
  proposals.candidates.push(duplicate);
  const r = await reviewSemanticArtifact({ ...input, topK: 1 }, async (_, q) => reply(q, 1), proposals);
  assert.equal(r.findingEvidence.candidates.length, 1); assert.equal(r.coverage.evaluated, 1);
  assert.equal(r.findingEvidence.findings[0].id, base.findingEvidence.findings[0].id);
  assert.equal(r.findingEvidence.proposalDigest, base.findingEvidence.proposalDigest);
  proposals.candidates[1].defect = 'A different claim under the same identity';
  await assert.rejects(() => reviewSemanticArtifact(input, never, proposals), /FINDING_IDENTITY_CONFLICT/);
  for (const field of ['defectKind', 'correctionEffect']) {
    const other = mockProposal(input); other.candidates[0][field] += ' different';
    const result = await reviewSemanticArtifact(input, ask, other);
    assert.notEqual(result.findingEvidence.findings[0].id, base.findingEvidence.findings[0].id);
  }
  for (const field of ['sourceRef', 'revision']) {
    const result = await reviewSemanticArtifact({ ...input, [field]: 'another' }, ask, mockProposal(input));
    assert.notEqual(result.findingEvidence.findings[0].id, base.findingEvidence.findings[0].id);
  }
});
await check('LD14-request-ranking-and-inflight-proposals-remain-bound', async () => {
  const input = mockArtifact(), proposals = mockProposal(input);
  const other = structuredClone(proposals.candidates[0]);
  other.defectKind = 'evidence'; other.defect = 'Completion lacks an acceptance receipt.';
  other.correctionEffect = 'Require a P acceptance receipt before completion.';
  proposals.candidates.push(other);
  const before = structuredClone(proposals);
  const r = await reviewSemanticArtifact({ ...input, topK: 1 }, async (state, q) => {
    proposals.candidates[0].defect = 'mutated'; proposals.candidates[0].locations[0].quote = 'mutated';
    state.artifact.content = 'mutated';
    const response = reply(q, 0); response.answers.q1.noul = 1; delete q.q0; return response;
  }, proposals);
  assert.equal(r.coverage.evaluated, 2); assert.equal(r.coverage.returned, 1);
  const finding = r.findingEvidence.findings[0];
  assert.equal(finding.id, r.questionContract.items[1].subject[1]); assert.equal(finding.noul, 1);
  assert.ok(!JSON.stringify(r).includes('mutated')); assert.equal(r.request.state.artifact.content, input.content);
  const reverse = await reviewSemanticArtifact(input, ask, { ...before, candidates: [...before.candidates].reverse() });
  assert.equal(reverse.questionContractDigest, r.questionContractDigest);
  assert.equal(reverse.findingEvidence.proposalDigest, r.findingEvidence.proposalDigest); verifySeal(r);
});
await check('LD15-empty-disabled-budget-errors-are-not-defect-negatives', async () => {
  const input = mockArtifact();
  const empty = await reviewSemanticArtifact(input, never, { contentSha256: input.contentSha256, candidates: [] });
  const disabled = await reviewSemanticArtifact({ ...input, topK: 0 }, never, mockProposal(input));
  assert.equal(empty.execution.reason, 'NO_FINDING_PROPOSALS'); assert.equal(empty.execution.calls, 0);
  assert.equal(disabled.execution.reason, 'DISABLED'); assert.equal(disabled.execution.calls, 0);
  const oversized = mockProposal(input); oversized.candidates[0].defect = 'x'.repeat(60001);
  const budget = await reviewSemanticArtifact(input, never, oversized);
  assert.equal(budget.execution.reason, 'JEV_BUDGET_EXCEEDED'); assert.equal(budget.execution.transportInvocations, 0);
  for (const result of [empty, disabled, budget]) {
    assert.equal(result.findingEvidence.status, 'NOT_EVALUATED'); assert.equal(result.findingEvidence.findings, null);
    assert.equal(result.comparison.status, 'UNKNOWN'); verifySeal(result);
  }
  for (const callback of [
    () => { throw Error('JEV_API_KEY_REQUIRED'); },
    () => { throw new DOMException('hidden', 'TimeoutError'); },
    async (_, q) => { const r = reply(q); delete r.answers.q0; return r; },
    async (_, q) => ({ ...reply(q), model: 'wrong' }),
  ]) {
    const r = await reviewSemanticArtifact(input, callback, mockProposal(input));
    assert.notEqual(r.execution.status, 'OBSERVED'); assert.equal(r.coverage.evaluated, 0);
    assert.equal(r.findingEvidence.findings, null); assert.equal(r.findingEvidence.status, 'NOT_EVALUATED');
    assert.equal(r.comparison.status, 'UNKNOWN'); assert.equal(r.effectAuthority, 0); verifySeal(r);
  }
});

await check('LD16-no-root-input-extension-or-provider-invented-finding', async () => {
  const input = mockArtifact(), proposals = mockProposal(input);
  await assert.rejects(() => reviewSemanticArtifact({ ...input, proposals }, never), /INVALID_ARTIFACT_INPUT/);
  const r = await reviewSemanticArtifact(input, async (_, q) => {
    const response = reply(q);
    response.findings = [{ id: 'provider-invented', accepted: true }];
    response.answers.q0.finding = { id: 'provider-invented', locations: [] };
    return response;
  }, proposals);
  assert.notEqual(r.findingEvidence.findings[0].id, 'provider-invented');
  assert.deepEqual(r.findingEvidence.findings[0].locations, proposals.candidates[0].locations);
  assert.ok(!Object.hasOwn(r.findingEvidence.findings[0], 'accepted'));
  const reordered = mockProposal(input);
  reordered.candidates[0].locations = reordered.candidates[0].locations.map(({ quote, endByte, startByte }) => ({ quote, endByte, startByte }));
  const other = await reviewSemanticArtifact(input, ask, reordered);
  assert.equal(other.findingEvidence.proposalDigest, r.findingEvidence.proposalDigest);
  assert.equal(other.questionContractDigest, r.questionContractDigest);
  assert.equal(r.comparison.status, 'UNKNOWN'); verifySeal(r);
});
console.log(JSON.stringify({ semanticLintShadowContract: 'PASS', tests: done, concernCandidates: CONCERNS.length, liveProviderExecuted: false }));
