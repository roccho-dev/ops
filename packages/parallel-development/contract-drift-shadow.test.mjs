import assert from 'node:assert/strict';
import { reviewContractDrift } from './contract-drift-shadow.mjs';

const input = {
  contractRef: 'issue://449/contract-a',
  changeRef: 'git://head/' + '2'.repeat(40),
  contract: { id: 'a', goal: 'emit one receipt', scope: ['packages/a'], in: ['x'], out: ['receipt'], acceptance: ['receipt exists'] },
  related: [],
  change: { id: 'head', changed_scope: ['packages/a'], implementation: 'emit receipt', outputs: ['receipt'], evidence: ['test'] },
};
let calls = 0;
const result = await reviewContractDrift(input, async (_state, questions) => {
  calls++;
  return { model: 'jev-1.13.0', answers: Object.fromEntries(Object.keys(questions).map((key, index) => [key, { type: 'noul', noul: 0.1 + index / 10 }])) };
});
assert.equal(calls, 1);
assert.equal(result.provider, 'jev');
assert.equal(result.authority, false);
assert.equal(result.effect, false);
assert.equal(result.ranked.length, 6);
assert.equal(Object.hasOwn(result, 'merge'), false);
assert.equal(Object.hasOwn(result, 'verdict'), false);
console.log('contract-drift-shadow: ok');
