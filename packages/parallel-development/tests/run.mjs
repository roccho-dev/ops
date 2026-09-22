import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JEV_MODEL } from '../../jev-review/core.mjs';
import { reviewPhase, validateBenchmarkCase, PHASES } from '../phases.mjs';
import { assertNoGoldLeak, classifyIncrementalEffect, summarize, validateCorpus, validateExpected } from '../proof.mjs';

const parse = (url) => fs.readFileSync(url, 'utf8').trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse);
const cases = validateCorpus(parse(new URL('cases.jsonl', import.meta.url)));
const expected = validateExpected(parse(new URL('expected.jsonl', import.meta.url)), cases);
const authRows = fs.readFileSync(new URL('../artifact.jsonl', import.meta.url), 'utf8').trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse);
assert.deepEqual(authRows, [{artifact:'parallel-development-jev-proof',kind:'artifact.auth.v1',requiredCapabilities:['jev-api']}]);
assert.equal(cases.length, 18);
assert.equal(Object.values(PHASES).flat().length, 18);
assert.ok(!fs.readFileSync(new URL('cases.jsonl', import.meta.url), 'utf8').match(/"(?:good|bad|defect|control|gold|expected)"/iu));

const results = [];
for (const row of cases) {
  validateBenchmarkCase(row);
  for (const [order, state] of [['declared', structuredClone(row.state)], ['reversed', structuredClone(row.state)]]) {
    if (order === 'reversed') state.candidates.reverse();
    let calls = 0;
    const result = await reviewPhase(state, { topK: 2, themes: [row.theme] }, async (reviewState, questions) => {
      assertNoGoldLeak(reviewState, questions);
      calls++;
      const preferred = expected.get(row.caseId);
      return {
        model: JEV_MODEL,
        answers: Object.fromEntries(Object.entries(questions).map(([key, question]) => {
          const subject = JSON.parse(question.instructions.match(/target (\[[^]*?\]) in the supplied/u)?.[1] ?? '[]');
          return [key, { type: 'noul', noul: subject[1] === preferred ? 0.9 : 0.1 }];
        })),
      };
    });
    assert.equal(calls, 1);
    results.push({
      caseId: row.caseId, phase: row.phase, theme: row.theme, order,
      inputCandidates: state.candidates.map((candidate) => candidate.id),
      calls, ...result,
    });
  }
}
const summary = summarize(results, expected);
assert.equal(summary.status, 'OBSERVED');
assert.equal(summary.requests, 36);
assert.equal(summary.judgments, 72);
assert.equal(summary.preferredHigher, 36);
assert.equal(summary.preferredLower, 0);
assert.equal(summary.ties, 0);
assert.equal(summary.stableCases, 18);
assert.equal(summary.semanticThresholds, 0);
assert.equal(summary.goldLeakage, 0);
assert.deepEqual(
  {
    baselineHits: summary.effect.baselineHits,
    jevHits: summary.effect.jevHits,
    baselineHitAt1: summary.effect.baselineHitAt1,
    jevHitAt1: summary.effect.jevHitAt1,
    deltaHitAt1: summary.effect.deltaHitAt1,
    classification: summary.effect.classification,
    potentialCandidateReadReduction: summary.effect.potentialCandidateReadReduction,
    downstreamDecisionEffect: summary.effect.downstreamDecisionEffect,
  },
  {
    baselineHits: 18,
    jevHits: 36,
    baselineHitAt1: 0.5,
    jevHitAt1: 1,
    deltaHitAt1: 0.5,
    classification: 'EFFECT_OBSERVED',
    potentialCandidateReadReduction: 0.5,
    downstreamDecisionEffect: 'UNMEASURED',
  },
);
assert.ok(Object.values(summary.effect.perPhase).every((row) =>
  row.orders === 12 && row.baselineHits === 6 && row.jevHits === 12 && row.deltaHitAt1 === 0.5 && row.classification === 'EFFECT_OBSERVED'
));
assert.equal(classifyIncrementalEffect(18, 18), 'NO_EFFECT_OBSERVED');
assert.equal(classifyIncrementalEffect(17, 18), 'HARM_OBSERVED');
assert.equal(classifyIncrementalEffect(19, 18), 'EFFECT_OBSERVED');

// Ranking quality is evidence, never an execution gate.
const ties = [];
for (const row of cases) {
  for (const [order, state] of [['declared', structuredClone(row.state)], ['reversed', structuredClone(row.state)]]) {
    if (order === 'reversed') state.candidates.reverse();
    const result = await reviewPhase(state, { topK: 2, themes: [row.theme] }, async (_, questions) => ({
      model: JEV_MODEL,
      answers: Object.fromEntries(Object.keys(questions).map((key) => [key, { type: 'noul', noul: 0.5 }])),
    }));
    ties.push({
      caseId: row.caseId, phase: row.phase, theme: row.theme, order,
      inputCandidates: state.candidates.map((candidate) => candidate.id),
      calls: 1, ...result,
    });
  }
}
const tieSummary = summarize(ties, expected);
assert.equal(tieSummary.status, 'OBSERVED');
assert.equal(tieSummary.ties, 36);
assert.equal(tieSummary.stableCases, 0);

let calls = 0;
const disabled = await reviewPhase(cases[0].state, { topK: 0, themes: [cases[0].theme] }, async () => { calls++; throw new Error('MUST_NOT_CALL'); });
assert.equal(calls, 0);
assert.ok(disabled.ranked.every((group) => group.status === 'disabled' && group.evaluated === 0));

const three = structuredClone(cases[0].state);
const third = structuredClone(three.candidates[0]);
third.id = 'n-extra';
three.candidates.push(third);
const threeResult = await reviewPhase(three, { topK: 2, themes: [cases[0].theme] }, async (_, questions) => ({
  model: JEV_MODEL,
  answers: Object.fromEntries(Object.keys(questions).map((key, index) => [key, { type: 'noul', noul: [0.1, 0.9, 0.5][index] }])),
}));
assert.equal(threeResult.ranked[0].candidates, 3);
assert.equal(threeResult.ranked[0].evaluated, 3);
assert.equal(threeResult.ranked[0].returned, 2);

const broken = structuredClone(cases[0]); broken.extra = true;
assert.throws(() => validateBenchmarkCase(broken), /INVALID_BENCHMARK_CASE/);
assert.throws(() => validateCorpus(cases.slice(0, 17)), /INVALID_PHASE_CORPUS/);
assert.throws(() => validateExpected(parse(new URL('expected.jsonl', import.meta.url)).slice(0, 17), cases), /INVALID_EXPECTED_CORPUS/);

await assert.rejects(() => reviewPhase(cases[0].state, { topK: 2, themes: [cases[0].theme] }, async (_, questions) => ({
  model: JEV_MODEL,
  answers: { ...Object.fromEntries(Object.keys(questions).map((key) => [key, { type: 'noul', noul: 0.5 }])), extra: { type: 'noul', noul: 0.5 } },
})), /INVALID_JEV_ANSWERS/);

console.log(JSON.stringify({
  status: 'PASS', cases: 18, orders: 36, judgments: 72,
  semanticThresholds: 0, goldLeakage: 0,
  effect: summary.effect,
}));
