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

const implemented = [
  'package-boundary-metadata',
  'queue-schema-validator',
  'local-worker',
  'receipt-writer',
  'repo-map-projection-builder',
  'local-dev-admission-gate',
  'cue-append-contract-adapter',
  'hq-local-root-catalog',
  'hq-serve-local-scaffold',
  'hq-ci-mode-contract',
  'github-issue-comment-readback-adapter-contract',
  'staged-canonical-promotion-eligibility',
];

assert.equal(runtimeBoundary.kind, 'hq.modelingRuntime.boundary.v1');
assert.equal(runtimeBoundary.packageName, 'hq-modeling-runtime');
assert.equal(runtimeBoundary.ownerRepo, 'ops');
assert.deepEqual(runtimeBoundary.implementedNow, implemented);
assert.ok(runtimeBoundary.owns.includes('queue validator core'));
assert.ok(runtimeBoundary.owns.includes('local worker core'));
assert.ok(runtimeBoundary.owns.includes('receipt writer core'));
assert.ok(runtimeBoundary.owns.includes('repo-map projection builder core'));
assert.ok(runtimeBoundary.owns.includes('local-dev admission gate core'));
assert.ok(runtimeBoundary.owns.includes('cue append contract adapter core'));
assert.ok(runtimeBoundary.owns.includes('hq local root catalog port'));
assert.ok(runtimeBoundary.owns.includes('local-only serve scaffold adapter'));
assert.ok(runtimeBoundary.owns.includes('ci artifact receipt boundary core'));
assert.ok(runtimeBoundary.owns.includes('GitHub issue-comment readback evidence adapter core'));
assert.ok(runtimeBoundary.owns.includes('staged-to-canonical promotion eligibility core'));

assert.equal(Object.keys(runtimeBoundary.reservedForLaterIssues).length, 0);
assert.ok(!Object.hasOwn(runtimeBoundary.reservedForLaterIssues, 'ops#40'));
assert.ok(!Object.hasOwn(runtimeBoundary.reservedForLaterIssues, 'ops#41'));
assert.ok(!Object.hasOwn(runtimeBoundary.reservedForLaterIssues, 'ops#42'));
assert.ok(!Object.hasOwn(runtimeBoundary.reservedForLaterIssues, 'ops#43'));
assert.ok(!Object.hasOwn(runtimeBoundary.reservedForLaterIssues, 'ops#44'));
assert.ok(!Object.hasOwn(runtimeBoundary.reservedForLaterIssues, 'ops#45'));
assert.ok(!Object.hasOwn(runtimeBoundary.reservedForLaterIssues, 'ops#63'));
assert.ok(!Object.hasOwn(runtimeBoundary.reservedForLaterIssues, 'ops#64'));
assert.ok(!Object.hasOwn(runtimeBoundary.reservedForLaterIssues, 'ops#65'));
assert.ok(!Object.hasOwn(runtimeBoundary.reservedForLaterIssues, 'ops#66'));
assert.ok(!Object.hasOwn(runtimeBoundary.reservedForLaterIssues, 'ops#67'));

for (const forbidden of [
  'editor UX',
  'Vim/hq command surface',
  'browser renderer',
  'UI state',
  'production governance authority',
  'CUE contract core implementation',
  'remote bare repo write implementation',
  'GitHub issue authority',
  'ChatGPT direct local control',
]) {
  assert.ok(runtimeBoundary.doesNotOwn.includes(forbidden), `doesNotOwn must include ${forbidden}`);
  assert.ok(!runtimeBoundary.owns.includes(forbidden), `owns must not include ${forbidden}`);
}

assert.equal(runtimeBoundary.authorityBoundary.queueRows, 'intent only');
assert.equal(runtimeBoundary.authorityBoundary.receipts, 'evidence only');
assert.equal(runtimeBoundary.authorityBoundary.projections, 'generated read models');
assert.match(runtimeBoundary.authorityBoundary.localRoot, /never SSOT/);
assert.match(runtimeBoundary.authorityBoundary.ciArtifacts, /ephemeral evidence only/);
assert.match(runtimeBoundary.authorityBoundary.githubReadback, /not accepted authority/);
assert.match(runtimeBoundary.authorityBoundary.acceptedLedger, /local-dev admission only/);
assert.match(runtimeBoundary.authorityBoundary.acceptedLedger, /production governance adoption is not implemented/);
assert.match(runtimeBoundary.authorityBoundary.canonicalPromotion, /remote bare repo becomes canonical/);
assert.match(runtimeBoundary.authorityBoundary.cueContractCore, /invoked through adapter only/);

assert.equal(assertNoForbiddenOwnership(), true);
assert.throws(
  () => assertNoForbiddenOwnership({ ...runtimeBoundary, owns: [...runtimeBoundary.owns, 'editor UX'] }),
  /forbidden ownership/,
);
assert.throws(
  () => assertNoForbiddenOwnership({ ...runtimeBoundary, owns: [...runtimeBoundary.owns, 'production governance authority'] }),
  /forbidden ownership/,
);
assert.throws(
  () => assertNoForbiddenOwnership({ ...runtimeBoundary, owns: [...runtimeBoundary.owns, 'CUE contract core implementation'] }),
  /forbidden ownership/,
);
assert.throws(
  () => assertNoForbiddenOwnership({ ...runtimeBoundary, owns: [...runtimeBoundary.owns, 'remote bare repo write implementation'] }),
  /forbidden ownership/,
);
assert.throws(
  () => assertNoForbiddenOwnership({ ...runtimeBoundary, owns: [...runtimeBoundary.owns, 'GitHub issue authority'] }),
  /forbidden ownership/,
);

const summary = boundarySummary();
assert.equal(summary.laterIssueCount, 0);
assert.deepEqual(summary.implementedNow, implemented);

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
assert.deepEqual(parsed.implementedNow, implemented);

console.log('hq-modeling-runtime scaffold check: PASS');
