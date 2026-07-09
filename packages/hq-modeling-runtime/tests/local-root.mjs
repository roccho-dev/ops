#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  buildLocalStatus,
  buildServeLocalPlan,
  catalogSummary,
  classifyLocalRootPath,
  isGeneratedLocalRuntimePath,
  localRootCatalog,
  validateLocalEndpoint,
} from '../lib/local-root.mjs';

const summary = catalogSummary();
assert.equal(summary.kind, 'hq.localRoot.catalog.v1');
assert.equal(summary.authority, false);
assert.equal(summary.localRootIsSsot, false);
assert.equal(summary.canonicalAuthority, 'remote bare repo after accepted promotion and readback');

for (const area of ['queues', 'state', 'proposals', 'ledgers', 'projections', 'receipts', 'previews', 'cache']) {
  assert.ok(localRootCatalog.some((entry) => entry.area === area), `catalog must include ${area}`);
}
assert.ok(localRootCatalog.every((entry) => entry.authority === false));

assert.equal(classifyLocalRootPath('queues/hq.model-commit.queue.jsonl').ok, true);
assert.equal(classifyLocalRootPath('/receipts/hq.receipt.v1.jsonl').ok, true);
assert.equal(classifyLocalRootPath('cache/github-readback/ops-66.jsonl').ok, true);
assert.equal(classifyLocalRootPath('unknown/authority.jsonl').ok, false);

assert.equal(validateLocalEndpoint({ host: '127.0.0.1' }).ok, true);
assert.equal(validateLocalEndpoint({ host: 'localhost' }).ok, true);
assert.equal(validateLocalEndpoint({ socketPath: '/tmp/hq.sock' }).ok, true);
assert.equal(validateLocalEndpoint({ host: '0.0.0.0' }).ok, false);
assert.equal(validateLocalEndpoint({ host: '192.168.1.10' }).ok, false);

const acceptedPlan = buildServeLocalPlan({ root: '/tmp/hq-local', host: '127.0.0.1', port: 8787 });
assert.equal(acceptedPlan.ok, true);
assert.equal(acceptedPlan.plan.authority, false);
assert.equal(acceptedPlan.plan.localRootIsSsot, false);
assert.equal(acceptedPlan.plan.remoteServerIntroduced, false);

const rejectedPlan = buildServeLocalPlan({ root: '/tmp/hq-local', host: '0.0.0.0', port: 8787 });
assert.equal(rejectedPlan.ok, false);
assert.deepEqual(rejectedPlan.errors, ['non-local-endpoint-rejected']);

assert.equal(isGeneratedLocalRuntimePath('.local/hq/receipts/hq.receipt.v1.jsonl'), true);
assert.equal(isGeneratedLocalRuntimePath('packages/hq-modeling-runtime/lib/local-root.mjs'), false);

const status = buildLocalStatus({
  root: '/tmp/hq-local',
  files: {
    'queues/hq.model-commit.queue.jsonl': '{"kind":"hq.modelCommitQueued.v1"}\n',
    'queues/hq.agent-task.queue.jsonl': '{"kind":"hq.agentTaskQueued.v1"}\n{"kind":"hq.agentTaskQueued.v1"}\n',
    'receipts/hq.receipt.v1.jsonl': '{"kind":"hq.receipt.v1"}\n',
    'projections/repoMap.projection.v1.json': '{"nodes":[]}',
    'previews/repo-map/index.html': '<html></html>',
  },
});
assert.equal(status.ok, true);
assert.equal(status.authority, false);
assert.equal(status.localRootIsSsot, false);
assert.equal(status.counts.modelQueueRows, 1);
assert.equal(status.counts.agentTaskRows, 2);
assert.match(status.digests.queueDigest, /^sha256:/);

const here = path.dirname(fileURLToPath(import.meta.url));
const serveLocalBin = path.join(here, '..', 'bin', 'hq-serve-local.mjs');
const output = execFileSync(process.execPath, [serveLocalBin, '--root', '/tmp/hq-local', '--host', '127.0.0.1', '--dry-run', '--json'], {
  encoding: 'utf8',
  timeout: 10_000,
});
const parsed = JSON.parse(output);
assert.equal(parsed.ok, true);
assert.equal(parsed.plan.kind, 'hq.serveLocal.plan.v1');
assert.equal(parsed.plan.authority, false);

assert.throws(
  () => execFileSync(process.execPath, [serveLocalBin, '--root', '/tmp/hq-local', '--host', '0.0.0.0', '--dry-run'], { encoding: 'utf8', timeout: 10_000 }),
  /Command failed/,
);

console.log('hq local root and serve-local boundary check: PASS');
