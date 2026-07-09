#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  canonicalPromotionContract,
  evaluateCanonicalPromotionCandidate,
} from '../lib/canonical-promotion.mjs';

assert.equal(canonicalPromotionContract.kind, 'hq.canonicalPromotion.contract.v1');
assert.equal(canonicalPromotionContract.stagedAcceptedKind, 'accepted.modelCommit.v1');
assert.equal(canonicalPromotionContract.canonicalTarget, 'remote-bare-repo');

const stagedAcceptedRows = [
  {
    kind: 'accepted.modelCommit.v1',
    id: 'accepted-1',
    sourceQueueDigest: 'sha256:q1',
    acceptedDigest: 'sha256:a1',
  },
];
const receipts = [
  { kind: 'admission.receipt.v1', status: 'passed', digest: 'sha256:admission' },
  { kind: 'hq.cueAppendContract.receipt.v1', status: 'passed', digest: 'sha256:cue' },
  { kind: 'remote.writeCandidateManifest.v1', status: 'prepared', digest: 'sha256:manifest' },
  { kind: 'remote.readback.receipt.v1', status: 'matched', target: 'remote-bare-repo', digest: 'sha256:readback' },
];

const valid = evaluateCanonicalPromotionCandidate({ stagedAcceptedRows, receipts });
assert.equal(valid.ok, true);
assert.equal(valid.eligible, true);
assert.equal(valid.authority, false);
assert.equal(valid.canonicalAuthorityAfterPromotionOnly, true);
assert.match(valid.candidateDigest, /^sha256:/);

const queueOnly = evaluateCanonicalPromotionCandidate({
  stagedAcceptedRows,
  receipts,
  queueRows: [{ kind: 'hq.modelCommitQueued.v1', id: 'q1' }],
});
assert.equal(queueOnly.ok, false);
assert.ok(queueOnly.errors.some((error) => error.code === 'queue-only-not-promotable'));

const artifactOnly = evaluateCanonicalPromotionCandidate({
  stagedAcceptedRows,
  receipts,
  projection: { kind: 'repoMap.projection.v1' },
});
assert.equal(artifactOnly.ok, false);
assert.ok(artifactOnly.errors.some((error) => error.code === 'artifact-only-not-promotable'));

const missingReceipt = evaluateCanonicalPromotionCandidate({
  stagedAcceptedRows,
  receipts: receipts.filter((receipt) => receipt.kind !== 'hq.cueAppendContract.receipt.v1'),
});
assert.equal(missingReceipt.ok, false);
assert.ok(missingReceipt.errors.some((error) => error.code === 'missing-required-receipt'));

const staleReadback = evaluateCanonicalPromotionCandidate({
  stagedAcceptedRows,
  receipts: receipts.map((receipt) => receipt.kind === 'remote.readback.receipt.v1' ? { ...receipt, stale: true } : receipt),
});
assert.equal(staleReadback.ok, false);
assert.ok(staleReadback.errors.some((error) => error.code === 'stale-remote-readback'));

const wrongTarget = evaluateCanonicalPromotionCandidate({
  stagedAcceptedRows,
  receipts: receipts.map((receipt) => receipt.kind === 'remote.readback.receipt.v1' ? { ...receipt, target: 'github-issues' } : receipt),
});
assert.equal(wrongTarget.ok, false);
assert.ok(wrongTarget.errors.some((error) => error.code === 'wrong-remote-target'));

const authorityClaim = evaluateCanonicalPromotionCandidate({
  stagedAcceptedRows: [{ ...stagedAcceptedRows[0], authority: true }],
  receipts,
});
assert.equal(authorityClaim.ok, false);
assert.ok(authorityClaim.errors.some((error) => error.code === 'authority-field-present'));

console.log('hq staged to canonical promotion boundary check: PASS');
