import crypto from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { askJev } from '../jev-review/jev.mjs';
import { JEV_MODEL } from '../jev-review/core.mjs';
import { PHASES, reviewPhase, validatePhaseState } from './phases.mjs';

const stableJson = (value) => Array.isArray(value) ? `[${value.map(stableJson).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const sha256 = (value) => `sha256:${crypto.createHash('sha256').update(typeof value === 'string' ? value : stableJson(value)).digest('hex')}`;
const parseJsonl = (text) => String(text).split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).map(JSON.parse);

export function validateCorpus(rows) {
  if (!Array.isArray(rows) || rows.length !== 3 || new Set(rows.map((row) => row?.phase)).size !== 3
    || Object.keys(PHASES).some((phase) => !rows.some((row) => row.phase === phase))) throw new Error('INVALID_PHASE_CORPUS');
  rows.forEach(validatePhaseState);
  return rows;
}

export function summarize(results) {
  if (!Array.isArray(results) || results.length !== 3 || new Set(results.map((row) => row.phase)).size !== 3) throw new Error('INCOMPLETE_PHASE_RESULTS');
  const comparisons = [];
  let themes = 0, judgments = 0, requests = 0, errors = 0;
  for (const result of results) {
    requests += result.calls ?? 0;
    if (result.error) { errors++; continue; }
    if (result.calls !== 1 || !Array.isArray(result.ranked) || result.ranked.length !== PHASES[result.phase].length) throw new Error('INCOMPLETE_PHASE_RESULTS');
    for (const group of result.ranked) {
      themes++;
      if (group.status !== 'evaluated' || group.candidates !== 2 || group.evaluated !== 2 || group.returned !== 2 || group.findings.length !== 2) throw new Error('INCOMPLETE_PHASE_RESULTS');
      judgments += 2;
      const good = group.findings.find((finding) => JSON.stringify(finding.subject) === JSON.stringify(['candidate', 'good']));
      const bad = group.findings.find((finding) => JSON.stringify(finding.subject) === JSON.stringify(['candidate', 'bad']));
      if (!good || !bad || !Number.isFinite(good.noul) || !Number.isFinite(bad.noul)) throw new Error('INCOMPLETE_PHASE_RESULTS');
      comparisons.push({ phase: result.phase, theme: group.theme, good: good.noul, bad: bad.noul,
        order: bad.noul > good.noul ? 'correct' : bad.noul < good.noul ? 'reversed' : 'tie' });
    }
  }
  return {
    kind: 'summary', status: errors === 0 && themes === 18 && judgments === 36 && requests === 3 ? 'OBSERVED' : 'EXECUTION_ERROR',
    model: JEV_MODEL, phases: results.length, themes, judgments, requests, errors,
    pairwiseCorrect: comparisons.filter((x) => x.order === 'correct').length,
    pairwiseReversed: comparisons.filter((x) => x.order === 'reversed').length,
    pairwiseTies: comparisons.filter((x) => x.order === 'tie').length,
    comparisons, semanticThresholds: 0,
  };
}

async function main() {
  const out = process.argv[2];
  if (!out || process.argv.length !== 3) throw new Error('usage: node proof.mjs NEW_REPORT.jsonl');
  fs.writeFileSync(out, '', { flag: 'wx', mode: 0o600 });
  const append = (row) => fs.appendFileSync(out, `${JSON.stringify(row)}\n`);
  const rows = validateCorpus(parseJsonl(fs.readFileSync(new URL('tests/cases.jsonl', import.meta.url), 'utf8')));
  append({ kind: 'manifest', model: JEV_MODEL, opsSha: process.env.OPS_SHA ?? null, envsSha: process.env.ENVS_SHA ?? null,
    corpusDigest: sha256(rows), phasesDigest: sha256(PHASES), semanticThresholds: 0,
    claim: 'bounded cut/pr/join semantic ranking proof; no accept authority' });
  if (!process.env.JEV_API_KEY?.trim()) throw new Error('JEV_API_KEY_REQUIRED');
  if (['SOPS_AGE_KEY', 'SOPS_AGE_KEY_FILE', 'SOPS_AGE_KEY_CMD'].some((key) => process.env[key])) throw new Error('DECRYPT_CAPABILITY_LEAK');

  const results = [];
  for (const state of rows) {
    const result = { kind: 'phase', phase: state.phase, stateDigest: sha256(state), calls: 0 };
    try {
      Object.assign(result, await reviewPhase(state, { topK: 2 }, (reviewState, questions) => {
        result.calls++;
        return askJev(reviewState, questions, { key: process.env.JEV_API_KEY, endpoint: 'https://api.typesafe.ai/v1/systemone', timeoutMs: 15000 });
      }));
    } catch (error) {
      result.error = /^(JEV_HTTP_[0-9]{3}|JEV_MODEL_MISMATCH|INVALID_JEV_(JSON|ANSWERS)|INVALID_PHASE_STATE)$/.test(error?.message)
        ? error.message : 'EXECUTION_FAILED';
    }
    results.push(result); append(result);
  }
  const summary = summarize(results); append(summary); console.log(JSON.stringify(summary));
  if (summary.status !== 'OBSERVED') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => {
  console.error(error?.message ?? 'PARALLEL_DEVELOPMENT_PROOF_FAILED'); process.exitCode = 1;
});
