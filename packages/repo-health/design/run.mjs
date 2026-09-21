import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { JEV_MODEL, parseJsonl, sha256, stableJson } from '../lib/core.mjs';
import { askJev } from '../lib/jev.mjs';
import { BUILTIN_THEMES, review, structural, subjects } from './lint.mjs';

const equalSet = (a, b) => a.length === new Set(a).size && b.length === new Set(b).size
  && stableJson([...a].sort()) === stableJson([...b].sort());
const themeOf = (row) => BUILTIN_THEMES.find((t) => t.id === row.theme);
const safeError = (error) => /^(JEV_HTTP_[0-9]{3}|JEV_MODEL_MISMATCH|INVALID_JEV_(JSON|ANSWERS)|INVALID_CORPUS|INCOMPLETE_RESULTS|JEV_API_KEY_REQUIRED|DECRYPT_CAPABILITY_LEAK)$/.test(error?.message)
  ? error.message : 'EXECUTION_FAILED';

// Validate expectations BEFORE any credential use or network I/O.
export function validateCorpus(rows) {
  const invalid = () => { throw new Error('INVALID_CORPUS'); };
  if (!Array.isArray(rows) || rows.length !== 20 || rows.some((r) => !r || typeof r.id !== 'string' || !r.id) || !equalSet(rows.map((r) => r?.id), rows.map((r) => r?.id))) invalid();
  const semantic = rows.filter((r) => Object.hasOwn(r, 'theme'));
  if (semantic.length !== 16 || semantic.some((r) => !themeOf(r) || structural(r.design).length
    || !subjects(r.design, themeOf(r).scope).length
    || !(r.expected === 'valid' ? /^.+-a$/u : r.expected === 'defect' ? /^.+-b$/u : /$a/u).test(r.id))) invalid();
  if (rows.some((r) => !Object.hasOwn(r, 'theme') && (r.expected !== 'structural-defect' || !structural(r.design).length))) invalid();
  const pairs = semantic.filter((r) => r.expected === 'valid').map((valid) => {
    const defect = semantic.find((r) => r.id === `${valid.id.slice(0, -1)}b` && r.expected === 'defect' && r.theme === valid.theme);
    if (!defect) invalid();
    return { pair: valid.id.slice(0, -2), theme: valid.theme, valid: valid.id, defect: defect.id };
  });
  if (pairs.length !== 8 || !equalSet(pairs.flatMap((p) => [p.valid, p.defect]), semantic.map((r) => r.id))
    || new Set(pairs.map((p) => p.theme)).size !== BUILTIN_THEMES.length) invalid();
  return pairs;
}

export function summarize(rows, results) {
  const expectedPairs = validateCorpus(rows), scores = new Map();
  const invalid = () => { throw new Error('INCOMPLETE_RESULTS'); };
  if (!Array.isArray(results) || results.some((r) => !r) || !equalSet(rows.map((r) => r.id), results.map((r) => r.id))) invalid();
  let structuralDetected = 0, errors = 0;
  for (const row of rows) {
    const r = results.find((x) => x.id === row.id);
    if (r.expected !== row.expected || r.theme !== row.theme || r.designDigest !== sha256(row.design)) invalid();
    if (r.error) { errors++; continue; }
    if (!row.theme) {
      if (r.calls !== 0 || stableJson(r.hard) !== stableJson(structural(row.design))) invalid();
      structuralDetected++; continue;
    }
    const refs = subjects(row.design, themeOf(row).scope).map((ref) => JSON.stringify(ref)), g = r.ranked?.[0];
    if (r.calls !== 1 || !Array.isArray(r.hard) || r.hard.length || !Array.isArray(r.ranked) || r.ranked.length !== 1 || !g
      || g.theme !== row.theme || g.status !== 'evaluated' || g.candidates !== refs.length
      || g.evaluated !== refs.length || g.returned !== refs.length || !Array.isArray(g.findings)
      || !equalSet(refs, g.findings.map((f) => JSON.stringify(f.subject)))
      || g.findings.some((f) => !Number.isFinite(f.noul) || f.noul < 0 || f.noul > 1)) invalid();
    scores.set(row.id, Math.max(...g.findings.map((f) => f.noul)));
  }
  const pairs = expectedPairs.filter((p) => scores.has(p.valid) && scores.has(p.defect)).map((p) => {
    const valid = scores.get(p.valid), defect = scores.get(p.defect);
    return { pair: p.pair, theme: p.theme, valid, defect, delta: defect - valid,
      order: defect > valid ? 'correct' : defect < valid ? 'reversed' : 'tie' };
  });
  return { kind: 'summary', status: errors === 0 && scores.size === 16 && pairs.length === 8 && structuralDetected === 4 ? 'OBSERVED' : 'EXECUTION_ERROR',
    expectedCases: rows.length, observedCases: results.length, expectedSemantic: 16, evaluatedSemantic: scores.size,
    expectedPairs: expectedPairs.length, comparedPairs: pairs.length, structuralDetected,
    mechanicalJevCalls: results.filter((r) => !r.theme).reduce((n, r) => n + (r.calls ?? 0), 0),
    pairwiseCorrect: pairs.filter((p) => p.order === 'correct').length,
    pairwiseReversed: pairs.filter((p) => p.order === 'reversed').length, pairwiseTies: pairs.filter((p) => p.order === 'tie').length,
    pairs, requests: results.reduce((n, r) => n + (r.calls ?? 0), 0), errors, cost: null };
}

async function main() {
  const out = process.argv[2];
  if (!out || process.argv.length !== 3) throw new Error('usage: node design/run.mjs OUTPUT_JSONL (new file)');
  fs.writeFileSync(out, '', { flag: 'wx', mode: 0o600 });
  const append = (row) => fs.appendFileSync(out, `${JSON.stringify(row)}\n`);
  const results = [];
  try {
    const rows = parseJsonl(fs.readFileSync(new URL('cases.jsonl', import.meta.url), 'utf8'));
    validateCorpus(rows);
    append({ kind: 'manifest', mode: 'live', model: JEV_MODEL, corpusDigest: sha256(rows), themesDigest: sha256(BUILTIN_THEMES),
      opsSha: process.env.OPS_SHA ?? null, envsSha: process.env.ENVS_SHA ?? null,
      claim: 'Complete execution is not design acceptance; synthetic pairwise rankings only.' });
    if (!process.env.JEV_API_KEY?.trim()) throw new Error('JEV_API_KEY_REQUIRED');
    if (['SOPS_AGE_KEY', 'SOPS_AGE_KEY_FILE', 'SOPS_AGE_KEY_CMD'].some((k) => process.env[k])) throw new Error('DECRYPT_CAPABILITY_LEAK');
    for (const row of rows) {
      const start = performance.now();
      const result = { kind: 'case', id: row.id, theme: row.theme, expected: row.expected, designDigest: sha256(row.design), calls: 0 };
      try {
        if (!row.theme) result.hard = structural(row.design);
        else Object.assign(result, await review(row.design, { topK: subjects(row.design, themeOf(row).scope).length, themes: [themeOf(row)] }, (state, questions) => {
          result.calls++;
          return askJev(state, questions, { key: process.env.JEV_API_KEY, endpoint: 'https://api.typesafe.ai/v1/systemone', timeoutMs: 15000 });
        }));
      } catch (error) { result.error = safeError(error); }
      result.ms = Math.round(performance.now() - start); results.push(result); append(result);
    }
    const summary = summarize(rows, results); append(summary); console.log(JSON.stringify(summary));
    if (summary.status !== 'OBSERVED') process.exitCode = 1;
  } catch (error) {
    const summary = { kind: 'summary', status: 'EXECUTION_ERROR', error: safeError(error), observedCases: results.length };
    append(summary); console.log(JSON.stringify(summary)); process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('DESIGN_REPORT_NOT_WRITTEN'); process.exitCode = 1; });
}
