#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { runAdmissionGateJsonl, rowsToJsonl } from '../lib/admission-gate.mjs';
import { boundarySummary, assertNoForbiddenOwnership } from '../lib/boundary.mjs';
import { runLocalWorkerJsonl } from '../lib/local-worker.mjs';
import { buildRepoMapProjectionFromQueueJsonl } from '../lib/projection-builder.mjs';
import { runLocalWorkerWithReceiptsJsonl, receiptsToJsonl } from '../lib/receipt-writer.mjs';
import { validateJsonl } from '../lib/queue-validator.mjs';

assertNoForbiddenOwnership();

function printHelp() {
  console.log('usage: hq-modeling-runtime [--json]');
  console.log('       hq-modeling-runtime validate --input <queue.jsonl> [--json]');
  console.log('       hq-modeling-runtime work --input <queue.jsonl> [--json]');
  console.log('       hq-modeling-runtime receipts --input <queue.jsonl> [--jsonl|--json]');
  console.log('       hq-modeling-runtime projection --input <queue.jsonl> [--json]');
  console.log('       hq-modeling-runtime admit --input <queue.jsonl> [--accepted-jsonl|--receipt-jsonl|--json]');
  console.log('');
  console.log('Without a subcommand, prints the hq-modeling-runtime boundary summary.');
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
  printHelp();
  process.exit(0);
}

if (argv[0] === 'validate') {
  const values = parseInputArgs(argv.slice(1), 'usage: hq-modeling-runtime validate --input <queue.jsonl> [--json]');
  const result = validateJsonl(readFileSync(values.input, 'utf8'));
  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`hq queue validation: ${result.ok ? 'PASS' : 'FAIL'} records=${result.records} errors=${result.errors.length}`);
  }
  process.exit(result.ok ? 0 : 1);
}

if (argv[0] === 'work') {
  const values = parseInputArgs(argv.slice(1), 'usage: hq-modeling-runtime work --input <queue.jsonl> [--json]');
  const result = runLocalWorkerJsonl(readFileSync(values.input, 'utf8'));
  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`hq local worker: ${result.ok ? 'PASS' : 'FAIL'} processed=${result.processed} pending=${result.pending} ignored=${result.ignored} failed=${result.failed}`);
  }
  process.exit(result.ok ? 0 : 1);
}

if (argv[0] === 'receipts') {
  const values = parseInputArgs(
    argv.slice(1),
    'usage: hq-modeling-runtime receipts --input <queue.jsonl> [--jsonl|--json]',
    { jsonl: { type: 'boolean', default: false } },
  );
  const result = runLocalWorkerWithReceiptsJsonl(readFileSync(values.input, 'utf8'));
  if (values.jsonl) {
    process.stdout.write(receiptsToJsonl(result.receiptRows));
  } else if (values.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`hq receipt writer: ${result.ok ? 'PASS' : 'FAIL'} receipts=${result.receipts} digest=${result.receiptDigest}`);
  }
  process.exit(result.ok ? 0 : 1);
}

if (argv[0] === 'projection') {
  const values = parseInputArgs(argv.slice(1), 'usage: hq-modeling-runtime projection --input <queue.jsonl> [--json]');
  const result = buildRepoMapProjectionFromQueueJsonl(readFileSync(values.input, 'utf8'));
  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`hq repo-map projection: ${result.ok ? 'PASS' : 'FAIL'} nodes=${result.projection.nodes.length} edges=${result.projection.edges.length} digest=${result.projection.projectionDigest}`);
  }
  process.exit(result.ok ? 0 : 1);
}

if (argv[0] === 'admit') {
  const values = parseInputArgs(
    argv.slice(1),
    'usage: hq-modeling-runtime admit --input <queue.jsonl> [--accepted-jsonl|--receipt-jsonl|--json]',
    {
      'accepted-jsonl': { type: 'boolean', default: false },
      'receipt-jsonl': { type: 'boolean', default: false },
    },
  );
  const result = runAdmissionGateJsonl(readFileSync(values.input, 'utf8'));
  if (values['accepted-jsonl']) {
    process.stdout.write(rowsToJsonl(result.acceptedRows));
  } else if (values['receipt-jsonl']) {
    process.stdout.write(rowsToJsonl(result.admissionReceipts));
  } else if (values.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`hq admission gate: ${result.ok ? 'PASS' : 'FAIL'} admitted=${result.admitted} rejected=${result.rejected} ledgerDigest=${result.ledgerDigest}`);
  }
  process.exit(result.ok ? 0 : 1);
}

const args = new Set(argv);
if (args.size === 0 || args.has('--json')) {
  console.log(JSON.stringify(boundarySummary(), null, 2));
  process.exit(0);
}

console.error(`unknown argument: ${argv.join(' ')}`);
process.exit(2);
