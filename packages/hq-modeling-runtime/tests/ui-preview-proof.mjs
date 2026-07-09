#!/usr/bin/env node
import assert from 'node:assert/strict';

import { proveProjectionToUiPreview } from '../lib/ui-preview-proof.mjs';

const queueRow = {
  kind: 'hq.modelCommitQueued.v1',
  id: 'mq_preview_001',
  status: 'queued',
  targetRef: { kind: 'repoMap.node', id: 'pkg:core' },
  op: 'addEdge',
  payload: { from: 'pkg:core', to: 'pkg:ui', type: 'uses' },
  confirmedBy: 'human',
};

{
  const result = proveProjectionToUiPreview(JSON.stringify(queueRow));
  assert.equal(result.ok, true, JSON.stringify(result.proof.errors));
  assert.equal(result.proof.kind, 'crossRepo.opsProjectionUiPreviewProof.v1');
  assert.equal(result.proof.evidenceOnly, true);
  assert.equal(result.proof.nonAuthority, true);
  assert.equal(result.proof.projectionKind, 'repoMap.projection.v1');
  assert.equal(result.proof.previewKind, 'ui.previewArtifact.v1');
  assert.match(result.proof.projectionDigest, /^sha256:/);
  assert.match(result.proof.previewDigest, /^sha256:/);
  assert.match(result.proof.proofDigest, /^sha256:/);
  assert.equal(result.proof.preview.nodeCount, 2);
  assert.equal(result.proof.preview.edgeCount, 1);
  assert.ok(!('accepted' in result.proof));
  assert.ok(!('uiState' in result.proof));
}

{
  const changed = { ...queueRow, payload: { from: 'pkg:core', to: 'pkg:ops', type: 'uses' } };
  const first = proveProjectionToUiPreview(JSON.stringify(queueRow));
  const second = proveProjectionToUiPreview(JSON.stringify(changed));
  assert.notEqual(first.proof.previewDigest, second.proof.previewDigest, 'preview digest must change when projection input changes');
}

{
  const bad = { ...queueRow, payload: { acceptedLedger: true } };
  const result = proveProjectionToUiPreview(JSON.stringify(bad));
  assert.equal(result.ok, false);
  assert.ok(result.proof.errors.some((error) => error.code === 'authority-field-present'));
  assert.equal(result.proof.preview.edgeCount, 0);
}

console.log('ops projection to ui preview proof check: PASS');
