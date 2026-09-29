import assert from 'node:assert/strict';
import { joinFullCiReference, runWinnowRelevance } from './winnow.mjs';

const input = {
  baseSha: '1'.repeat(40),
  headSha: '2'.repeat(40),
  changedPaths: ['packages/a/a.mjs'],
  topK: 1,
  candidates: [
    { name: 'a-check', script: 'packages/a/test.mjs' },
    { name: 'b-check', script: 'packages/b/test.mjs' },
  ],
};
const fakeFetch = async (_url, request) => {
  const body = JSON.parse(request.body);
  assert.equal(body.model, 'ollaya.dev/library/winnow:e4b');
  assert.deepEqual(body.state.changedPaths, ['packages/a/a.mjs']);
  return { ok: true, async json() { return { model: body.model, answers: { q0: { type: 'noul', noul: 0.9 }, q1: { type: 'noul', noul: 0.2 } }, usage: { input_tokens: 12 } }; } };
};
const shadow = await runWinnowRelevance(input, { fetchImpl: fakeFetch });
assert.deepEqual(shadow.wouldSelect, ['a-check']);
assert.equal(shadow.authority, false);
assert.equal(shadow.effect, false);
assert.equal(shadow.referenceIsGroundTruth, false);
const joined = joinFullCiReference(shadow, {
  headSha: input.headSha,
  checks: [
    { name: 'a-check', conclusion: 'success', durationMs: 10 },
    { name: 'b-check', conclusion: 'failure', durationMs: 20 },
  ],
});
assert.deepEqual(joined.observedOmittedFailures, ['b-check']);
assert.equal(joined.referenceIsGroundTruth, false);
assert.throws(() => joinFullCiReference(shadow, { headSha: '3'.repeat(40), checks: [] }), /REFERENCE_MISMATCH/);
console.log('winnow-ci-relevance-shadow: ok');
