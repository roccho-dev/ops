import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JEV_MODEL } from '../core.mjs';
import { evaluate } from '../review.mjs';
import { rankJudgments } from '../rank.mjs';
import { evaluateInput, parseJsonl, rowsForEvaluation, serializeJsonl, validateCliInput, writeAndReadback } from '../bin/jev-review.mjs';

const state = { purpose: 'fixture' };
const themes = ['purpose', 'scope'];
const items = [
  { theme: 'purpose', subject: ['candidate', 'a'], concern: 'May miss the purpose.' },
  { theme: 'purpose', subject: ['candidate', 'b'], concern: 'May miss the purpose.' },
  { theme: 'scope', subject: ['candidate', 'a'], concern: 'May leak scope.' },
];

let calls = 0;
const result = await evaluate(state, { themes, items }, async (_, questions) => {
  calls++;
  return {
    model: JEV_MODEL,
    answers: Object.fromEntries(Object.keys(questions).map((key, index) => [key, { type: 'noul', noul: [0.1, 0.9, 0.2][index] }])),
  };
});
assert.equal(calls, 1);
assert.equal(result.judgments.length, 3);
assert.deepEqual(result.coverage, [
  { theme: 'purpose', candidates: 2, evaluated: 2 },
  { theme: 'scope', candidates: 1, evaluated: 1 },
]);
const ranked = rankJudgments(result.judgments, { topK: 1, themes, items });
assert.deepEqual(ranked.map((group) => [group.theme, group.candidates, group.evaluated, group.returned]), [
  ['purpose', 2, 2, 1],
  ['scope', 1, 1, 1],
]);
assert.deepEqual(ranked[0].findings[0].subject, ['candidate', 'b']);

const empty = await evaluate(state, { themes: ['empty'], items: [] }, async () => { throw new Error('MUST_NOT_CALL'); });
assert.equal(empty.calls, 0);
assert.deepEqual(empty.coverage, [{ theme: 'empty', candidates: 0, evaluated: 0 }]);
assert.equal(rankJudgments([], { topK: 2, themes: ['empty'], items: [] })[0].status, 'empty');
assert.equal(rankJudgments([], { topK: 0, themes, items })[0].status, 'disabled');

await assert.rejects(() => evaluate(state, { themes: ['purpose'], items: items.slice(0, 1) }, async (_, questions) => ({
  model: 'other',
  answers: Object.fromEntries(Object.keys(questions).map((key) => [key, { type: 'noul', noul: 0.5 }])),
})), /JEV_MODEL_MISMATCH/);
assert.throws(() => rankJudgments(result.judgments.slice(0, 1), { topK: 1, themes, items }), /JUDGMENT_SET_MISMATCH/);
await assert.rejects(() => evaluate(state, { themes: ['purpose'], items: [items[0], structuredClone(items[0])] }, async () => ({})), /DUPLICATE_REVIEW_ITEM/);

const authRows = parseJsonl(fs.readFileSync(new URL('../artifact.jsonl', import.meta.url), 'utf8'));
assert.deepEqual(authRows, [{ artifact: 'jev-review', kind: 'artifact.auth.v1', requiredCapabilities: ['jev-api'] }]);

const cliInput = { state, themes, items, topK: 1 };
validateCliInput(cliInput);
assert.throws(() => validateCliInput({ ...cliInput, extra: true }), /INVALID_JEV_REVIEW_INPUT/);
assert.throws(() => validateCliInput({ state, themes, items, topK: 0 }), /INVALID_JEV_REVIEW_TOP_K/);
const cliResult = await evaluateInput(cliInput, async (_, questions) => ({
  model: JEV_MODEL,
  answers: Object.fromEntries(Object.keys(questions).map((key, index) => [key, { type: 'noul', noul: [0.1, 0.9, 0.2][index] }])),
  usage: { input_tokens: 3, output_tokens: 3 },
}));
const rows = rowsForEvaluation(cliInput, cliResult);
const encoded = serializeJsonl(rows);
assert.equal(encoded.endsWith('\n'), true);
assert.equal(encoded.split('\n').filter(Boolean).length, rows.length);
assert.deepEqual(parseJsonl(encoded), rows);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-review-'));
try {
  const out = path.join(tmp, 'result.jsonl');
  assert.deepEqual(writeAndReadback(out, rows), rows);
  const physical = fs.readFileSync(out, 'utf8');
  assert.equal(physical.split('\n').filter(Boolean).length, rows.length);
  assert.equal(physical.includes('}\\\\n{'), false);
  assert.throws(() => writeAndReadback(out, rows), /EEXIST/u);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(JSON.stringify({
  status: 'PASS',
  core: 'semantic-evaluate',
  ranking: 'derived',
  cli: 'json-input-jsonl-output-readback',
  semanticThresholds: 0,
}));
