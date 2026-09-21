import fs from 'node:fs';
import { JEV_MODEL, parseJsonl, sha256 } from '../lib/core.mjs';
import { askJev } from '../lib/jev.mjs';
import { lint, structural, RULES, THRESHOLDS } from './lint.mjs';

// No caller-selected endpoint, input corpus, model fallback, or retry on the live path.
const rows = parseJsonl(fs.readFileSync(new URL('cases.jsonl', import.meta.url), 'utf8'));
const out = process.argv[2];
if (!out || process.argv.length !== 3) throw new Error('usage: node design/run.mjs OUTPUT_JSONL');
if (rows.length !== 20 || new Set(rows.map((r) => r.id)).size !== rows.length) throw new Error('INVALID_CORPUS');
const semantic = rows.filter((r) => r.rule);
if (semantic.length !== 16 || semantic.some((r) => !Object.hasOwn(RULES, r.rule) || !['PASS', 'FAIL'].includes(r.expected))) throw new Error('INVALID_GOLD');
if (!process.env.JEV_API_KEY?.trim()) throw new Error('JEV_API_KEY_REQUIRED');
if (['SOPS_AGE_KEY', 'SOPS_AGE_KEY_FILE', 'SOPS_AGE_KEY_CMD'].some((k) => process.env[k])) throw new Error('DECRYPT_CAPABILITY_LEAK');
const report = [];
const persist = () => fs.writeFileSync(out, report.map((r) => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 });
report.push({ kind: 'manifest', mode: 'live', model: JEV_MODEL, corpusDigest: sha256(rows), rulesDigest: sha256({ RULES, THRESHOLDS }),
  opsSha: process.env.OPS_SHA ?? null, envsSha: process.env.ENVS_SHA ?? null, maxRequests: 16, retry: 0, claim: 'bounded synthetic design benchmark; not production admission' });
persist();
for (const row of rows) {
  const start = performance.now();
  let requests = 0;
  try {
    const result = await lint(row.design, row.rule ? [row.rule] : ['purpose'], (state, questions) => { requests++; return askJev(state, questions, {
      key: process.env.JEV_API_KEY, endpoint: 'https://api.typesafe.ai/v1/systemone', timeoutMs: 15000,
    }); });
    const actual = result.hard.length ? 'FAIL' : result.judgments[0].status;
    report.push({ kind: 'case', id: row.id, rule: row.rule ?? 'structural', expected: row.expected, actual,
      ...result, ms: Math.round(performance.now() - start), designDigest: sha256(row.design) });
  } catch (error) {
    const code = /^(JEV_HTTP_[0-9]{3}|JEV_MODEL_MISMATCH|INVALID_JEV_(JSON|ANSWERS))$/.test(error.message) ? error.message : 'JEV_EXECUTION_FAILED';
    report.push({ kind: 'case', id: row.id, rule: row.rule ?? 'structural', expected: row.expected, actual: 'UNKNOWN', calls: requests, error: code, ms: Math.round(performance.now() - start) });
  }
  persist();
}
const results = report.filter((r) => r.kind === 'case');
const sem = results.filter((r) => r.rule !== 'structural');
const added = sem.filter((r) => r.expected === 'FAIL' && r.actual === 'FAIL' && r.calls === 1 && r.hard.length === 0);
const summary = { kind: 'summary', total: results.length,
  baselineStructuralDetected: rows.filter((r) => !r.rule && r.expected === 'FAIL' && structural(r.design).length).length,
  addedTruePositives: added.length,
  falsePositives: sem.filter((r) => r.expected === 'PASS' && r.actual === 'FAIL').length,
  falseNegatives: sem.filter((r) => r.expected === 'FAIL' && r.actual === 'PASS').length,
  unknown: results.filter((r) => r.actual === 'UNKNOWN').length,
  mechanicalJevCalls: results.filter((r) => r.rule === 'structural').reduce((n, r) => n + (r.calls ?? 0), 0),
  coveredRules: [...new Set(added.map((r) => r.rule))].sort(),
  requests: results.reduce((n, r) => n + (r.calls ?? 0), 0),
  cost: null, costNote: 'Usage retained; monetary cost not measured.',
};
summary.status = summary.falsePositives === 0 && summary.falseNegatives === 0 && summary.unknown === 0
  && summary.mechanicalJevCalls === 0 && summary.baselineStructuralDetected === 4 && summary.coveredRules.length === 6 ? 'PASS_BOUNDED_POC' : 'FAIL_BOUNDED_POC';
report.push(summary); persist();
console.log(JSON.stringify(summary));
if (summary.status !== 'PASS_BOUNDED_POC') process.exitCode = 1;
