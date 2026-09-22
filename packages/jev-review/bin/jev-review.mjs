#!/usr/bin/env node
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { JEV_MODEL } from '../core.mjs';
import { askJev } from '../jev.mjs';
import { rankJudgments } from '../rank.mjs';
import { evaluate } from '../review.mjs';

const exactKeys = (value, names) => value && [Object.prototype, null].includes(Object.getPrototypeOf(value))
  && Reflect.ownKeys(value).length === names.length && names.every((name) => Object.hasOwn(value, name));

export function validateCliInput(input) {
  const names = Object.hasOwn(input ?? {}, 'topK') ? ['state', 'themes', 'items', 'topK'] : ['state', 'themes', 'items'];
  if (!exactKeys(input, names) || !input.state || typeof input.state !== 'object' || Array.isArray(input.state)) {
    throw new Error('INVALID_JEV_REVIEW_INPUT');
  }
  if (Object.hasOwn(input, 'topK') && (!Number.isSafeInteger(input.topK) || input.topK < 0)) {
    throw new Error('INVALID_JEV_REVIEW_TOP_K');
  }
  return input;
}

export async function evaluateInput(input, ask) {
  validateCliInput(input);
  const { state, themes, items } = input;
  const result = await evaluate(state, { themes, items }, ask);
  const ranking = Object.hasOwn(input, 'topK')
    ? rankJudgments(result.judgments, { topK: input.topK, themes, items })
    : null;
  return { model: JEV_MODEL, ...result, ranking };
}

export function rowsForEvaluation(input, result) {
  validateCliInput(input);
  const rows = [
    {
      kind: 'jevReview.manifest.v1',
      model: result.model,
      authority: false,
      topK: Object.hasOwn(input, 'topK') ? input.topK : null,
      themes: [...input.themes],
      items: input.items.length,
    },
    ...result.judgments.map((row) => ({ kind: 'jevReview.judgment.v1', ...row })),
    ...result.coverage.map((row) => ({ kind: 'jevReview.coverage.v1', ...row })),
  ];
  if (result.ranking) {
    rows.push(...result.ranking.map((row) => ({ kind: 'jevReview.ranking.v1', ...row })));
  }
  rows.push({
    kind: 'jevReview.receipt.v1',
    model: result.model,
    authority: false,
    judgments: result.judgments.length,
    coverage: result.coverage.length,
    ranked: result.ranking?.length ?? 0,
    calls: result.calls,
    usage: result.usage,
  });
  return rows;
}

export function serializeJsonl(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('EMPTY_JEV_REVIEW_OUTPUT');
  return rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
}

export function parseJsonl(text) {
  return String(text).split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch (error) { throw new Error(`INVALID_JEV_REVIEW_JSONL_LINE_${index + 1}: ${error.message}`); }
  });
}

export function writeAndReadback(file, rows) {
  const text = serializeJsonl(rows);
  fs.writeFileSync(file, text, { flag: 'wx', mode: 0o600 });
  const readback = parseJsonl(fs.readFileSync(file, 'utf8'));
  if (JSON.stringify(readback) !== JSON.stringify(rows)) throw new Error('JEV_REVIEW_READBACK_MISMATCH');
  return readback;
}

async function main() {
  const [inputFile, outputFile, extra] = process.argv.slice(2);
  if (!inputFile || !outputFile || extra) throw new Error('usage: jev-review INPUT.json OUTPUT.jsonl');
  const input = validateCliInput(JSON.parse(fs.readFileSync(inputFile, 'utf8')));
  const result = await evaluateInput(input, (state, questions) => askJev(state, questions, {
    key: process.env.JEV_API_KEY,
    endpoint: process.env.JEV_API_URL || 'https://api.typesafe.ai/v1/systemone',
    timeoutMs: Number(process.env.JEV_TIMEOUT_MS || '15000'),
  }));
  const rows = rowsForEvaluation(input, result);
  writeAndReadback(outputFile, rows);
  process.stdout.write(JSON.stringify({
    status: 'OBSERVED',
    model: result.model,
    judgments: result.judgments.length,
    themes: result.coverage.length,
    ranked: result.ranking?.reduce((sum, row) => sum + row.returned, 0) ?? 0,
    authority: false,
    output: outputFile,
  }) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.message ?? 'JEV_REVIEW_FAILED');
    process.exitCode = 1;
  });
}
