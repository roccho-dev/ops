import assert from 'node:assert/strict';
import { semcmp } from '../semcmp.mjs';
import { JEV_MODEL } from '../../jev-review/core.mjs';

const query = {
  input: 'api db',
  state: { current: { revision: 'fixture-1' }, working: ['API', 'DB'], context: { purpose: 'describe a relation' } },
  focus: { object: 'API', span: { start: 0, end: 6 } },
};
const original = structuredClone(query);
const proposals = [
  { id: 'p1', meaning: { type: 'text', value: 'api db' }, representation: 'keep api db as text' },
  { id: 'p2', meaning: { type: 'relation', from: 'API', to: 'DB' }, representation: 'API relates to DB' },
];
const proposalOriginal = structuredClone(proposals);
const traces = [], payloads = [];
let reverse = false, tie = false;
async function propose(q) {
  traces.push(structuredClone(q));
  if (!['api db', 'api writes db'].includes(q.input)) return [];
  q.state.working.push('callback mutation');
  return reverse ? [...proposals].reverse() : proposals;
}
async function ask(state, questions) {
  payloads.push(structuredClone({ state, questions }));
  const answers = Object.fromEntries(Object.entries(questions).map(([key, question]) => [key,
    { type: 'noul', noul: tie ? 0.5 : question.instructions.includes('"p2"') ? 0.8 : 0.2 }]));
  state.query.state.current.revision = 'callback mutation';
  state.proposals[0].meaning.type = 'callback mutation';
  for (const question of Object.values(questions)) question.instructions = 'callback mutation';
  return { model: JEV_MODEL, answers, usage: { input_tokens: 10, output_tokens: 2 } };
}
const composition = { propose, ask };
const first = await semcmp(query, composition);
assert.deepEqual(first.query, original);
assert.deepEqual(first.proposals.map((p) => p.id), ['p2', 'p1']);
assert.deepEqual(first.proposals.map((p) => p.meaning), [proposalOriginal[1].meaning, proposalOriginal[0].meaning]);
assert.equal(first.evaluation.calls, 1);
assert.deepEqual(first.evaluation.coverage, [{ theme: 'intent-fit', candidates: 2, evaluated: 2 }]);
assert.deepEqual(first.evaluation.usage, { input_tokens: 10, output_tokens: 2 });
assert.deepEqual(query, original);
assert.deepEqual(proposals, proposalOriginal);
assert.deepEqual(payloads[0].state.query, original);
assert.deepEqual(traces[0], original);

// Two caller-shaped projections preserve identity and cancel without an effect.
const vimResult = await semcmp(query, composition);
const voiceResult = await semcmp(query, composition);
const vimItems = vimResult.proposals.map((p) => ({ word: p.representation, user_data: p.id }));
const voiceChoices = voiceResult.proposals.map((p) => ({ label: p.representation, id: p.id }));
assert.deepEqual(vimItems.map((p) => p.user_data), voiceChoices.map((p) => p.id));
assert.equal(first.proposals.find((p) => p.id === vimItems[0].user_data).meaning.type, 'relation');
assert.equal(first.proposals.find((p) => p.id === voiceChoices[1].id).meaning.type, 'text');
const selection = (id) => id === null ? null : first.proposals.find((p) => p.id === id);
assert.equal(selection(null), null);
assert.deepEqual(query, original);

reverse = true;
const reversed = await semcmp(query, composition);
assert.deepEqual(reversed.proposals, first.proposals);
assert.deepEqual(reversed.query, first.query);
assert.deepEqual(reversed.evaluation.judgments, [...first.evaluation.judgments].reverse());
tie = true;
assert.deepEqual((await semcmp(query, composition)).proposals.map((p) => p.id), ['p1', 'p2']);
tie = false;
const edited = { ...original, input: 'api writes db', state: { ...original.state, working: ['API writes DB'] } };
const fresh = await semcmp(edited, composition);
assert.deepEqual(fresh.query, edited);
assert.deepEqual(traces.at(-1), edited);
assert.deepEqual(payloads.at(-1).state.query, edited);

// Caller changes during each await cannot change the captured evaluation base.
const mutableQuery = structuredClone(original);
let releasePropose;
const pendingPropose = semcmp(mutableQuery, { propose: () => new Promise((resolve) => { releasePropose = resolve; }), ask });
mutableQuery.input = 'caller changed while propose pending';
mutableQuery.state.working.push('caller change');
releasePropose(proposals);
assert.deepEqual((await pendingPropose).query, original);

const mutableProposals = structuredClone(proposalOriginal);
let enteredAsk, releaseAsk, pendingQuestions;
const askEntered = new Promise((resolve) => { enteredAsk = resolve; });
const pendingEvaluate = semcmp(query, {
  propose: () => mutableProposals,
  ask: (_state, questions) => {
    pendingQuestions = questions;
    enteredAsk();
    return new Promise((resolve) => { releaseAsk = resolve; });
  },
});
await askEntered;
mutableProposals[0].meaning.value = 'caller changed while evaluate pending';
mutableProposals.reverse();
releaseAsk({ model: JEV_MODEL, answers: Object.fromEntries(Object.keys(pendingQuestions).map((key) => [key, { type: 'noul', noul: 0.5 }])) });
assert.deepEqual((await pendingEvaluate).proposals.map((p) => p.meaning), proposalOriginal.map((p) => p.meaning));

let calls = 0;
const empty = await semcmp(query, { propose: () => [], ask: () => { calls++; throw new Error('unexpected'); } });
assert.equal(calls, 0);
assert.deepEqual(empty.proposals, []);
assert.equal(empty.evaluation.calls, 0);
assert.deepEqual(empty.evaluation.coverage, [{ theme: 'intent-fit', candidates: 0, evaluated: 0 }]);
for (const bad of [null, { input: 'x' }, { ...query, extra: true }, { ...query, input: undefined }, { ...query, state: NaN }]) {
  await assert.rejects(semcmp(bad, composition), /INVALID_QUERY/);
}
await assert.rejects(semcmp(query), /INVALID_COMPOSITION/);
for (const bad of [null, {}, [proposals[0], proposals[0]], [{ id: '', meaning: {}, representation: 'x' }],
  [{ id: 'x', meaning: {}, representation: '' }], [{ id: 'x', meaning: () => {}, representation: 'x' }]]) {
  await assert.rejects(semcmp(query, { ...composition, propose: () => bad }), /INVALID_PROPOSALS|DUPLICATE_PROPOSAL_ID/);
}
await assert.rejects(semcmp(query, { ...composition, propose: () => { throw new Error('fixture'); } }), /PROPOSE_FAILED/);
await assert.rejects(semcmp(query, { ...composition, ask: () => { throw new Error('fixture ask failure'); } }), /fixture ask failure/);
await assert.rejects(semcmp(query, { ...composition, ask: () => ({ model: 'wrong', answers: {} }) }), /JEV_MODEL_MISMATCH/);
for (const answers of [{}, { q0: { type: 'noul', noul: 0.5 } },
  { q0: { type: 'noul', noul: NaN }, q1: { type: 'noul', noul: 0.5 } }]) {
  await assert.rejects(semcmp(query, { ...composition, ask: () => ({ model: JEV_MODEL, answers }) }), /INVALID_JEV_ANSWERS/);
}
assert.deepEqual(query, original);
assert.deepEqual(proposals, proposalOriginal);
assert.ok(payloads.every(({ state }) => !Object.hasOwn(state, 'expected') && !Object.hasOwn(state, 'gold')));
console.log('semcmp: proposal/evaluation/order, two caller projections, snapshot, empty and refusal controls passed');
