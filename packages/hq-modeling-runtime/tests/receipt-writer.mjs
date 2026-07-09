#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { runLocalWorkerWithReceiptsJsonl, receiptsToJsonl } from '../lib/receipt-writer.mjs';
import { validateJsonl } from '../lib/queue-validator.mjs';

const validModel = {
  kind: 'hq.modelCommitQueued.v1',
  id: 'mq_001',
  status: 'queued',
  targetRef: { kind: 'repoMap.node', id: 'pkg:core' },
  op: 'addEdge',
  payload: { from: 'pkg:core', to: 'pkg:ui', type: 'uses' },
  confirmedBy: 'human',
};

const validAgent = {
  kind: 'hq.agentTaskQueued.v1',
  id: 'aq_001',
  status: 'queued',
  targetRef: { kind: 'repoMap.node', id: 'pkg:core' },
  goal: 'inspect whether the dependency edge should exist',
  confirmedBy: 'human',
};

function codes(result) {
  return result.errors.map((error) => error.code);
}

{
  const result = runLocalWorkerWithReceiptsJsonl([
    JSON.stringify(validModel),
    JSON.stringify(validAgent),
  ].join('\n'));

  assert.equal(result.ok, true, JSON.stringify(result.worker.errors));
  assert.equal(result.records, 2);
  assert.equal(result.receipts, 2);
  assert.match(result.receiptDigest, /^sha256:/);

  const [modelReceipt, agentReceipt] = result.receiptRows;
  assert.equal(modelReceipt.kind, 'hq.receipt.v1');
  assert.equal(modelReceipt.queueId, 'mq_001');
  assert.equal(modelReceipt.status, 'processed');
  assert.equal(modelReceipt.evidenceOnly, true);
  assert.match(modelReceipt.queueDigest, /^sha256:/);
  assert.match(modelReceipt.stateDigest, /^sha256:/);
  assert.equal(modelReceipt.outputKind, 'hq.localModelOperation.v1');
  assert.ok(!('accepted' in modelReceipt));
  assert.ok(!('authority' in modelReceipt));

  assert.equal(agentReceipt.queueId, 'aq_001');
  assert.equal(agentReceipt.status, 'pending');
  assert.equal(agentReceipt.outputKind, 'hq.localAgentTask.v1');

  const receiptValidation = validateJsonl(receiptsToJsonl(result.receiptRows));
  assert.equal(receiptValidation.ok, true, JSON.stringify(receiptValidation.errors));
}

{
  const bad = { ...validModel, payload: { acceptedLedger: true } };
  const result = runLocalWorkerWithReceiptsJsonl(JSON.stringify(bad));
  assert.equal(result.ok, false);
  assert.equal(result.receipts, 1);
  assert.equal(result.receiptRows[0].status, 'failed');
  assert.ok(result.receiptRows[0].errorCodes.includes('authority-field-present'));
  const receiptValidation = validateJsonl(receiptsToJsonl(result.receiptRows));
  assert.equal(receiptValidation.ok, true, JSON.stringify(receiptValidation.errors));
}

{
  const result = runLocalWorkerWithReceiptsJsonl('{not json}\n');
  assert.equal(result.ok, false);
  assert.equal(result.receiptRows[0].queueId, 'line:1');
  assert.equal(result.receiptRows[0].status, 'failed');
  assert.ok(result.receiptRows[0].errorCodes.includes('invalid-json'));
}

{
  const result = runLocalWorkerWithReceiptsJsonl([
    JSON.stringify(validModel),
    JSON.stringify({ ...validAgent, id: validModel.id }),
  ].join('\n'));
  assert.equal(result.ok, false);
  assert.equal(result.receipts, 2);
  assert.equal(result.receiptRows[0].status, 'processed');
  assert.equal(result.receiptRows[1].status, 'failed');
  assert.ok(result.receiptRows[1].errorCodes.includes('duplicate-id'));
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-receipt-writer-'));
try {
  const input = path.join(tmp, 'queue.jsonl');
  fs.writeFileSync(input, [JSON.stringify(validModel), JSON.stringify(validAgent)].join('\n'));

  const here = path.dirname(fileURLToPath(import.meta.url));
  const siblingBin = path.join(here, '..', 'bin', 'hq-modeling-runtime.mjs');
  const cmd = fs.existsSync(siblingBin)
    ? [process.execPath, siblingBin]
    : ['hq-modeling-runtime'];

  const jsonOut = execFileSync(cmd[0], [...cmd.slice(1), 'receipts', '--input', input, '--json'], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  const parsed = JSON.parse(jsonOut);
  assert.equal(parsed.ok, true, JSON.stringify(parsed.worker.errors));
  assert.equal(parsed.receipts, 2);

  const jsonlOut = execFileSync(cmd[0], [...cmd.slice(1), 'receipts', '--input', input, '--jsonl'], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  const receiptValidation = validateJsonl(jsonlOut);
  assert.equal(receiptValidation.ok, true, JSON.stringify(receiptValidation.errors));
  assert.equal(receiptValidation.records, 2);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('hq receipt writer check: PASS');
