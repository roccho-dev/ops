import assert from 'node:assert/strict';
import { JEV_MODEL } from '../lib/core.mjs';
import { evaluateClosure, validateClosure } from './evaluate.mjs';

const base = {
  purpose: 'Keep the declared business-to-product loop observable from event through effect and back to the next event.',
  world: 'closed',
  scope: 'adrs#389 declared closure',
  snapshot: 'fixture-v1',
  conditions: [
    { id: 'c01', from: 'Event', to: 'Observe', criterion: 'The event is represented by observable evidence.', evidence: ['event receipt is referenced by the observation'] },
    { id: 'c02', from: 'Observe', to: 'Decision', criterion: 'The decision is traceable to observed evidence.', evidence: ['decision references the observation'] },
    { id: 'c03', from: 'Decision', to: 'Contract', criterion: 'The accepted contract records the decided change and its acceptance conditions.', evidence: ['contract references the decision'] },
    { id: 'c04', from: 'Contract', to: 'Proven Change', criterion: 'The implemented change is checked against the declared contract.', evidence: ['proof references the contract and implementation'] },
    { id: 'c05', from: 'Proven Change', to: 'Effect', criterion: 'Only the proven and admitted change is allowed to affect the declared target.', evidence: ['effect references the admitted proven change'] },
    { id: 'c06', from: 'Effect', to: 'Readback', criterion: 'The actual effect is independently observed after execution.', evidence: ['readback references the effected target'] },
    { id: 'c07', from: 'Readback', to: 'Event', criterion: 'The observed result becomes evidence for the next business event or decision.', evidence: ['next event references the readback result'] },
  ],
};

validateClosure(base);
const before = structuredClone(base);
let calls = 0;
const ask = async (state, questions) => {
  calls++;
  assert.equal(state.conditions.length, 7);
  assert.deepEqual(state.conditions.map((c) => c.id), ['c01', 'c02', 'c03', 'c04', 'c05', 'c06', 'c07']);
  assert.ok(Object.values(questions).every((q) => q.type === 'noul'));
  return {
    model: JEV_MODEL,
    answers: Object.fromEntries(Object.keys(questions).map((key, i) => [key, { type: 'noul', noul: (i + 1) / 10 }])),
    usage: { input_tokens: 1, output_tokens: 1 },
  };
};

const result = await evaluateClosure(base, ask);
assert.equal(calls, 1);
assert.deepEqual(base, before);
assert.equal(result.kind, 'closureEvaluation.v1');
assert.deepEqual(result.coverage, {
  declared: 7,
  evaluated: 7,
  declaredSetFullyEvaluated: true,
});
assert.deepEqual(result.findings.map((f) => f.id), ['c07', 'c06', 'c05', 'c04', 'c03', 'c02', 'c01']);
assert.ok(result.findings.every((f) => Array.isArray(f.subject) && f.subject[0] === 'edge' && typeof f.criterion === 'string' && Array.isArray(f.evidence)));
assert.equal(Object.hasOwn(result, 'status'), false);
assert.equal(Object.hasOwn(result, 'closed'), false);

const never = async () => { throw new Error('JEV_SHOULD_NOT_RUN'); };
await assert.rejects(() => evaluateClosure({ ...base, world: 'unknown' }, never), /INVALID_CLOSURE/);
await assert.rejects(() => evaluateClosure({ ...base, conditions: [] }, never), /INVALID_CLOSURE/);
await assert.rejects(() => evaluateClosure({ ...base, extra: true }, never), /INVALID_CLOSURE/);
await assert.rejects(() => evaluateClosure({
  ...base,
  conditions: [...base.conditions, { ...base.conditions[0] }],
}, never), /INVALID_CLOSURE_CONDITION/);
await assert.rejects(() => evaluateClosure({
  ...base,
  conditions: [{ ...base.conditions[0], evidence: ['ok'], extra: true }],
}, never), /INVALID_CLOSURE_CONDITION/);

const open = await evaluateClosure({ ...base, world: 'open' }, async (_, questions) => ({
  model: JEV_MODEL,
  answers: Object.fromEntries(Object.keys(questions).map((key) => [key, { type: 'noul', noul: 0.5 }])),
}));
assert.equal(open.world, 'open');
assert.equal(open.coverage.declaredSetFullyEvaluated, true);

await assert.rejects(() => evaluateClosure(base, async (_, questions) => ({
  model: JEV_MODEL,
  answers: Object.fromEntries(Object.keys(questions).slice(1).map((key) => [key, { type: 'noul', noul: 0.5 }])),
})), /INVALID_JEV_ANSWERS/);

console.log(JSON.stringify({
  closureEvaluationContract: 'PASS',
  conditions: base.conditions.length,
  semanticThresholds: 0,
  automaticRepair: false,
  admissionAuthority: false,
  live: false,
}));
