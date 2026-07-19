#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { buildRepoMapProjectionFromQueueJsonl } from '../../hq-modeling-runtime/lib/projection-builder.mjs';
import { sourceObservationRow, sourceReceiptFromObservation, sourceReceiptsToJsonl } from '../../hq-source-evidence-runtime/lib/source-receipt-writer.mjs';
import { buildReconcileProjection } from '../lib/reconcile-projection.mjs';

const queue = {
  kind: 'hq.modelCommitQueued.v1',
  id: 'mq_package_ceo_repo_adrs',
  status: 'queued',
  targetRef: { kind: 'repoMap.edge', id: 'package:ceo->repo:adrs' },
  op: 'addEdge',
  payload: { from: 'package:ceo', to: 'repo:adrs', type: 'located_in' },
  confirmedBy: 'human',
  origin: { kind: 'direct-human.v1', confirmationId: 'confirmation:mq_package_ceo_repo_adrs', confirmedBy: 'human' },
};
const modelProjection = buildRepoMapProjectionFromQueueJsonl(JSON.stringify(queue)).projection;
const observation = sourceObservationRow({
  id: 'obs:package:ceo:repo:adrs',
  status: 'observed',
  surface: 'github',
  observedAt: '2026-07-09T00:00:00Z',
  subjectRef: { kind: 'package', id: 'package:ceo' },
  sourceRef: { kind: 'repo', id: 'repo:adrs' },
  observation: { exists: true, path: 'packages/ceo' },
});
const receipt = sourceReceiptFromObservation(observation);

{
  const result = buildReconcileProjection({
    modelProjection,
    sourceObservations: [observation],
    sourceReceipts: [receipt],
  });
  assert.equal(result.ok, true, JSON.stringify(result.projection.errors));
  assert.equal(result.projection.kind, 'modelSourceReconcile.projection.v1');
  assert.equal(result.projection.evidenceOnly, true);
  assert.equal(result.projection.nonAuthority, true);
  assert.match(result.projection.projectionDigest, /^sha256:/);
  assert.ok(result.projection.layers.model);
  assert.ok(result.projection.layers.source);
  assert.ok(result.projection.layers.reconcile);
  assert.equal(Object.keys(result.projection.layers).sort().join(','), 'model,reconcile,source');
  assert.equal(result.projection.layers.model.edges.length, 1);
  assert.equal(result.projection.layers.source.observations.length, 1);
  assert.equal(result.projection.layers.source.receipts.length, 1);
  assert.equal(result.projection.layers.reconcile.rows.length, 1);
  assert.equal(result.projection.layers.reconcile.rows[0].result, 'matched');
  assert.ok(!('accepted' in result.projection));
  assert.ok(!('acceptedLedger' in result.projection));
  assert.ok(!('ledgerAuthority' in result.projection));
}

{
  const result = buildReconcileProjection({
    modelProjection,
    sourceObservations: [],
    sourceReceipts: [],
  });
  assert.equal(result.ok, false);
  assert.equal(result.projection.layers.reconcile.rows[0].result, 'missing_source_observation');
  assert.equal(result.projection.layers.model.edges.length, 1);
  assert.equal(result.projection.layers.source.observations.length, 0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'model-source-reconcile-projection-'));
try {
  const modelPath = path.join(tmp, 'model.json');
  const sourcePath = path.join(tmp, 'source.jsonl');
  const receiptsPath = path.join(tmp, 'receipts.jsonl');
  fs.writeFileSync(modelPath, JSON.stringify(modelProjection));
  fs.writeFileSync(sourcePath, JSON.stringify(observation));
  fs.writeFileSync(receiptsPath, sourceReceiptsToJsonl([receipt]));

  const here = path.dirname(fileURLToPath(import.meta.url));
  const siblingBin = path.join(here, '..', 'bin', 'model-source-reconcile.mjs');
  const cmd = fs.existsSync(siblingBin)
    ? [process.execPath, siblingBin]
    : ['model-source-reconcile'];

  const out = execFileSync(cmd[0], [...cmd.slice(1), 'projection', '--model', modelPath, '--source', sourcePath, '--receipts', receiptsPath, '--json'], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  const parsed = JSON.parse(out);
  assert.equal(parsed.projection.layers.reconcile.rows[0].result, 'matched');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('model-source reconcile projection check: PASS');
