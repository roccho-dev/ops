#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { sourceObservationRow, sourceReceiptFromObservation } from '../lib/source-receipt-writer.mjs';
import { validateSourceJsonl, validateSourceRecord } from '../lib/source-validator.mjs';

const observation = sourceObservationRow({
  id: 'obs:package:ceo:repo:adrs',
  status: 'observed',
  surface: 'github',
  observedAt: '2026-07-09T00:00:00Z',
  subjectRef: { kind: 'package', id: 'package:ceo' },
  sourceRef: { kind: 'repo', id: 'repo:adrs' },
  observation: { exists: true, path: 'packages/ceo' },
});

const missingObservation = sourceObservationRow({
  id: 'obs:package:missing:repo:adrs',
  status: 'missing',
  surface: 'github',
  observedAt: '2026-07-09T00:00:00Z',
  subjectRef: { kind: 'package', id: 'package:missing' },
  sourceRef: { kind: 'repo', id: 'repo:adrs' },
  observation: { exists: false, path: 'packages/missing' },
});

const receipt = sourceReceiptFromObservation(observation);

function codes(result) {
  return result.errors.map((error) => error.code);
}

{
  const result = validateSourceJsonl([JSON.stringify(observation), JSON.stringify(receipt)].join('\n'));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.records, 2);
}

{
  const result = validateSourceJsonl(JSON.stringify(missingObservation));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
}

{
  const bad = { ...observation, accepted: true };
  const result = validateSourceJsonl(JSON.stringify(bad));
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('authority-field-present'));
}

{
  const bad = { ...observation, observation: { ...observation.observation, writesAcceptedLedger: true } };
  const result = validateSourceJsonl(JSON.stringify(bad));
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('authority-field-present'));
}

{
  const bad = { ...observation, observedDigest: 'sha256:mutated' };
  const result = validateSourceJsonl(JSON.stringify(bad));
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('observed-digest-mismatch'));
}

{
  const bad = { ...receipt, receiptDigest: 'sha256:mutated' };
  const result = validateSourceJsonl(JSON.stringify(bad));
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('receipt-digest-mismatch'));
}

{
  const directModel = {
    kind: 'hq.modelCommitQueued.v1',
    id: 'mq_001',
    status: 'queued',
  };
  const errors = validateSourceRecord(directModel);
  assert.ok(errors.some((error) => error.code === 'unknown-kind'));
}

{
  const result = validateSourceJsonl([JSON.stringify(observation), JSON.stringify({ ...observation })].join('\n'));
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('duplicate-id'));
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'source-validator-'));
try {
  const input = path.join(tmp, 'source.jsonl');
  fs.writeFileSync(input, JSON.stringify(observation));

  const here = path.dirname(fileURLToPath(import.meta.url));
  const siblingBin = path.join(here, '..', 'bin', 'hq-source-evidence-runtime.mjs');
  const cmd = fs.existsSync(siblingBin)
    ? [process.execPath, siblingBin]
    : ['hq-source-evidence-runtime'];

  const out = execFileSync(cmd[0], [...cmd.slice(1), 'validate', '--input', input, '--json'], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  const parsed = JSON.parse(out);
  assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));

  const invalid = path.join(tmp, 'invalid.jsonl');
  fs.writeFileSync(invalid, JSON.stringify({ ...observation, ledgerAuthority: true }));
  let invalidParsed;
  try {
    execFileSync(cmd[0], [...cmd.slice(1), 'validate', '--input', invalid, '--json'], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.fail('authority-bearing observation should fail validation');
  } catch (error) {
    invalidParsed = JSON.parse(error.stdout);
  }
  assert.equal(invalidParsed.ok, false);
  assert.ok(codes(invalidParsed).includes('authority-field-present'));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('source evidence validator check: PASS');
