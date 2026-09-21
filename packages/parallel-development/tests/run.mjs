import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JEV_MODEL } from '../../jev-review/core.mjs';
import { reviewPhase, validatePhaseState, PHASES } from '../phases.mjs';
import { validateCorpus, summarize } from '../proof.mjs';

const rows = fs.readFileSync(new URL('cases.jsonl', import.meta.url), 'utf8')
  .trim().split(/\r?\n/u).map(JSON.parse);
const authRows = fs.readFileSync(new URL('../artifact.jsonl', import.meta.url), 'utf8').trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse);
assert.deepEqual(authRows, [{artifact:'parallel-development-jev-proof',kind:'artifact.auth.v1',requiredCapabilities:['jev-api']}]);
validateCorpus(rows);
assert.deepEqual(rows.map((row) => row.phase), ['cut','pr','join']);
assert.equal(Object.values(PHASES).flat().length, 18);

const ask = async (_, questions) => ({
  model: JEV_MODEL,
  answers: Object.fromEntries(Object.entries(questions).map(([key, q]) => [
    key,
    { type:'noul', noul:q.instructions.includes('"bad"') ? 0.9 : 0.1 },
  ])),
});

const results = [];
for (const state of rows) {
  let calls = 0;
  const result = await reviewPhase(state, {topK:2}, async (s, q) => { calls++; return ask(s, q); });
  results.push({phase:state.phase, calls, ...result});
  assert.equal(calls, 1);
  assert.equal(result.ranked.length, 6);
  assert.ok(result.ranked.every((g) => g.candidates === 2 && g.evaluated === 2 && g.returned === 2));
}
const summary = summarize(results);
assert.equal(summary.status, 'OBSERVED');
assert.equal(summary.requests, 3);
assert.equal(summary.themes, 18);
assert.equal(summary.judgments, 36);
assert.equal(summary.pairwiseCorrect, 18);
assert.equal(summary.pairwiseReversed, 0);
assert.equal(summary.semanticThresholds, 0);

// Ranking quality is evidence, not execution authority.
const tied = [];
for (const state of rows) {
  const result = await reviewPhase(state, {topK:2}, async (_, questions) => ({
    model:JEV_MODEL,
    answers:Object.fromEntries(Object.keys(questions).map((key) => [key,{type:'noul',noul:0.5}]))
  }));
  tied.push({phase:state.phase,calls:1,...result});
}
assert.equal(summarize(tied).status, 'OBSERVED');
assert.equal(summarize(tied).pairwiseTies, 18);

let calls = 0;
const off = await reviewPhase(rows[0], {topK:0}, async () => { calls++; throw new Error('MUST_NOT_CALL'); });
assert.equal(calls, 0);
assert.ok(off.ranked.every((g) => g.status === 'disabled' && g.evaluated === 0));

for (const index of [0,1,2]) {
  const bad = structuredClone(rows[index]);
  bad.extra = true;
  assert.throws(() => validatePhaseState(bad), /INVALID_PHASE_STATE/);
}
assert.throws(() => validateCorpus(rows.slice(0,2)), /INVALID_PHASE_CORPUS/);
assert.throws(() => summarize(results.slice(0,2)), /INCOMPLETE_PHASE_RESULTS/);

await assert.rejects(() => reviewPhase(rows[0], {topK:2}, async (_, questions) => ({
  model:JEV_MODEL,
  answers:{...Object.fromEntries(Object.keys(questions).map((key) => [key,{type:'noul',noul:0.5}])),extra:{type:'noul',noul:0.5}}
})), /INVALID_JEV_ANSWERS/);

console.log(JSON.stringify({
  status:'PASS',
  phases:rows.map((row)=>row.phase),
  themes:18,
  semanticThresholds:0,
  requestsPerPhase:1
}));
