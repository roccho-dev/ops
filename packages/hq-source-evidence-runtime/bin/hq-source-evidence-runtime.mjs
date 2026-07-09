#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { validateSourceJsonl } from '../lib/source-validator.mjs';
import { sourceReceiptsToJsonl, writeSourceReceiptsJsonl } from '../lib/source-receipt-writer.mjs';

function help() {
  console.log('usage: hq-source-evidence-runtime validate --input <source.jsonl> [--json]');
  console.log('       hq-source-evidence-runtime receipts --input <source.jsonl> [--jsonl|--json]');
  console.log('       hq-source-evidence-runtime summary --input <source.jsonl> [--json]');
}

function parseInputArgs(args, usage, extraOptions = {}) {
  const { values } = parseArgs({
    args,
    options: {
      input: { type: 'string' },
      json: { type: 'boolean', default: false },
      ...extraOptions,
    },
    strict: true,
  });
  if (!values.input) {
    console.error(usage);
    process.exit(2);
  }
  return values;
}

const argv = process.argv.slice(2);
if (argv.includes('--help')) {
  help();
  process.exit(0);
}

if (argv[0] === 'validate') {
  const values = parseInputArgs(argv.slice(1), 'usage: hq-source-evidence-runtime validate --input <source.jsonl> [--json]');
  const result = validateSourceJsonl(readFileSync(values.input, 'utf8'));
  if (values.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`source evidence validation: ${result.ok ? 'PASS' : 'FAIL'} records=${result.records} errors=${result.errors.length}`);
  process.exit(result.ok ? 0 : 1);
}

if (argv[0] === 'receipts') {
  const values = parseInputArgs(
    argv.slice(1),
    'usage: hq-source-evidence-runtime receipts --input <source.jsonl> [--jsonl|--json]',
    { jsonl: { type: 'boolean', default: false } },
  );
  const result = writeSourceReceiptsJsonl(readFileSync(values.input, 'utf8'));
  if (values.jsonl) process.stdout.write(sourceReceiptsToJsonl(result.receiptRows));
  else if (values.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`source receipt writer: ${result.ok ? 'PASS' : 'FAIL'} receipts=${result.receipts} digest=${result.receiptDigest}`);
  process.exit(result.ok ? 0 : 1);
}

if (argv[0] === 'summary') {
  const values = parseInputArgs(argv.slice(1), 'usage: hq-source-evidence-runtime summary --input <source.jsonl> [--json]');
  const result = validateSourceJsonl(readFileSync(values.input, 'utf8'));
  const summary = {
    kind: 'sourceEvidence.summary.v1',
    ok: result.ok,
    records: result.records,
    errors: result.errors.length,
    evidenceOnly: true,
    nonAuthority: true,
  };
  if (values.json) console.log(JSON.stringify(summary, null, 2));
  else console.log(`source evidence summary: ${summary.ok ? 'PASS' : 'FAIL'} records=${summary.records} errors=${summary.errors}`);
  process.exit(result.ok ? 0 : 1);
}

help();
process.exit(2);
