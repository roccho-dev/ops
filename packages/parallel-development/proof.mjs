import crypto from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { askJev } from '../jev-review/jev.mjs';
import { JEV_MODEL } from '../jev-review/core.mjs';
import { PHASES, reviewPhase, validateBenchmarkCase } from './phases.mjs';

const stableJson = (value) => Array.isArray(value) ? `[${value.map(stableJson).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const sha256 = (value) => `sha256:${crypto.createHash('sha256').update(typeof value === 'string' ? value : stableJson(value)).digest('hex')}`;
const parseJsonl = (text) => String(text).split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).map(JSON.parse);
const exact = (x, names) => x && [Object.prototype, null].includes(Object.getPrototypeOf(x))
  && Reflect.ownKeys(x).length === names.length && names.every((name) => Object.hasOwn(x, name));

export function validateCorpus(rows) {
  if (!Array.isArray(rows) || rows.length !== 18) throw new Error('INVALID_PHASE_CORPUS');
  const cases = new Set();
  const seen = new Set();
  for (const row of rows) {
    validateBenchmarkCase(row);
    if (cases.has(row.caseId)) throw new Error('INVALID_PHASE_CORPUS');
    cases.add(row.caseId);
    const key = `${row.phase}\\0${row.theme}`;
    if (seen.has(key)) throw new Error('INVALID_PHASE_CORPUS');
    seen.add(key);
  }
  const required = Object.entries(PHASES).flatMap(([phase, themes]) => themes.map(([theme]) => `${phase}\\0${theme}`));
  if (required.length !== seen.size || required.some((key) => !seen.has(key))) throw new Error('INVALID_PHASE_CORPUS');
  return rows;
}

export function validateExpected(rows, cases) {
  if (!Array.isArray(rows) || rows.length !== cases.length) throw new Error('INVALID_EXPECTED_CORPUS');
  const byCase = new Map(cases.map((row) => [row.caseId, row]));
  const result = new Map();
  for (const row of rows) {
    if (!exact(row, ['caseId', 'preferredId']) || typeof row.caseId !== 'string' || typeof row.preferredId !== 'string'
      || result.has(row.caseId) || !byCase.has(row.caseId)
      || !byCase.get(row.caseId).state.candidates.some((candidate) => candidate.id === row.preferredId)) throw new Error('INVALID_EXPECTED_CORPUS');
    result.set(row.caseId, row.preferredId);
  }
  return result;
}

export function assertNoGoldLeak(state, questions) {
  const payload = JSON.stringify({ state, questions }).toLowerCase();
  for (const token of ['"good"', '"bad"', '"defect"', '"control"', '"gold"', '"expected"', '"preferredid"']) {
    if (payload.includes(token)) throw new Error('GOLD_LEAK');
  }
}

function scoreMap(result) {
  if (result.calls !== 1 || !Array.isArray(result.ranked) || result.ranked.length !== 1) throw new Error('INCOMPLETE_PHASE_RESULTS');
  const group = result.ranked[0];
  if (group.status !== 'evaluated' || group.candidates !== 2 || group.evaluated !== 2 || group.returned !== 2 || group.findings.length !== 2) {
    throw new Error('INCOMPLETE_PHASE_RESULTS');
  }
  return {
    group,
    scores: new Map(group.findings.map((finding) => [finding.subject?.[1], finding.noul])),
    jevTopId: group.findings[0]?.subject?.[1],
  };
}

export function classifyIncrementalEffect(jevHits, baselineHits) {
  if (!Number.isSafeInteger(jevHits) || !Number.isSafeInteger(baselineHits) || jevHits < 0 || baselineHits < 0) {
    throw new Error('INVALID_EFFECT_COUNTS');
  }
  return jevHits > baselineHits ? 'EFFECT_OBSERVED' : jevHits < baselineHits ? 'HARM_OBSERVED' : 'NO_EFFECT_OBSERVED';
}

export function summarize(results, expected) {
  if (!Array.isArray(results) || results.length !== 36) throw new Error('INCOMPLETE_PHASE_RESULTS');
  const byCase = new Map();
  for (const result of results) {
    if (!['declared', 'reversed'].includes(result.order) || result.error || result.calls !== 1) throw new Error('INCOMPLETE_PHASE_RESULTS');
    const { group, scores, jevTopId } = scoreMap(result);
    if (group.theme !== result.theme || scores.size !== 2 || !Array.isArray(result.inputCandidates) || result.inputCandidates.length !== 2) {
      throw new Error('INCOMPLETE_PHASE_RESULTS');
    }
    if (!result.inputCandidates.every((id) => scores.has(id))) throw new Error('INCOMPLETE_PHASE_RESULTS');
    if (!byCase.has(result.caseId)) byCase.set(result.caseId, []);
    byCase.get(result.caseId).push({ ...result, scores, jevTopId });
  }
  if (byCase.size !== 18 || [...byCase.values()].some((rows) => rows.length !== 2)) throw new Error('INCOMPLETE_PHASE_RESULTS');

  const comparisons = [];
  const cases = [];
  for (const [caseId, rows] of [...byCase].sort()) {
    const preferredId = expected.get(caseId);
    if (!preferredId) throw new Error('INCOMPLETE_EXPECTED_RESULTS');
    const perOrder = rows.sort((a, b) => a.order.localeCompare(b.order)).map((row) => {
      const ids = [...row.scores.keys()];
      if (!ids.includes(preferredId) || ids.length !== 2) throw new Error('INCOMPLETE_EXPECTED_RESULTS');
      const otherId = ids.find((id) => id !== preferredId);
      const preferred = row.scores.get(preferredId);
      const other = row.scores.get(otherId);
      const verdict = preferred > other ? 'preferred-higher' : preferred < other ? 'preferred-lower' : 'tie';
      const baselineTopId = row.inputCandidates[0];
      const baselineHitAt1 = baselineTopId === preferredId;
      const jevHitAt1 = row.jevTopId === preferredId;
      const comparison = {
        caseId, phase: row.phase, theme: row.theme, order: row.order,
        preferredId, otherId, preferred, other, verdict,
        baselineTopId, jevTopId: row.jevTopId, baselineHitAt1, jevHitAt1,
      };
      comparisons.push(comparison);
      return comparison;
    });
    cases.push({ caseId, phase: rows[0].phase, theme: rows[0].theme, stablePreferredHigher: perOrder.every((x) => x.verdict === 'preferred-higher'), perOrder });
  }

  const baselineHits = comparisons.filter((x) => x.baselineHitAt1).length;
  const jevHits = comparisons.filter((x) => x.jevHitAt1).length;
  const effectByPhase = Object.fromEntries(['cut', 'pr', 'join'].map((phase) => {
    const rows = comparisons.filter((x) => x.phase === phase);
    const baseline = rows.filter((x) => x.baselineHitAt1).length;
    const jev = rows.filter((x) => x.jevHitAt1).length;
    return [phase, {
      orders: rows.length,
      baselineHits: baseline,
      jevHits: jev,
      deltaHitAt1: rows.length ? (jev - baseline) / rows.length : null,
      classification: classifyIncrementalEffect(jev, baseline),
    }];
  }));
  const fullScanCandidates = comparisons.length * 2;
  const jevTop1Candidates = comparisons.length;
  const sameGoldCoverageAsFullScan = jevHits === comparisons.length;

  return {
    kind: 'summary', status: 'OBSERVED', model: JEV_MODEL,
    cases: cases.length, orders: results.length, requests: results.reduce((sum, row) => sum + row.calls, 0), judgments: results.length * 2,
    preferredHigher: comparisons.filter((x) => x.verdict === 'preferred-higher').length,
    preferredLower: comparisons.filter((x) => x.verdict === 'preferred-lower').length,
    ties: comparisons.filter((x) => x.verdict === 'tie').length,
    stableCases: cases.filter((x) => x.stablePreferredHigher).length,
    unstableCases: cases.filter((x) => !x.stablePreferredHigher).length,
    semanticThresholds: 0,
    goldLeakage: 0,
    effect: {
      kind: 'jevRankingEffect.v1',
      scope: 'fixed-neutral-fixture-top1',
      baseline: 'input-first-no-semantic-prior',
      attentionBudget: 1,
      orders: comparisons.length,
      baselineHits,
      jevHits,
      baselineHitAt1: comparisons.length ? baselineHits / comparisons.length : null,
      jevHitAt1: comparisons.length ? jevHits / comparisons.length : null,
      deltaHitAt1: comparisons.length ? (jevHits - baselineHits) / comparisons.length : null,
      classification: classifyIncrementalEffect(jevHits, baselineHits),
      perPhase: effectByPhase,
      fullScanCandidates,
      jevTop1Candidates,
      sameGoldCoverageAsFullScan,
      potentialCandidateReadReduction: sameGoldCoverageAsFullScan ? 1 - (jevTop1Candidates / fullScanCandidates) : null,
      downstreamDecisionEffect: 'UNMEASURED',
    },
    comparisons,
    caseResults: cases,
  };
}

function reversed(state) {
  const copy = structuredClone(state);
  copy.candidates.reverse();
  return copy;
}

async function main() {
  const out = process.argv[2];
  if (!out || process.argv.length !== 3) throw new Error('usage: node proof.mjs NEW_REPORT.jsonl');
  fs.writeFileSync(out, '', { flag: 'wx', mode: 0o600 });
  const append = (row) => fs.appendFileSync(out, `${JSON.stringify(row)}\\n`);
  const cases = validateCorpus(parseJsonl(fs.readFileSync(new URL('tests/cases.jsonl', import.meta.url), 'utf8')));
  append({ kind: 'manifest', model: JEV_MODEL, opsSha: process.env.OPS_SHA ?? null, envsSha: process.env.ENVS_SHA ?? null,
    corpusDigest: sha256(cases), cases: 18, ordersPerCase: 2, semanticThresholds: 0, goldLoadedAfterRequests: true,
    claim: 'neutral cut/pr/join semantic comparison; raw evidence only; no accept authority' });
  if (!process.env.JEV_API_KEY?.trim()) throw new Error('JEV_API_KEY_REQUIRED');
  if (['SOPS_AGE_KEY', 'SOPS_AGE_KEY_FILE', 'SOPS_AGE_KEY_CMD'].some((key) => process.env[key])) throw new Error('DECRYPT_CAPABILITY_LEAK');

  const results = [];
  for (const row of cases) {
    for (const [order, state] of [['declared', structuredClone(row.state)], ['reversed', reversed(row.state)]]) {
      const result = {
        kind: 'case-order', caseId: row.caseId, phase: row.phase, theme: row.theme, order,
        inputCandidates: state.candidates.map((candidate) => candidate.id),
        stateDigest: sha256(state), calls: 0,
      };
      try {
        Object.assign(result, await reviewPhase(state, { topK: 2, themes: [row.theme] }, (reviewState, questions) => {
          assertNoGoldLeak(reviewState, questions);
          result.calls++;
          return askJev(reviewState, questions, { key: process.env.JEV_API_KEY, endpoint: 'https://api.typesafe.ai/v1/systemone', timeoutMs: 15000 });
        }));
      } catch (error) {
        result.error = /^(JEV_HTTP_[0-9]{3}|JEV_MODEL_MISMATCH|INVALID_JEV_(JSON|ANSWERS)|INVALID_PHASE_STATE|INVALID_PHASE_THEMES|GOLD_LEAK)$/.test(error?.message)
          ? error.message : 'EXECUTION_FAILED';
      }
      results.push(result); append(result);
    }
  }

  // Gold is loaded only after every model request has completed.
  const expectedText = fs.readFileSync(new URL('tests/expected.jsonl', import.meta.url), 'utf8');
  const expected = validateExpected(parseJsonl(expectedText), cases);
  append({ kind: 'gold-receipt', expectedDigest: sha256(expectedText), loadedAfterRequests: true });
  const summary = summarize(results, expected); append(summary); console.log(JSON.stringify(summary));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => {
  console.error(error?.message ?? 'PARALLEL_DEVELOPMENT_PROOF_FAILED'); process.exitCode = 1;
});
