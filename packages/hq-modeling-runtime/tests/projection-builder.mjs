#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { buildRepoMapProjectionFromQueueJsonl } from '../lib/projection-builder.mjs';

const addEdge = {
  kind: 'hq.modelCommitQueued.v1',
  id: 'mq_edge_001',
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
  goal: 'inspect edge evidence',
  confirmedBy: 'human',
};

{
  const result = buildRepoMapProjectionFromQueueJsonl([
    JSON.stringify(addEdge),
    JSON.stringify(agent),
  ].join('\n'));

  assert.equal(result.ok, true, JSON.stringify(result.projection.errors));
  assert.equal(result.projection.kind, 'repoMap.projection.v1');
  assert.equal(result.projection.generatedBy, 'hq-modeling-runtime');
  assert.equal(result.projection.evidenceOnly, true);
  assert.equal(result.projection.nonAuthority, true);
  assert.match(result.projection.projectionDigest, /^sha256:/);
  assert.match(result.projection.source.receiptDigest, /^sha256:/);
  assert.match(result.projection.source.stateDigest, /^sha256:/);

  const nodeIds = result.projection.nodes.map((node) => node.id).sort();
  assert.deepEqual(nodeIds, ['pkg:core', 'pkg:ui']);
  assert.equal(result.projection.edges.length, 1);
  assert.deepEqual(result.projection.edges[0], {
    id: 'edge:pkg:core->pkg:ui:uses',
    from: 'pkg:core',
    to: 'pkg:ui',
    type: 'uses',
    sourceQueueId: 'mq_edge_001',
    evidenceOnly: true,
  });

  assert.equal(result.projection.pendingAgentTasks.length, 1);
  assert.equal(result.projection.pendingAgentTasks[0].queueId, 'aq_001');
  assert.equal(result.projection.receipts.length, 2);
  assert.ok(!('accepted' in result.projection));
  assert.ok(!('acceptedLedger' in result.projection));
  assert.ok(!('sourceModelAuthority' in result.projection));
}

{
  const bad = { ...addEdge, payload: { acceptedLedger: true } };
  const result = buildRepoMapProjectionFromQueueJsonl(JSON.stringify(bad));
  assert.equal(result.ok, false);
  assert.equal(result.projection.edges.length, 0);
  assert.equal(result.projection.errors.length, 1);
  assert.equal(result.projection.errors[0].code, 'authority-field-present');
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-projection-builder-'));
try {
  const input = path.join(tmp, 'queue.jsonl');
  fs.writeFileSync(input, [JSON.stringify(addEdge), JSON.stringify(agent)].join('\n'));

  const here = path.dirname(fileURLToPath(import.meta.url));
  const siblingBin = path.join(here, '..', 'bin', 'hq-modeling-runtime.mjs');
  const cmd = fs.existsSync(siblingBin)
    ? [process.execPath, siblingBin]
    : ['hq-modeling-runtime'];

  const jsonOut = execFileSync(cmd[0], [...cmd.slice(1), 'projection', '--input', input, '--json'], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  const parsed = JSON.parse(jsonOut);
  assert.equal(parsed.ok, true, JSON.stringify(parsed.projection.errors));
  assert.equal(parsed.projection.kind, 'repoMap.projection.v1');
  assert.equal(parsed.projection.edges.length, 1);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('hq repo-map projection builder check: PASS');
