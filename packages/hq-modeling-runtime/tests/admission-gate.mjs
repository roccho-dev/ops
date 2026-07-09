#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { runAdmissionGateJsonl, rowsToJsonl } from '../lib/admission-gate.mjs';

const model = {
  kind: 'hq.modelCommitQueued.v1',
  id: 'mq_001',
  status: 'queued',
  targetRef: { kind: 'repoMap.node', id: 'pkg:core' },
  op: 'addEdge',
  payload: { from: 'pkg:core', to: 'pkg:ui', type: 'uses' },
  confirmedBy: 'human',
};

const agent = {
  kind: 'hq.agentTaskQueued.v1',
  id: 'aq_001',
  status: 'queued',
  targetRef: { kind: 'repoMap.node', id: 'pkg:core' },
  goal: 'inspect evidence',
  confirmedBy: 'human',
};

function errorCodes(result) {
  return result.errors.map((error) => error.code);
}

{
  const result = runAdmissionGateJsonl(JSON.stringify(model));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.admitted, 1);
  assert.equal(result.rejected, 0);
  assert.match(result.ledgerDigest, /^sha256:/);
  assert.equal(result.acceptedRows.length, 1);

  const accepted = result.acceptedRows[0];
  assert.equal(accepted.kind, 'accepted.modelCommit.v1');
  assert.equal(accepted.sourceQueueId, 'mq_001');
  assert.equal(accepted.admissionScope, 'local-dev');
  assert.equal(accepted.localDevOnly, true);
  assert.match(accepted.queueDigest, /^sha256:/);
  assert.match(accepted.acceptedDigest, /^sha256:/);
  assert.ok(!('productionAuthority' in accepted));
  assert.ok(!('authority' in accepted));

  const receipt = result.admissionReceipts[0];
  assert.equal(receipt.kind, 'admission.receipt.v1');
  assert.equal(receipt.status, 'admitted');
  assert.equal(receipt.queueId, 'mq_001');
  assert.equal(receipt.acceptedId, accepted.id);
  assert.equal(receipt.ledgerDigest, result.ledgerDigest);
  assert.equal(receipt.evidenceOnly, true);
}

{
  const result = runAdmissionGateJsonl(JSON.stringify(agent));
  assert.equal(result.ok, false);
  assert.equal(result.admitted, 0);
  assert.equal(result.rejected, 1);
  assert.ok(errorCodes(result).includes('not-admissible-kind'));
  assert.equal(result.admissionReceipts[0].status, 'rejected');
  assert.equal(result.admissionReceipts[0].queueKind, 'hq.agentTaskQueued.v1');
}

{
  const bad = { ...model, payload: { acceptedLedger: true } };
  const result = runAdmissionGateJsonl(JSON.stringify(bad));
  assert.equal(result.ok, false);
  assert.equal(result.admitted, 0);
  assert.equal(result.rejected, 1);
  assert.ok(errorCodes(result).includes('authority-field-present'));
}

{
  const bad = { ...model, payload: { embedded: { kind: 'source.observation.v1', id: 'obs_001', status: 'observed' } } };
  const result = runAdmissionGateJsonl(JSON.stringify(bad));
  assert.equal(result.ok, false);
  assert.equal(result.admitted, 0);
  assert.equal(result.rejected, 1);
  assert.ok(errorCodes(result).includes('payload-smuggled-row'));
  assert.equal(result.acceptedRows.length, 0);
}

{
  const bad = { ...model, payload: { embedded: { kind: 'model_source_reconcile.v1', id: 'rec_001', result: 'matched' } } };
  const result = runAdmissionGateJsonl(JSON.stringify(bad));
  assert.equal(result.ok, false);
  assert.equal(result.admitted, 0);
  assert.equal(result.rejected, 1);
  assert.ok(errorCodes(result).includes('payload-smuggled-row'));
  assert.equal(result.acceptedRows.length, 0);
}

{
  const result = runAdmissionGateJsonl([
    JSON.stringify(model),
    JSON.stringify({ ...model, op: 'addNode' }),
  ].join('\n'));
  assert.equal(result.ok, false);
  assert.equal(result.admitted, 1);
  assert.equal(result.rejected, 1);
  assert.ok(errorCodes(result).includes('duplicate-id'));
}

{
  const result = runAdmissionGateJsonl('{not json}\n');
  assert.equal(result.ok, false);
  assert.equal(result.admitted, 0);
  assert.equal(result.rejected, 1);
  assert.ok(errorCodes(result).includes('invalid-json'));
  assert.equal(result.admissionReceipts[0].queueId, 'line:1');
}

assert.match(rowsToJsonl([model]), /hq\.modelCommitQueued\.v1/);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-admission-gate-'));
try {
  const input = path.join(tmp, 'queue.jsonl');
  fs.writeFileSync(input, JSON.stringify(model));

  const here = path.dirname(fileURLToPath(import.meta.url));
  const siblingBin = path.join(here, '..', 'bin', 'hq-modeling-runtime.mjs');
  const cmd = fs.existsSync(siblingBin)
    ? [process.execPath, siblingBin]
    : ['hq-modeling-runtime'];

  const jsonOut = execFileSync(cmd[0], [...cmd.slice(1), 'admit', '--input', input, '--json'], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  const parsed = JSON.parse(jsonOut);
  assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));
  assert.equal(parsed.admitted, 1);

  const acceptedJsonl = execFileSync(cmd[0], [...cmd.slice(1), 'admit', '--input', input, '--accepted-jsonl'], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.match(acceptedJsonl, /accepted\.modelCommit\.v1/);

  const receiptJsonl = execFileSync(cmd[0], [...cmd.slice(1), 'admit', '--input', input, '--receipt-jsonl'], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.match(receiptJsonl, /admission\.receipt\.v1/);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('hq admission gate check: PASS');
