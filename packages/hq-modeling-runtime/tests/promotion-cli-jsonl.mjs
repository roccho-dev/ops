#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { proposalDigest } from '../lib/modeling-proposal.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, '..', 'bin', 'hq-modeling-runtime.mjs');
function run(args) { return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 10_000 }); }
function reject(args, code) {
  const result = run(args);
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '', JSON.stringify({ args, stdout: result.stdout, stderr: result.stderr }));
  assert.match(result.stderr, new RegExp(code));
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b4-'));
try {
  const proposal = {
    kind: 'modeling.proposal.v1',
    id: 'p',
    sourceAgentTaskId: 'a',
    targetRef: { kind: 'repoMap.node', id: 'x' },
    proposedOperation: { op: 'x', payload: {} },
    evidence: [{ kind: 'digest', value: 'x' }],
    acceptanceCriteria: ['x'],
    status: 'proposed',
  };
  const confirmation = { confirm: true, confirmedBy: 'h', proposalDigest: proposalDigest(proposal) };
  const badConfirmation = { ...confirmation, proposalDigest: 'sha256:wrong' };
  const proposalPath = path.join(tmp, 'p.json');
  const confirmationPath = path.join(tmp, 'c.json');
  const badConfirmationPath = path.join(tmp, 'bad.json');
  const invalidPath = path.join(tmp, 'invalid.json');
  fs.writeFileSync(proposalPath, JSON.stringify(proposal));
  fs.writeFileSync(confirmationPath, JSON.stringify(confirmation));
  fs.writeFileSync(badConfirmationPath, JSON.stringify(badConfirmation));
  fs.writeFileSync(invalidPath, '{bad');

  for (const [args, code] of [
    [['promote', '--input', proposalPath, '--confirmation', confirmationPath, '--queue-jsonl=true'], 'promotion-usage-error'],
    [['promote', '--input', proposalPath, '--confirmation', confirmationPath, '--receipt-jsonl=true'], 'promotion-usage-error'],
    [['promote', '--input', proposalPath, '--confirmation', confirmationPath, '--queue-jsonl=true', '--receipt-jsonl=true'], 'promotion-usage-error'],
    [['promote', '--input', proposalPath, '--confirmation', confirmationPath, '--queue-jsonl=true', '--json'], 'promotion-usage-error'],
    [['promote', '--input', proposalPath, '--confirmation', confirmationPath, '--receipt-jsonl=true', '--json'], 'promotion-usage-error'],
    [['promote', '--queue-jsonl=true'], 'promotion-usage-error'],
    [['promote', '--receipt-jsonl=true', '--unknown'], 'promotion-usage-error'],
    [['promote', '--input', invalidPath, '--confirmation', confirmationPath, '--queue-jsonl'], 'proposal-invalid-json'],
    [['promote', '--input', proposalPath, '--confirmation', invalidPath, '--receipt-jsonl'], 'confirmation-invalid-json'],
    [['promote', '--input', proposalPath, '--confirmation', badConfirmationPath, '--queue-jsonl'], 'proposal-digest-mismatch'],
    [['promote', '--input', proposalPath, '--confirmation', badConfirmationPath, '--receipt-jsonl'], 'proposal-digest-mismatch'],
  ]) reject(args, code);

  console.log('hq promotion JSONL rejection safety check: PASS');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
