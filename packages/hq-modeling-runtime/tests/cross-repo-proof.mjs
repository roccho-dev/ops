#!/usr/bin/env node
import assert from 'node:assert/strict';

import { proveTargetRefQueueWorker } from '../lib/cross-repo-proof.mjs';

const targetRef = {
  kind: 'repoMap.node',
  id: 'pkg:core',
  source: 'ui.targetRef.fixture.v1',
};

const queueRow = {
  kind: 'hq.modelCommitQueued.v1',
  id: 'mq_cross_001',
  status: 'queued',
  targetRef,
  op: 'addEdge',
  payload: { from: 'pkg:core', to: 'pkg:ui', type: 'uses' },
  confirmedBy: 'human',
  source: 'edits.queue.fixture.v1',
};

{
  const result = proveTargetRefQueueWorker({ targetRef, queueRow });
  assert.equal(result.ok, true, JSON.stringify(result.proof.errors));
  assert.equal(result.proof.kind, 'crossRepo.targetRefQueueWorkerProof.v1');
  assert.equal(result.proof.evidenceOnly, true);
  assert.equal(result.proof.nonAuthority, true);
  assert.equal(result.proof.queueId, 'mq_cross_001');
  assert.equal(result.proof.workerStatus, 'processed');
  assert.match(result.proof.targetRefDigest, /^sha256:/);
  assert.match(result.proof.queueDigest, /^sha256:/);
  assert.match(result.proof.workerReceiptDigest, /^sha256:/);
  assert.match(result.proof.proofDigest, /^sha256:/);
  assert.ok(!('accepted' in result.proof));
  assert.ok(!('acceptedLedger' in result.proof));
}

{
  const badQueue = { ...queueRow, targetRef: { ...targetRef, id: 'pkg:other' } };
  const result = proveTargetRefQueueWorker({ targetRef, queueRow: badQueue });
  assert.equal(result.ok, false);
  assert.ok(result.proof.errors.some((error) => error.code === 'targetRef-mismatch'));
}

{
  const badQueue = { ...queueRow, acceptedLedger: true };
  const result = proveTargetRefQueueWorker({ targetRef, queueRow: badQueue });
  assert.equal(result.ok, false);
  assert.ok(result.proof.errors.some((error) => error.code === 'authority-field-present'));
}

console.log('cross-repo targetRef queue worker proof check: PASS');
