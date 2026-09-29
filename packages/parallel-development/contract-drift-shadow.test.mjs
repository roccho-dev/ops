import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JEV_MODEL } from '../jev-review/core.mjs';
import { askJev } from '../jev-review/jev.mjs';
import { PHASES } from './phases.mjs';
import { driftDigest, reviewContractDrift, writeDriftProof } from './contract-drift-shadow.mjs';

// Synthetic contract/projection; never accepted-source or real-provider evidence.
const input = {
  contractRef: 'fixture://contract/1', acceptanceRef: 'fixture://acceptance/1',
  changeRef: `https://github.com/roccho-dev/ops/compare/${'1'.repeat(40)}...${'2'.repeat(40)}`,
  contract: { id: 'a', goal: 'emit one receipt', scope: ['packages/a'], in: ['x'], out: ['receipt'], acceptance: ['receipt exists'] },
  related: [],
  change: { id: 'head', changed_scope: ['packages/a'], implementation: 'emit receipt', outputs: ['receipt'], evidence: ['test'] },
};
const inputText = JSON.stringify(input);
const digest = driftDigest(inputText);
const answer = (questions, score = 0.5) => ({ model: JEV_MODEL,
  answers: Object.fromEntries(Object.keys(questions).map((key) => [key, { type: 'noul', noul: score }])),
  usage: { input_tokens: 17, output_tokens: 6, invalid: -1 },
});
const passed = [];
async function check(name, fn) { await fn(); passed.push(name); }
const stub = async (_state, questions) => answer(questions);

await check('all six themes / exact exchange / non-authority', async () => {
  const result = await reviewContractDrift(inputText, digest, stub);
  assert.equal(result.status, 'OBSERVED');
  assert.equal(result.askInvocations, 1);
  assert.equal(result.observedResponses, 1);
  assert.equal(result.observedModel, JEV_MODEL);
  assert.equal(result.inputText, inputText);
  assert.equal(result.inputDigest, digest);
  assert.equal(result.stateDigest, driftDigest(JSON.stringify(result.exchange.request.state)));
  assert.equal(result.exchange.requestDigest, driftDigest(JSON.stringify(result.exchange.request)));
  assert.equal(result.exchange.responseDigest, driftDigest(JSON.stringify(result.exchange.response)));
  assert.deepEqual(result.coverage, PHASES.pr.map(([theme]) => ({ theme, candidates: 1, evaluated: 1 })));
  assert.deepEqual(result.usage, { input_tokens: 17, output_tokens: 6 });
  for (const key of ['authority', 'effect', 'hardAuthority', 'referenceIsGroundTruth']) assert.equal(result[key], false);
  for (const key of ['merge', 'verdict', 'skip', 'violation', 'approved']) assert.equal(Object.hasOwn(result, key), false);
  assert.equal(result.sourceReadback, 'NOT_VERIFIED_BY_ADAPTER');
  assert.equal(result.comparison, 'NOT_RUN');
  assert.equal(result.downstreamEffect, 'UNMEASURED');
  assert.ok(result.elapsedMs >= 0);
});

for (const key of ['contractRef', 'acceptanceRef', 'changeRef', 'contract', 'change', 'related']) {
  await check(`tampered ${key} rejected before ask`, async () => {
    const altered = structuredClone(input); altered[key] = 'changed';
    let calls = 0;
    const result = await reviewContractDrift(JSON.stringify(altered), digest, async () => { calls++; });
    assert.equal(result.status, 'BLOCK');
    assert.equal(result.reason, 'INPUT_DIGEST_MISMATCH');
    assert.equal(calls, 0);
  });
}
await check('missing digest / whitespace change rejected', async () => {
  for (const [bytes, expected] of [[inputText, undefined], [inputText + '\n', digest]]) {
    const result = await reviewContractDrift(bytes, expected, stub);
    assert.equal(result.status, 'BLOCK'); assert.equal(result.reason, 'INPUT_DIGEST_MISMATCH');
  }
});
await check('invalid envelopes and omitted acceptance cannot be defaulted', async () => {
  const variants = [null, [], { ...input, related: null }, { ...input, acceptanceRef: '' },
    { ...input, expected: 'clean' }, { ...input, changeRef: 'https://github.com/roccho-dev/ops/compare/main...topic' },
    { ...input, contract: { ...input.contract, out: [] } }];
  const missing = structuredClone(input); delete missing.related; variants.push(missing);
  for (const value of variants) {
    const bytes = JSON.stringify(value);
    const result = await reviewContractDrift(bytes, driftDigest(bytes), async () => { throw new Error('MUST_NOT_CALL'); });
    assert.equal(result.status, 'BLOCK'); assert.equal(result.askInvocations, 0);
    assert.ok(result.coverage.every((row) => row.candidates === 0 && row.evaluated === 0));
  }
  const result = await reviewContractDrift('{', driftDigest('{'), stub);
  assert.equal(result.reason, 'INVALID_CONTRACT_DRIFT_INPUT');
});
await check('no provider is UNKNOWN, not clean', async () => {
  const result = await reviewContractDrift(inputText, digest);
  assert.equal(result.status, 'UNKNOWN'); assert.equal(result.reason, 'PROVIDER_NOT_RUN');
  assert.equal(result.askInvocations, 0); assert.equal(result.observedResponses, 0);
  assert.deepEqual(result.ranked, []); assert.ok(result.coverage.every((row) => row.evaluated === 0));
});
await check('model mismatch and incomplete or invalid answers remain UNKNOWN', async () => {
  const variants = [
    (q) => ({ ...answer(q), model: 'other-model' }),
    (q) => { const result = answer(q); delete result.answers.q5; return result; },
    (q) => { const result = answer(q); result.answers.extra = { type: 'noul', noul: 0.5 }; return result; },
    (q) => answer(q, NaN), (q) => answer(q, 1.1), (q) => answer(q, -0.1),
  ];
  for (const variant of variants) {
    const result = await reviewContractDrift(inputText, digest, async (_s, q) => variant(q));
    assert.equal(result.status, 'UNKNOWN'); assert.equal(result.askInvocations, 1);
    assert.equal(result.observedResponses, 0); assert.deepEqual(result.ranked, []);
    assert.equal(result.exchange.response, null);
  }
});
await check('provider errors are sanitized and never semantic negatives', async () => {
  for (const message of ['JEV_HTTP_429', 'Authorization: Bearer should-never-be-recorded']) {
    const result = await reviewContractDrift(inputText, digest, async () => { throw new Error(message); });
    assert.equal(result.status, 'UNKNOWN'); assert.equal(result.reason, message === 'JEV_HTTP_429' ? message : 'EXECUTION_FAILED');
    assert.ok(!JSON.stringify(result).includes('should-never-be-recorded'));
  }
});
await check('budget stops before ask; no silent truncation', async () => {
  const large = structuredClone(input); large.change.implementation = 'x'.repeat(29000);
  const bytes = JSON.stringify(large), result = await reviewContractDrift(bytes, driftDigest(bytes), stub);
  assert.equal(result.status, 'UNKNOWN'); assert.equal(result.reason, 'INPUT_BUDGET_EXCEEDED');
  assert.equal(result.askInvocations, 0); assert.equal(result.exchange, null);
});
await check('zero and one scores are observations, never gates', async () => {
  for (const score of [0, 1]) {
    const result = await reviewContractDrift(inputText, digest, async (_s, q) => answer(q, score));
    assert.equal(result.status, 'OBSERVED'); assert.ok(result.ranked.every((row) => row.findings[0].noul === score));
    assert.equal(result.effect, false); assert.equal(result.comparison, 'NOT_RUN');
  }
});
await check('injected ask cannot mutate retained request or caller input', async () => {
  const result = await reviewContractDrift(inputText, digest, async (state, questions) => {
    state.cut.goal = 'mutated'; const response = answer(questions); questions.q0.instructions = 'mutated'; return response;
  });
  assert.equal(result.status, 'OBSERVED');
  assert.equal(result.exchange.request.state.cut.goal, input.contract.goal);
  assert.notEqual(result.exchange.request.questions.q0.instructions, 'mutated');
  assert.equal(JSON.stringify(input), inputText);
});
await check('shared askJev serializes the exact retained request', async () => {
  let sent;
  const result = await reviewContractDrift(inputText, digest, (state, questions) => askJev(state, questions, {
    key: 'fixture-key', endpoint: 'https://example.invalid/systemone', timeoutMs: 15000,
    fetchImpl: async (_url, options) => { sent = options.body; return { ok: true, json: async () => answer(questions) }; },
  }));
  assert.equal(result.status, 'OBSERVED');
  assert.equal(result.exchange.requestDigest, driftDigest(sent));
  assert.ok(!JSON.stringify(result).includes('fixture-key'));
});
await check('write-once report, missing auth, decrypt leak, CLI readback', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-drift-'));
  try {
    const source = path.join(dir, 'input.json'), out = path.join(dir, 'report.jsonl'); fs.writeFileSync(source, inputText);
    const result = await writeDriftProof(source, digest, out, {});
    assert.equal(result.status, 'UNKNOWN'); assert.equal(result.reason, 'PROVIDER_NOT_RUN');
    const original = fs.readFileSync(out, 'utf8'), rows = original.trim().split('\n').map(JSON.parse);
    assert.equal(rows.length, 2); assert.equal(rows[0].effectAuthority, 0);
    assert.equal(rows[1].inputDigest, digest); assert.equal(rows[1].askInvocations, 0);
    await assert.rejects(writeDriftProof(source, digest, out, {}), { code: 'EEXIST' });
    assert.equal(fs.readFileSync(out, 'utf8'), original);
    const leak = await writeDriftProof(source, digest, path.join(dir, 'leak.jsonl'), { JEV_API_KEY: 'fake', SOPS_AGE_KEY: 'never-export' });
    assert.equal(leak.status, 'UNKNOWN'); assert.equal(leak.reason, 'DECRYPT_CAPABILITY_LEAK');
    assert.ok(!fs.readFileSync(path.join(dir, 'leak.jsonl'), 'utf8').includes('never-export'));
    const missing = await writeDriftProof(path.join(dir, 'absent'), digest, path.join(dir, 'missing.jsonl'), {});
    assert.equal(missing.status, 'BLOCK'); assert.equal(missing.reason, 'INPUT_UNREADABLE');
    const cli = spawnSync(process.execPath, [fileURLToPath(new URL('./contract-drift-shadow.mjs', import.meta.url)), source, digest, path.join(dir, 'cli.jsonl')], { env: {}, encoding: 'utf8' });
    assert.equal(cli.status, 1); assert.equal(JSON.parse(cli.stdout).status, 'UNKNOWN');
    assert.ok(!cli.stdout.includes('ranked')); assert.ok(!cli.stdout.includes('answers'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
console.log(JSON.stringify({ suite: 'contract-drift-shadow', status: 'PASS', checks: passed.length,
  realJev: 'NOT_RUN', sourceReadback: 'NOT_RUN', independentComparison: 'NOT_RUN' }));
