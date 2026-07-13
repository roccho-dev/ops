#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { checkModelSourceReconcile } from '../lib/reconcile-checker.mjs';
import { buildReconcileProjection } from '../lib/reconcile-projection.mjs';

function parseJsonl(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function help() {
  console.log('usage: model-source-reconcile check --model <projection.json> --source <source.jsonl> --receipts <source-receipts.jsonl> [--json|--jsonl]');
  console.log('       model-source-reconcile projection --model <projection.json> --source <source.jsonl> --receipts <source-receipts.jsonl> [--json]');
}

function parseInputArgs(args, usage, extraOptions = {}) {
  const { values } = parseArgs({
    args,
    options: {
      model: { type: 'string' },
      source: { type: 'string' },
      receipts: { type: 'string' },
      json: { type: 'boolean', default: false },
      ...extraOptions,
    },
    strict: true,
  });
  if (!values.model || !values.source || !values.receipts) {
    console.error(usage);
    process.exit(2);
  }
  return values;
}

function readInputs(values) {
  return {
    modelProjection: JSON.parse(readFileSync(values.model, 'utf8')),
    sourceObservations: parseJsonl(readFileSync(values.source, 'utf8')),
    sourceReceipts: parseJsonl(readFileSync(values.receipts, 'utf8')),
  };
}

const argv = process.argv.slice(2);
if (argv.includes('--help')) {
  help();
  process.exit(0);
}

if (argv[0] === 'check') {
  const values = parseInputArgs(
    argv.slice(1),
    'usage: model-source-reconcile check --model <projection.json> --source <source.jsonl> --receipts <source-receipts.jsonl> [--json|--jsonl]',
    { jsonl: { type: 'boolean', default: false } },
  );
  const result = checkModelSourceReconcile(readInputs(values));
  if (values.jsonl) {
    process.stdout.write(`${result.rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  } else if (values.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`model-source reconcile: ${result.ok ? 'PASS' : 'FAIL'} checked=${result.checked} digest=${result.reconcileDigest}`);
  }
  process.exit(result.errors.length === 0 ? 0 : 1);
}

if (argv[0] === 'projection') {
  const values = parseInputArgs(
    argv.slice(1),
    'usage: model-source-reconcile projection --model <projection.json> --source <source.jsonl> --receipts <source-receipts.jsonl> [--json]',
  );
  const result = buildReconcileProjection(readInputs(values));
  if (values.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`model-source reconcile projection: ${result.ok ? 'PASS' : 'FAIL'} checked=${result.projection.layers.reconcile.checked} digest=${result.projection.projectionDigest}`);
  process.exit(result.projection.errors.length === 0 ? 0 : 1);
}

help();
process.exit(2);
