#!/usr/bin/env node
import assert from 'node:assert/strict';

import { proveTargetRefQueueWorker } from '../lib/cross-repo-proof.mjs';
import { createEditorToUiReceipt, validateEditorToUiReceipt } from '../lib/editor-to-ui-receipt.mjs';
import { proveProjectionToUiPreview } from '../lib/ui-preview-proof.mjs';

const targetRef = {
  kind: 'repoMap.node',
  id: 'pkg:core',
  source: 'ui.targetRef.fixture.v1',
};

const queueRow = {
  kind: 'hq.modelCommitQueued.v1',
  id: 'mq_e2ui_001',
  status: 'queued',
  targetRef,
  op: 'addEdge',
  payload: { from: 'pkg:core', to: 'pkg:ui', type: 'uses' },
  confirmedBy: 'human',
};

const front = proveTargetRefQueueWorker({ targetRef, queueRow });
const back = proveProjectionToUiPreview(JSON.stringify(queueRow));
assert.equal(front.ok, true, JSON.stringify(front.proof.errors));
assert.equal(back.ok, true, JSON.stringify(back.proof.errors));

const expected = {
  targetRefDigest: front.proof.targetRefDigest,
  queueDigest: front.proof.queueDigest,
  workerReceiptDigest: front.proof.workerReceiptDigest,
  projectionDigest: back.proof.projectionDigest,
  previewDigest: back.proof.previewDigest,
};

{
  const receipt = createEditorToUiReceipt({
    ...expected,
    sourceRefs: {
      targetRef: 'ui.fixture.targetRef',
      queueRow: 'edits.fixture.queueRow',
      workerReceipt: 'ops.fixture.workerReceipt',
      projection: 'ops.fixture.projection',
      preview: 'ui.fixture.preview',
    },
  });
  assert.equal(receipt.kind, 'crossRepo.editorToUiReceipt.v1');
  assert.equal(receipt.evidenceOnly, true);
  assert.equal(receipt.nonAuthority, true);
  assert.match(receipt.receiptDigest, /^sha256:/);
  assert.deepEqual(validateEditorToUiReceipt(receipt, expected), []);
}

{
  const receipt = createEditorToUiReceipt(expected);
  const bad = { ...receipt, previewDigest: expected.projectionDigest };
  const errors = validateEditorToUiReceipt(bad, expected);
  assert.ok(errors.some((error) => error.code === 'digest-mismatch' && error.field === 'previewDigest'));
  assert.ok(errors.some((error) => error.code === 'receipt-digest-mismatch'));
}

{
  const receipt = createEditorToUiReceipt(expected);
  const bad = { ...receipt, acceptedLedger: true };
  const errors = validateEditorToUiReceipt(bad, expected);
  assert.ok(errors.some((error) => error.code === 'authority-field-present'));
}

{
  const receipt = createEditorToUiReceipt(expected);
  const missing = { ...receipt };
  delete missing.queueDigest;
  const errors = validateEditorToUiReceipt(missing, expected);
  assert.ok(errors.some((error) => error.code === 'invalid-digest' && error.field === 'queueDigest'));
}

console.log('cross-repo editor-to-ui receipt schema check: PASS');
