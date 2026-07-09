#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  runtimeBoundary,
  boundarySummary,
  assertNoForbiddenOwnership,
} from '../lib/boundary.mjs';

assert.equal(runtimeBoundary.kind, 'hq.modelingRuntime.boundary.v1');
assert.equal(runtimeBoundary.packageName, 'hq-modeling-runtime');
assert.equal(runtimeBoundary.ownerRepo, 'ops');
assert.deepEqual(runtimeBoundary.implementedNow, ['package-boundary-metadata', 'queue-schema-validator', 'local-worker', 'receipt-writer', 'repo-map-projection-builder']);
assert.ok(runtimeBoundary.owns.includes('queue validator core'));
assert.ok(runtimeBoundary.owns.includes('local worker core'));
assert.ok(runtimeBoundary.owns.includes('receipt writer core'));
assert.ok(runtimeBoundary.owns.includes('repo-map projection builder core'));

for (const issue of ['ops#44']) {
  assert.ok(
    Object.hasOwn(runtimeBoundary.reservedForLaterIssues, issue),
    `missing reserved issue ${issue}`,
  );
}
assert.ok(!Object.hasOwn(runtimeBoundary.reservedForLaterIssues, 'ops#40'));
assert.ok(!Object.hasOwn(runtimeBoundary.reservedForLaterIssues, 'ops#41'));
assert.ok(!Object.hasOwn(runtimeBoundary.reservedForLaterIssues, 'ops#42'));
assert.ok(!Object.hasOwn(runtimeBoundary.reservedForLaterIssues, 'ops#43'));

for (const forbidden of ['editor UX', 'Vim/hq command surface', 'browser renderer', 'UI state']) {
  assert.ok(runtimeBoundary.doesNotOwn.includes(forbidden), `doesNotOwn must include ${forbidden}`);
  assert.ok(!runtimeBoundary.owns.includes(forbidden), `owns must not include ${forbidden}`);
}

assert.equal(runtimeBoundary.authorityBoundary.queueRows, 'intent only');
assert.equal(runtimeBoundary.authorityBoundary.receipts, 'evidence only');
assert.equal(runtimeBoundary.authorityBoundary.projections, 'generated read models');
assert.match(runtimeBoundary.authorityBoundary.acceptedLedger, /not implemented in projection builder/);

assert.equal(assertNoForbiddenOwnership(), true);
assert.throws(
  () => assertNoForbiddenOwnership({ ...runtimeBoundary, owns: [...runtimeBoundary.owns, 'editor UX'] }),
  /forbidden ownership/,
);

const summary = boundarySummary();
assert.equal(summary.laterIssueCount, 1);
assert.deepEqual(summary.implementedNow, ['package-boundary-metadata', 'queue-schema-validator', 'local-worker', 'receipt-writer', 'repo-map-projection-builder']);

const here = path.dirname(fileURLToPath(import.meta.url));
const siblingBin = path.join(here, '..', 'bin', 'hq-modeling-runtime.mjs');
const cmd = fs.existsSync(siblingBin)
  ? [process.execPath, siblingBin]
  : ['hq-modeling-runtime'];

const output = execFileSync(cmd[0], [...cmd.slice(1), '--json'], {
  encoding: 'utf8',
  timeout: 10_000,
});
const parsed = JSON.parse(output);
assert.equal(parsed.kind, 'hq.modelingRuntime.boundary.v1');
assert.equal(parsed.ownerRepo, 'ops');
assert.equal(parsed.packageName, 'hq-modeling-runtime');
assert.deepEqual(parsed.implementedNow, ['package-boundary-metadata', 'queue-schema-validator', 'local-worker', 'receipt-writer', 'repo-map-projection-builder']);

console.log('hq-modeling-runtime scaffold check: PASS');
