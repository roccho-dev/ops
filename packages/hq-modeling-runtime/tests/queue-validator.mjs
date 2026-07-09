#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { validateJsonl, validateRecord } from '../lib/queue-validator.mjs';

const validModel = {
  kind: 'hq.modelCommitQueued.v1',
  id: 'mq_001',
  status: 'queued',
  targetRef: { kind: 'repoMap.node', id: 'pkg:core' },
  op: 'addEdge',
  payload: { from: 'pkg:core', to: 'pkg:ui', type: 'uses' },
  reason: 'model dependency should be visible',
  confirmedBy: 'human',
};

const validAgent = {
  kind: 'hq.agentTaskQueued.v1',
  id: 'aq_001',
  status: 'queued',
  targetRef: { kind: 'repoMap.node', id: 'pkg:core' },
  goal: 'inspect whether the dependency edge should exist',
  context: ['repoMap.world.v1', 'selectedNeighborhood'],
  acceptance: ['produce modelingProposal.v1', 'do not mutate accepted ledger'],
  confirmedBy: 'human',
};

const validReceipt = {
  kind: 'hq.receipt.v1',
  id: 'rc_001',
  queueId: 'mq_001',
  queueDigest: 'sha256-queue',
  status: 'processed',
  message: 'processed local queue intent',
};

function codes(result) {
  return result.errors.map((error) => error.code);
}

{
  const result = validateJsonl([
    JSON.stringify(validModel),
    JSON.stringify(validAgent),
    JSON.stringify(validReceipt),
  ].join('\n'));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.records, 3);
}

{
  const result = validateJsonl('{not json}\n');
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('invalid-json'));
}

{
  const bad = { ...validModel };
  delete bad.targetRef;
  const result = validateJsonl(JSON.stringify(bad));
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('missing-required-field'));
}

{
  const bad = { ...validModel, payload: { ...validModel.payload, acceptedLedger: true } };
  const result = validateJsonl(JSON.stringify(bad));
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('authority-field-present'));
}

{
  const result = validateJsonl([
    JSON.stringify(validModel),
    JSON.stringify({ ...validAgent, id: validModel.id }),
  ].join('\n'));
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('duplicate-id'));
}

{
  const bad = { ...validAgent, context: 'not-array' };
  const result = validateJsonl(JSON.stringify(bad));
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('context-not-array'));
}

{
  const bad = { ...validReceipt, status: 'accepted' };
  const result = validateJsonl(JSON.stringify(bad));
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('invalid-status'));
}

{
  const errors = validateRecord({ ...validModel, targetRef: { kind: 'repoMap.node' } });
  assert.ok(errors.some((error) => error.code === 'targetRef-missing-id'));
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-queue-validator-'));
try {
  const validPath = path.join(tmp, 'valid.jsonl');
  fs.writeFileSync(validPath, [JSON.stringify(validModel), JSON.stringify(validAgent)].join('\n'));

  const here = path.dirname(fileURLToPath(import.meta.url));
  const siblingBin = path.join(here, '..', 'bin', 'hq-modeling-runtime.mjs');
  const cmd = fs.existsSync(siblingBin)
    ? [process.execPath, siblingBin]
    : ['hq-modeling-runtime'];

  const validOut = execFileSync(cmd[0], [...cmd.slice(1), 'validate', '--input', validPath, '--json'], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  const validParsed = JSON.parse(validOut);
  assert.equal(validParsed.ok, true, JSON.stringify(validParsed.errors));

  const invalidPath = path.join(tmp, 'invalid.jsonl');
  fs.writeFileSync(invalidPath, JSON.stringify({ ...validModel, accepted: true }));
  let invalidParsed;
  try {
    execFileSync(cmd[0], [...cmd.slice(1), 'validate', '--input', invalidPath, '--json'], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.fail('invalid queue should fail CLI validation');
  } catch (error) {
    invalidParsed = JSON.parse(error.stdout);
  }
  assert.equal(invalidParsed.ok, false);
  assert.ok(codes(invalidParsed).includes('authority-field-present'));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('hq queue validator check: PASS');
