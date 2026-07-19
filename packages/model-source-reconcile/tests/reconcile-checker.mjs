#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { runAdmissionGateJsonl } from '../../hq-modeling-runtime/lib/admission-gate.mjs';
import { buildRepoMapProjectionFromQueueJsonl } from '../../hq-modeling-runtime/lib/projection-builder.mjs';
import { sourceObservationRow, sourceReceiptFromObservation, sourceReceiptsToJsonl } from '../../hq-source-evidence-runtime/lib/source-receipt-writer.mjs';
import { checkModelSourceReconcile } from '../lib/reconcile-checker.mjs';

const modelQueue = {
  kind: 'hq.modelCommitQueued.v1',
  id: 'mq_package_ceo_repo_adrs',
  status: 'queued',
  targetRef: { kind: 'repoMap.edge', id: 'package:ceo->repo:adrs' },
  op: 'addEdge',
  payload: { from: 'package:ceo', to: 'repo:adrs', type: 'located_in' },
  confirmedBy: 'human',
  origin: { kind: 'direct-human.v1', confirmationId: 'confirmation:mq_package_ceo_repo_adrs', confirmedBy: 'human' },
};

const modelProjection = buildRepoMapProjectionFromQueueJsonl(JSON.stringify(modelQueue)).projection;

const observedInAdrs = sourceObservationRow({
  id: 'obs:package:ceo:repo:adrs',
  status: 'observed',
  surface: 'github',
  observedAt: '2026-07-09T00:00:00Z',
  subjectRef: { kind: 'package', id: 'package:ceo' },
  sourceRef: { kind: 'repo', id: 'repo:adrs' },
  observation: { exists: true, path: 'packages/ceo' },
});
const observedInOtherRepo = sourceObservationRow({
  id: 'obs:package:ceo:repo:other',
  status: 'observed',
  surface: 'github',
  observedAt: '2026-07-09T00:00:00Z',
  subjectRef: { kind: 'package', id: 'package:ceo' },
  sourceRef: { kind: 'repo', id: 'repo:other' },
  observation: { exists: true, path: 'packages/ceo' },
});
const missingInAdrs = sourceObservationRow({
  id: 'obs:package:ceo:repo:adrs:missing',
  status: 'missing',
  surface: 'github',
  observedAt: '2026-07-09T00:00:00Z',
  subjectRef: { kind: 'package', id: 'package:ceo' },
  sourceRef: { kind: 'repo', id: 'repo:adrs' },
  observation: { exists: false, path: 'packages/ceo' },
});

{
  const receipt = sourceReceiptFromObservation(observedInAdrs);
  const result = checkModelSourceReconcile({
    modelProjection,
    sourceObservations: [observedInAdrs],
    sourceReceipts: [receipt],
  });
  assert.equal(result.ok, true, JSON.stringify(result.rows));
  assert.equal(result.checked, 1);
  assert.equal(result.rows[0].kind, 'model_source_reconcile.v1');
  assert.equal(result.rows[0].result, 'matched');
  assert.equal(result.rows[0].evidenceOnly, true);
  assert.equal(result.rows[0].nonAuthority, true);
  assert.match(result.rows[0].reconcileDigest, /^sha256:/);
}

{
  const result = checkModelSourceReconcile({
    modelProjection,
    sourceObservations: [],
    sourceReceipts: [],
  });
  assert.equal(result.ok, false);
  assert.equal(result.rows[0].result, 'missing_source_observation');
}

{
  const result = checkModelSourceReconcile({
    modelProjection,
    sourceObservations: [missingInAdrs],
    sourceReceipts: [sourceReceiptFromObservation(missingInAdrs)],
  });
  assert.equal(result.ok, false);
  assert.equal(result.rows[0].result, 'missing_source_observation');
}

{
  const result = checkModelSourceReconcile({
    modelProjection,
    sourceObservations: [observedInOtherRepo],
    sourceReceipts: [sourceReceiptFromObservation(observedInOtherRepo)],
  });
  assert.equal(result.ok, false);
  assert.equal(result.rows[0].result, 'conflict');
}

{
  const mutatedReceipt = { ...sourceReceiptFromObservation(observedInAdrs), observedDigest: 'sha256:stale' };
  const result = checkModelSourceReconcile({
    modelProjection,
    sourceObservations: [observedInAdrs],
    sourceReceipts: [mutatedReceipt],
  });
  assert.equal(result.ok, false);
  assert.equal(result.rows[0].result, 'stale_source_receipt');
}

{
  const mutatedReceipt = { ...sourceReceiptFromObservation(observedInAdrs), receiptDigest: 'sha256:mutated' };
  const result = checkModelSourceReconcile({
    modelProjection,
    sourceObservations: [observedInAdrs],
    sourceReceipts: [mutatedReceipt],
  });
  assert.equal(result.ok, false);
  assert.equal(result.rows[0].result, 'invalid_source_receipt');
}

{
  const reconcileRow = checkModelSourceReconcile({
    modelProjection,
    sourceObservations: [observedInAdrs],
    sourceReceipts: [sourceReceiptFromObservation(observedInAdrs)],
  }).rows[0];
  const direct = runAdmissionGateJsonl(JSON.stringify(reconcileRow));
  assert.equal(direct.ok, false);
  assert.equal(direct.admitted, 0);
  assert.ok(direct.errors.some((error) => error.code === 'unknown-kind'));

  const smuggled = runAdmissionGateJsonl(JSON.stringify({
    ...modelQueue,
    id: 'mq_smuggled_reconcile',
    origin: { kind: 'direct-human.v1', confirmationId: 'confirmation:mq_smuggled_reconcile', confirmedBy: 'human' },
    payload: { embedded: reconcileRow },
  }));
  assert.equal(smuggled.ok, false);
  assert.equal(smuggled.admitted, 0);
  assert.ok(smuggled.errors.some((error) => error.code === 'payload-smuggled-row'));
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'model-source-reconcile-'));
try {
  const modelPath = path.join(tmp, 'model.json');
  const sourcePath = path.join(tmp, 'source.jsonl');
  const receiptsPath = path.join(tmp, 'receipts.jsonl');
  fs.writeFileSync(modelPath, JSON.stringify(modelProjection));
  fs.writeFileSync(sourcePath, JSON.stringify(observedInAdrs));
  fs.writeFileSync(receiptsPath, sourceReceiptsToJsonl([sourceReceiptFromObservation(observedInAdrs)]));

  const here = path.dirname(fileURLToPath(import.meta.url));
  const siblingBin = path.join(here, '..', 'bin', 'model-source-reconcile.mjs');
  const cmd = fs.existsSync(siblingBin)
    ? [process.execPath, siblingBin]
    : ['model-source-reconcile'];

  const out = execFileSync(cmd[0], [...cmd.slice(1), 'check', '--model', modelPath, '--source', sourcePath, '--receipts', receiptsPath, '--json'], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  const parsed = JSON.parse(out);
  assert.equal(parsed.checked, 1);
  assert.equal(parsed.rows[0].result, 'matched');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('model-source reconcile checker check: PASS');
