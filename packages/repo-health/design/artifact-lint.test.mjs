import assert from 'node:assert/strict';
import { reviewSemanticArtifact } from './artifact-lint.mjs';

const input = {
  kind: 'issue',
  sourceRef: 'https://github.com/roccho-dev/ops/issues/449',
  topK: 2,
  design: {
    purpose: 'produce one bounded evidence result',
    acceptance: ['result binds exact input'],
    constraints: ['no authority'],
    in: ['exact-input'],
    out: ['evidence'],
    units: [
      { id: 'evaluate', kind: 'step', responsibility: 'evaluate exact input', in: ['exact-input'], out: ['evidence'], design: 'evaluate and emit evidence only' },
    ],
  },
};
const result = await reviewSemanticArtifact(input, async (_state, questions) => ({
  model: 'jev-1.13.0',
  answers: Object.fromEntries(Object.keys(questions).map((key, index) => [key, { type: 'noul', noul: (index + 1) / (Object.keys(questions).length + 1) }]))
}));
assert.equal(result.provider, 'jev');
assert.equal(result.authority, false);
assert.equal(result.effect, false);
assert.deepEqual(result.structuralReference, []);
assert.equal(result.ranked.length, 6);
assert.equal(Object.hasOwn(result, 'verdict'), false);
console.log('semantic-lint-shadow: ok');
