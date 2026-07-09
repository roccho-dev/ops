#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { runLocalWorkerJsonl } from '../lib/local-worker.mjs';

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
  context: ['repoMap.world.v1'],
  acceptance: ['produce modelingProposal.v1'],
  confirmedBy: 'human',
};

const validReceipt = {
  kind: 'hq.receipt.v1',
  id: 'rc_001',
  queueId: 'mq_001',
  status: 'processed',
};

function errorCodes(result) {
  return result.errors.map((error) => error.code);
}

{
  const result = runLocalWorkerJsonl([
    JSON.stringify(validModel),
    JSON.stringify(validAgent),
    JSON.stringify(validReceipt),
  ].join('\n'));

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.records, 3);
  assert.equal(result.processed, 1);
  assert.equal(result.pending, 1);
  assert.equal(result.ignored, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.state.modelOperations.length, 1);
  assert.equal(result.state.modelOperations[0].queueId, 'mq_001');
  assert.equal(result.state.agentTasks.length, 1);
  assert.equal(result.state.agentTasks[0].status, 'pending');
  assert.deepEqual(result.state.agentTasks[0].context, ['repoMap.world.v1']);
}

{
  const result = runLocalWorkerJsonl('{not json}\n');
  assert.equal(result.ok, false);
  assert.equal(result.failed, 1);
  assert.ok(errorCodes(result).includes('invalid-json'));
}

{
  const result = runLocalWorkerJsonl([
    JSON.stringify(validModel),
    JSON.stringify({ ...validAgent, id: validModel.id }),
  ].join('\n'));
  assert.equal(result.ok, false);
  assert.equal(result.processed, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.state.modelOperations.length, 1, 'duplicate row must not be processed twice');
  assert.equal(result.state.agentTasks.length, 0, 'duplicate agent row must not become pending state');
  assert.ok(errorCodes(result).includes('duplicate-id'));
}

{
  const bad = { ...validModel, payload: { acceptedLedger: true } };
  const result = runLocalWorkerJsonl(JSON.stringify(bad));
  assert.equal(result.ok, false);
  assert.equal(result.failed, 1);
  assert.equal(result.state.modelOperations.length, 0);
  assert.ok(errorCodes(result).includes('authority-field-present'));
}

{
  const bad = { ...validModel };
  delete bad.targetRef;
  const result = runLocalWorkerJsonl(JSON.stringify(bad));
  assert.equal(result.ok, false);
  assert.ok(errorCodes(result).includes('missing-required-field'));
  assert.equal(result.state.modelOperations.length, 0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-local-worker-'));
try {
  const input = path.join(tmp, 'queue.jsonl');
  fs.writeFileSync(input, [JSON.stringify(validModel), JSON.stringify(validAgent)].join('\n'));

  const here = path.dirname(fileURLToPath(import.meta.url));
  const siblingBin = path.join(here, '..', 'bin', 'hq-modeling-runtime.mjs');
  const cmd = fs.existsSync(siblingBin)
    ? [process.execPath, siblingBin]
    : ['hq-modeling-runtime'];

  const out = execFileSync(cmd[0], [...cmd.slice(1), 'work', '--input', input, '--json'], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  const parsed = JSON.parse(out);
  assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));
  assert.equal(parsed.processed, 1);
  assert.equal(parsed.pending, 1);
  assert.equal(parsed.state.modelOperations.length, 1);
  assert.equal(parsed.state.agentTasks.length, 1);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('hq local worker check: PASS');
