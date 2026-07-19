#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  cueAppendReceipt,
  hqAdmissionToCueAppendPacket,
  rowsToJsonl,
} from '../lib/cue-append-contract-adapter.mjs';

const contractcheck = 'contractcheck';

const model = {
  kind: 'hq.modelCommitQueued.v1',
  id: 'mq_001',
  status: 'queued',
  targetRef: { kind: 'repoMap.node', id: 'pkg:core' },
  op: 'addEdge',
  payload: { from: 'pkg:core', to: 'pkg:ui', type: 'uses' },
  confirmedBy: 'human',
  origin: { kind: 'direct-human.v1', confirmationId: 'confirmation:mq_001', confirmedBy: 'human' },
};

function runJson(cmd, args, options = {}) {
  const out = execFileSync(cmd, args, { encoding: 'utf8', timeout: 30_000, ...options });
  return JSON.parse(out);
}

function mustFail(cmd, args, options = {}) {
  try {
    execFileSync(cmd, args, { encoding: 'utf8', timeout: 30_000, ...options });
    assert.fail(`expected command to fail: ${cmd} ${args.join(' ')}`);
  } catch (error) {
    assert.notEqual(error.status, 0);
    return {
      stdout: error.stdout?.toString?.() ?? '',
      stderr: error.stderr?.toString?.() ?? '',
    };
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-cue-append-'));
try {
  const packet = hqAdmissionToCueAppendPacket(JSON.stringify(model));
  assert.equal(packet.kind, 'hq.cueAppendContract.packet.v1');
  assert.equal(packet.evidenceOnly, true);
  assert.equal(packet.nonAuthority, true);
  assert.equal(packet.admission.ok, true);
  assert.equal(packet.admission.admitted, 1);
  assert.equal(packet.appendedEvents.length, 2);
  assert.equal(packet.appendedEvents[0].kind, 'contract.query.v1');
  assert.equal(packet.appendedEvents[1].kind, 'contract.fixture.v1');
  assert.equal(packet.appendedEvents[0].fixture_ids[0], packet.appendedEvents[1].fixture_id);
  assert.match(packet.appendedEvents[1].payload_hash, /^sha256:/);
  assert.ok(!('accepted' in packet));
  assert.ok(!('authority' in packet));

  const basePath = path.join(tmp, 'base.contract.jsonl');
  const candidatePath = path.join(tmp, 'candidate.contract.jsonl');
  const tamperedPath = path.join(tmp, 'tampered.contract.jsonl');

  fs.writeFileSync(basePath, rowsToJsonl(packet.baseLedger));
  fs.writeFileSync(candidatePath, rowsToJsonl(packet.candidateLedger));

  const appendOnlyResult = runJson(contractcheck, [
    'append-only-check',
    '--base', basePath,
    '--candidate', candidatePath,
  ]);
  assert.equal(appendOnlyResult.status, 'pass');
  assert.equal(appendOnlyResult.base_lines, packet.baseLedger.length);
  assert.equal(appendOnlyResult.ledger_lines, packet.candidateLedger.length);

  const tamperedBase = [{ ...packet.baseLedger[0], title: 'Tampered title' }, ...packet.candidateLedger.slice(1)];
  fs.writeFileSync(tamperedPath, rowsToJsonl(tamperedBase));
  const tampered = mustFail(contractcheck, [
    'append-only-check',
    '--base', basePath,
    '--candidate', tamperedPath,
  ]);
  assert.match(`${tampered.stdout}\n${tampered.stderr}`, /append-only prefix mismatch/);

  const receipt = cueAppendReceipt({
    packet,
    validateResult: { status: 'delegated-to-cue-append-contract-core' },
    appendOnlyResult,
    rewriteResult: { status: 'rejected' },
  });
  assert.equal(receipt.kind, 'hq.cueAppendContract.receipt.v1');
  assert.equal(receipt.evidenceOnly, true);
  assert.equal(receipt.nonAuthority, true);
  assert.equal(receipt.validateStatus, 'delegated-to-cue-append-contract-core');
  assert.equal(receipt.appendOnlyStatus, 'pass');
  assert.equal(receipt.rewriteRejectStatus, 'rejected');
  assert.match(receipt.receiptDigest, /^sha256:/);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('hq CUE append contract adapter check: PASS');
