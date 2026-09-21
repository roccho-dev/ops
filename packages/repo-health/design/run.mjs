import fs from 'node:fs';
import { JEV_MODEL, parseJsonl, sha256 } from '../lib/core.mjs';
import { askJev } from '../lib/jev.mjs';
import { BUILTIN_THEMES, review, structural } from './lint.mjs';

const rows = parseJsonl(fs.readFileSync(new URL('cases.jsonl', import.meta.url), 'utf8'));
const out = process.argv[2];
if (!out || process.argv.length !== 3) throw new Error('usage: node design/run.mjs OUTPUT_JSONL');
if (rows.length !== 20 || new Set(rows.map((r) => r.id)).size !== rows.length) throw new Error('INVALID_CORPUS');
const semantic = rows.filter((r) => r.theme);
if (semantic.length !== 16 || semantic.some((r) => !BUILTIN_THEMES.some((t) => t.id === r.theme) || !['valid','defect'].includes(r.expected))) throw new Error('INVALID_GOLD');
if (!process.env.JEV_API_KEY?.trim()) throw new Error('JEV_API_KEY_REQUIRED');
if (['SOPS_AGE_KEY','SOPS_AGE_KEY_FILE','SOPS_AGE_KEY_CMD'].some((k) => process.env[k])) throw new Error('DECRYPT_CAPABILITY_LEAK');

const report = [], persist = () => fs.writeFileSync(out, report.map((r) => JSON.stringify(r)).join('\n') + '\n', { mode:0o600 });
report.push({ kind:'manifest', mode:'live', model:JEV_MODEL, corpusDigest:sha256(rows), themesDigest:sha256(BUILTIN_THEMES),
  opsSha:process.env.OPS_SHA ?? null, envsSha:process.env.ENVS_SHA ?? null, semanticThresholds:null, ranking:'descending Noul within each theme',
  claim:'bounded synthetic design-ranking benchmark; not production admission' }); persist();

for (const row of rows) {
  const start = performance.now();
  let calls = 0;
  try {
    if (!row.theme) {
      report.push({ kind:'case', id:row.id, expected:row.expected, hard:structural(row.design), calls:0, ms:Math.round(performance.now()-start), designDigest:sha256(row.design) });
    } else {
      const theme = BUILTIN_THEMES.find((t) => t.id === row.theme);
      const result = await review(row.design, { topK:64, themes:[theme] }, (state, questions) => { calls++; return askJev(state, questions, {
        key:process.env.JEV_API_KEY, endpoint:'https://api.typesafe.ai/v1/systemone', timeoutMs:15000,
      }); });
      const score = result.ranked[0]?.findings[0]?.noul;
      report.push({ kind:'case', id:row.id, theme:row.theme, expected:row.expected, score, ...result,
        ms:Math.round(performance.now()-start), designDigest:sha256(row.design) });
    }
  } catch (error) {
    const code = /^(JEV_HTTP_[0-9]{3}|JEV_MODEL_MISMATCH|INVALID_JEV_(JSON|ANSWERS))$/.test(error.message) ? error.message : 'JEV_EXECUTION_FAILED';
    report.push({ kind:'case', id:row.id, theme:row.theme ?? 'structural', expected:row.expected, calls, error:code, ms:Math.round(performance.now()-start) });
  }
  persist();
}

const results = report.filter((r) => r.kind === 'case');
const sem = results.filter((r) => r.theme && r.theme !== 'structural');
const pairs = [];
for (const valid of sem.filter((r) => r.expected === 'valid')) {
  const prefix = valid.id.replace(/-a$/u, '');
  const defect = sem.find((r) => r.id === `${prefix}-b` && r.expected === 'defect' && r.theme === valid.theme);
  if (!defect || !Number.isFinite(valid.score) || !Number.isFinite(defect.score)) continue;
  pairs.push({ pair:prefix, theme:valid.theme, valid:valid.score, defect:defect.score, delta:defect.score-valid.score,
    order:defect.score>valid.score?'correct':defect.score<valid.score?'reversed':'tie' });
}
const summary = { kind:'summary', semanticThresholds:null, structuralDetected:results.filter((r) => !r.theme && r.expected === 'structural-defect' && r.hard?.length).length,
  mechanicalJevCalls:results.filter((r) => !r.theme).reduce((n,r) => n+(r.calls??0),0), pairwiseCorrect:pairs.filter((p) => p.order==='correct').length,
  pairwiseReversed:pairs.filter((p) => p.order==='reversed').length, pairwiseTies:pairs.filter((p) => p.order==='tie').length,
  pairs, requests:results.reduce((n,r) => n+(r.calls??0),0), errors:results.filter((r) => r.error).length,
  cost:null, costNote:'Usage retained; monetary cost not measured.' };
summary.status = summary.errors===0 && summary.structuralDetected===4 && summary.mechanicalJevCalls===0 ? 'OBSERVED' : 'EXECUTION_ERROR';
report.push(summary); persist();
console.log(JSON.stringify(summary));
if (summary.status !== 'OBSERVED') process.exitCode = 1;
