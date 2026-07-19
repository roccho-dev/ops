#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { runAdmissionGateJsonl, rowsToJsonl } from '../lib/admission-gate.mjs';
import { boundarySummary, assertNoForbiddenOwnership } from '../lib/boundary.mjs';
import { runLocalWorkerJsonl } from '../lib/local-worker.mjs';
import { promoteProposalToModelQueue } from '../lib/promotion-gate.mjs';
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
  console.log('       hq-modeling-runtime promote --input <proposal.json> --confirmation <confirmation.json> [--queue-jsonl|--receipt-jsonl|--json]');
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

function promotionFailure(code, message, extra = {}) {
  return {
    ok: false,
    errors: [{ code, message, ...extra }],
    queueRow: null,
  };
}

function hasRawBooleanIntent(args, option) {
  const exact = `--${option}`;
  const inlinePrefix = `${exact}=`;
  return args.some((arg) => typeof arg === 'string'
    && (arg === exact || arg.startsWith(inlinePrefix)));
}

function promotionOutputHints(args) {
  return {
    'queue-jsonl': hasRawBooleanIntent(args, 'queue-jsonl'),
    'receipt-jsonl': hasRawBooleanIntent(args, 'receipt-jsonl'),
    json: hasRawBooleanIntent(args, 'json'),
  };
}

function printPromotionFailure(result, values = {}) {
  const codes = result.errors.map((error) => error.code).join(',');
  if (values['queue-jsonl'] || values['receipt-jsonl']) {
    console.error(`hq proposal promotion: FAIL errors=${result.errors.length} codes=${codes}`);
  } else if (values.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`hq proposal promotion: FAIL errors=${result.errors.length} codes=${codes}`);
  }
}

function readPromotionJson(path, label) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    return promotionFailure(`${label}-read-failed`, `${label} JSON could not be read`, {
      path,
      reason: error?.code ?? 'read-error',
    });
  }

  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return promotionFailure(`${label}-invalid-json`, `${label} input must contain one JSON value`, {
      path,
      reason: error.message,
    });
  }
}

function parsePromotionArgs(args) {
  const usage = 'usage: hq-modeling-runtime promote --input <proposal.json> --confirmation <confirmation.json> [--queue-jsonl|--receipt-jsonl|--json]';
  const outputHints = promotionOutputHints(args);
  let values;
  try {
    ({ values } = parseArgs({
      args,
      options: {
        input: { type: 'string' },
        confirmation: { type: 'string' },
        'queue-jsonl': { type: 'boolean', default: false },
        'receipt-jsonl': { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
      },
      strict: true,
    }));
  } catch (error) {
    return {
      ok: false,
      exitCode: 2,
      values: outputHints,
      result: promotionFailure('promotion-usage-error', error.message, { usage }),
    };
  }

  values = { ...values, ...outputHints };
  if (!values.input) {
    return {
      ok: false,
      exitCode: 2,
      values,
      result: promotionFailure('promotion-input-required', '--input is required', { usage }),
    };
  }
  if (!values.confirmation) {
    return {
      ok: false,
      exitCode: 2,
      values,
      result: promotionFailure('promotion-confirmation-required', '--confirmation is required', { usage }),
    };
  }

  const outputModes = [values['queue-jsonl'], values['receipt-jsonl'], values.json].filter(Boolean).length;
  if (outputModes > 1) {
    return {
      ok: false,
      exitCode: 2,
      values,
      result: promotionFailure('promotion-output-mode-conflict', 'choose at most one promotion output mode', { usage }),
    };
  }

  return { ok: true, values };
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

if (argv[0] === 'promote') {
  const parsed = parsePromotionArgs(argv.slice(1));
  if (!parsed.ok) {
    printPromotionFailure(parsed.result, parsed.values);
    process.exit(parsed.exitCode);
  }

  const { values } = parsed;
  const proposalInput = readPromotionJson(values.input, 'proposal');
  if (!proposalInput.ok) {
    printPromotionFailure(proposalInput, values);
    process.exit(1);
  }
  const confirmationInput = readPromotionJson(values.confirmation, 'confirmation');
  if (!confirmationInput.ok) {
    printPromotionFailure(confirmationInput, values);
    process.exit(1);
  }

  const result = promoteProposalToModelQueue(proposalInput.value, confirmationInput.value);
  if (!result.ok) {
    printPromotionFailure(result, values);
    process.exit(1);
  }

  if (values['queue-jsonl']) {
    process.stdout.write(`${JSON.stringify(result.queueRow)}\n`);
  } else if (values['receipt-jsonl']) {
    process.stdout.write(`${JSON.stringify(result.promotionReceipt)}\n`);
  } else if (values.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`hq proposal promotion: PASS proposal=${result.promotionReceipt.proposalId} queue=${result.queueRow.id} digest=${result.queueRow.proposalDigest}`);
  }
  process.exit(0);
}

const args = new Set(argv);
if (args.size === 0 || args.has('--json')) {
  console.log(JSON.stringify(boundarySummary(), null, 2));
  process.exit(0);
}

console.error(`unknown argument: ${argv.join(' ')}`);
process.exit(2);
