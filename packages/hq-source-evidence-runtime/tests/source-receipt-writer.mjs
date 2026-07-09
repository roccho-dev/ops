#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  sourceObservationRow,
  sourceReceiptFromObservation,
  sourceReceiptsToJsonl,
  writeSourceReceiptsJsonl,
} from '../lib/source-receipt-writer.mjs';

const observed = sourceObservationRow({
  id: 'obs:package:ceo:repo:adrs',
  status: 'observed',
  surface: 'github',
  observedAt: '2026-07-09T00:00:00Z',
  subjectRef: { kind: 'package', id: 'package:ceo' },
  sourceRef: { kind: 'repo', id: 'repo:adrs' },
  observation: { exists: true, path: 'packages/ceo' },
});

const missing = sourceObservationRow({
  id: 'obs:package:missing:repo:adrs',
  status: 'missing',
  surface: 'github',
  observedAt: '2026-07-09T00:00:00Z',
  subjectRef: { kind: 'package', id: 'package:missing' },
  sourceRef: { kind: 'repo', id: 'repo:adrs' },
  observation: { exists: false, path: 'packages/missing' },
});

{
  const first = sourceReceiptFromObservation(observed);
  const second = sourceReceiptFromObservation(observed);
  assert.deepEqual(first, second);
  assert.equal(first.kind, 'source.receipt.v1');
  assert.equal(first.status, 'observed');
  assert.equal(first.observationId, observed.id);
  assert.equal(first.observedDigest, observed.observedDigest);
  assert.equal(first.evidenceOnly, true);
  assert.match(first.receiptDigest, /^sha256:/);
}

{
  const result = writeSourceReceiptsJsonl([JSON.stringify(observed), JSON.stringify(missing)].join('\n'));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.records, 2);
  assert.equal(result.observations, 2);
  assert.equal(result.receipts, 2);
  assert.match(result.receiptDigest, /^sha256:/);
  assert.equal(result.receiptRows[1].status, 'missing');
}

{
  const invalid = { ...observed, observedDigest: 'sha256:mutated' };
  const result = writeSourceReceiptsJsonl(JSON.stringify(invalid));
  assert.equal(result.ok, false);
  assert.equal(result.receipts, 0);
  assert.ok(result.errors.some((error) => error.code === 'observed-digest-mismatch'));
}

assert.match(sourceReceiptsToJsonl([sourceReceiptFromObservation(observed)]), /source\.receipt\.v1/);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'source-receipt-writer-'));
try {
  const input = path.join(tmp, 'source.jsonl');
  fs.writeFileSync(input, JSON.stringify(observed));

  const here = path.dirname(fileURLToPath(import.meta.url));
  const siblingBin = path.join(here, '..', 'bin', 'hq-source-evidence-runtime.mjs');
  const cmd = fs.existsSync(siblingBin)
    ? [process.execPath, siblingBin]
    : ['hq-source-evidence-runtime'];

  const jsonOut = execFileSync(cmd[0], [...cmd.slice(1), 'receipts', '--input', input, '--json'], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  const parsed = JSON.parse(jsonOut);
  assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));
  assert.equal(parsed.receipts, 1);

  const jsonlOut = execFileSync(cmd[0], [...cmd.slice(1), 'receipts', '--input', input, '--jsonl'], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.match(jsonlOut, /source\.receipt\.v1/);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('source evidence receipt writer check: PASS');
