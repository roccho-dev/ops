#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { boundarySummary, assertNoForbiddenOwnership } from '../lib/boundary.mjs';
import { validateJsonl } from '../lib/queue-validator.mjs';

assertNoForbiddenOwnership();

function printHelp() {
  console.log('usage: hq-modeling-runtime [--json]');
  console.log('       hq-modeling-runtime validate --input <queue.jsonl> [--json]');
  console.log('');
  console.log('Without a subcommand, prints the hq-modeling-runtime boundary summary.');
}

const argv = process.argv.slice(2);

if (argv.includes('--help')) {
  printHelp();
  process.exit(0);
}

if (argv[0] === 'validate') {
  const { values } = parseArgs({
    args: argv.slice(1),
    options: {
      input: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
    strict: true,
  });

  if (!values.input) {
    console.error('usage: hq-modeling-runtime validate --input <queue.jsonl> [--json]');
    process.exit(2);
  }

  const result = validateJsonl(readFileSync(values.input, 'utf8'));
  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`hq queue validation: ${result.ok ? 'PASS' : 'FAIL'} records=${result.records} errors=${result.errors.length}`);
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
