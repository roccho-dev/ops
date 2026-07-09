#!/usr/bin/env node
import { boundarySummary, assertNoForbiddenOwnership } from '../lib/boundary.mjs';

assertNoForbiddenOwnership();

const summary = boundarySummary();
const args = new Set(process.argv.slice(2));

if (args.has('--help')) {
  console.log('usage: hq-modeling-runtime [--json]');
  console.log('Prints the hq-modeling-runtime scaffold boundary.');
  process.exit(0);
}

if (args.size === 0 || args.has('--json')) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

console.error(`unknown argument: ${[...args].join(' ')}`);
process.exit(2);
