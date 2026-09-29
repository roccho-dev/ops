import assert from 'node:assert/strict';
import { reviewWholeDDecisionPlane } from './whole-d-shadow.mjs';

const input = {
  policyRef: 'git://adrs/' + '1'.repeat(40),
  observationRef: 'provider://observation/42',
  state: {
    generation: { id: 'g1', state: 'active' },
    identity: { actor: 'w', thread: 't1' },
    refs: ['pr://1'],
    active: { generationEnded: true },
    duplicates: [],
    effects: [{ id: 'e1', status: 'readback' }],
    history: [],
  },
  candidates: [
    { id: 'refire', kind: 'refire', description: 'refire the same actor on the same exact ref' },
    { id: 'terminal', kind: 'terminal', description: 'declare the current work terminal' },
    { id: 'hold', kind: 'hold', description: 'hold because the effect state is ambiguous' },
  ],
};
const result = await reviewWholeDDecisionPlane(input, async (_state, questions) => ({
  model: 'jev-1.13.0',
  answers: Object.fromEntries(Object.keys(questions).map((key, index) => [key, { type: 'noul', noul: [0.7, 0.1, 0.9][index] }]))
}));
assert.equal(result.provider, 'jev');
assert.equal(result.authority, false);
assert.equal(result.effect, false);
assert.equal(result.ranked[0].findings[0].subject[1], 'hold');
assert.throws(() => reviewWholeDDecisionPlane({ ...input, expected: 'hold' }, async () => ({})), /D_DECISION_LEAK/);
console.log('whole-d-shadow: ok');
