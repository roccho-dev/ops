#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  runtimeBoundary,
  boundarySummary,
  assertNoForbiddenOwnership,
} from '../lib/boundary.mjs';
import { proposalDigest } from '../lib/modeling-proposal.mjs';

const implemented = [
  'package-boundary-metadata',
  'queue-schema-validator',
  'local-worker',
  'receipt-writer',
  'repo-map-projection-builder',
  'local-dev-admission-gate',
  'cue-append-contract-adapter',
  'hq-local-root-catalog',
  'hq-serve-local-scaffold',
  'hq-ci-mode-contract',
  'github-issue-comment-readback-adapter-contract',
  'staged-canonical-promotion-eligibility',
  'human-confirmed-modeling-proposal-promotion',
];

assert.equal(runtimeBoundary.kind, 'hq.modelingRuntime.boundary.v1');
assert.equal(runtimeBoundary.packageName, 'hq-modeling-runtime');
assert.equal(runtimeBoundary.ownerRepo, 'ops');
assert.deepEqual(runtimeBoundary.implementedNow, implemented);
assert.ok(runtimeBoundary.owns.includes('queue validator core'));
assert.ok(runtimeBoundary.owns.includes('local worker core'));
assert.ok(runtimeBoundary.owns.includes('receipt writer core'));
assert.ok(runtimeBoundary.owns.includes('repo-map projection builder core'));
assert.ok(runtimeBoundary.owns.includes('local-dev admission gate core'));
assert.ok(runtimeBoundary.owns.includes('cue append contract adapter core'));
assert.ok(runtimeBoundary.owns.includes('hq local root catalog port'));
assert.ok(runtimeBoundary.owns.includes('local-only serve scaffold adapter'));
assert.ok(runtimeBoundary.owns.includes('ci artifact receipt boundary core'));
assert.ok(runtimeBoundary.owns.includes('GitHub issue-comment readback evidence adapter core'));
assert.ok(runtimeBoundary.owns.includes('staged-to-canonical promotion eligibility core'));
assert.ok(runtimeBoundary.owns.includes('modeling proposal promotion core'));
assert.ok(runtimeBoundary.owns.includes('proposal promotion CLI adapter'));

assert.equal(Object.keys(runtimeBoundary.reservedForLaterIssues).length, 0);
assert.ok(!Object.hasOwn(runtimeBoundary.reservedForLaterIssues, 'ops#40'));
assert.ok(!Object.hasOwn(runtimeBoundary.reservedForLaterIssues, 'ops#41'));
assert.ok(!Object.hasOwn(runtimeBoundary.reservedForLaterIssues, 'ops#42'));
assert.ok(!Object.hasOwn(runtimeBoundary.reservedForLaterIssues, 'ops#43'));
assert.ok(!Object.hasOwn(runtimeBoundary.reservedForLaterIssues, 'ops#44'));
assert.ok(!Object.hasOwn(runtimeBoundary.reservedForLaterIssues, 'ops#45'));
assert.ok(!Object.hasOwn(runtimeBoundary.reservedForLaterIssues, 'ops#48'));
assert.ok(!Object.hasOwn(runtimeBoundary.reservedForLaterIssues, 'ops#63'));
assert.ok(!Object.hasOwn(runtimeBoundary.reservedForLaterIssues, 'ops#64'));
assert.ok(!Object.hasOwn(runtimeBoundary.reservedForLaterIssues, 'ops#65'));
assert.ok(!Object.hasOwn(runtimeBoundary.reservedForLaterIssues, 'ops#66'));
assert.ok(!Object.hasOwn(runtimeBoundary.reservedForLaterIssues, 'ops#67'));

const forbiddenOwnership = [
  'editor UX',
  'Vim/hq command surface',
  'browser renderer',
  'UI state',
  'production governance authority',
  'CUE contract core implementation',
  'remote bare repo write implementation',
  'GitHub issue authority',
  'ChatGPT direct local control',
  'model queue file persistence during proposal promotion',
  'accepted ledger writes during proposal promotion',
  'network access during proposal promotion',
  'agent execution during proposal promotion',
];

for (const forbidden of forbiddenOwnership) {
  assert.ok(runtimeBoundary.doesNotOwn.includes(forbidden), `doesNotOwn must include ${forbidden}`);
  assert.ok(!runtimeBoundary.owns.includes(forbidden), `owns must not include ${forbidden}`);
}

assert.equal(runtimeBoundary.authorityBoundary.queueRows, 'intent only');
assert.equal(runtimeBoundary.authorityBoundary.receipts, 'evidence only');
assert.equal(runtimeBoundary.authorityBoundary.projections, 'generated read models');
assert.match(runtimeBoundary.authorityBoundary.localRoot, /never SSOT/);
assert.match(runtimeBoundary.authorityBoundary.ciArtifacts, /ephemeral evidence only/);
assert.match(runtimeBoundary.authorityBoundary.githubReadback, /not accepted authority/);
assert.match(runtimeBoundary.authorityBoundary.acceptedLedger, /local-dev admission only/);
assert.match(runtimeBoundary.authorityBoundary.acceptedLedger, /production governance adoption is not implemented/);
assert.match(runtimeBoundary.authorityBoundary.canonicalPromotion, /remote bare repo becomes canonical/);
assert.match(runtimeBoundary.authorityBoundary.cueContractCore, /invoked through adapter only/);
assert.match(runtimeBoundary.authorityBoundary.proposalPromotion, /explicit human confirmation/);
assert.match(runtimeBoundary.authorityBoundary.proposalPromotion, /queue intent/);
assert.match(runtimeBoundary.authorityBoundary.proposalPromotion, /stdout or stderr only/);

assert.equal(assertNoForbiddenOwnership(), true);
for (const forbidden of forbiddenOwnership) {
  assert.throws(
    () => assertNoForbiddenOwnership({ ...runtimeBoundary, owns: [...runtimeBoundary.owns, forbidden] }),
    /forbidden ownership/,
  );
}

const summary = boundarySummary();
assert.equal(summary.laterIssueCount, 0);
assert.deepEqual(summary.implementedNow, implemented);

const here = path.dirname(fileURLToPath(import.meta.url));
const siblingBin = path.join(here, '..', 'bin', 'hq-modeling-runtime.mjs');
const cmd = fs.existsSync(siblingBin)
  ? [process.execPath, siblingBin]
  : ['hq-modeling-runtime'];

const output = execFileSync(cmd[0], [...cmd.slice(1), '--json'], {
  encoding: 'utf8',
  timeout: 10_000,
});
const parsed = JSON.parse(output);
assert.equal(parsed.kind, 'hq.modelingRuntime.boundary.v1');
assert.equal(parsed.ownerRepo, 'ops');
assert.equal(parsed.packageName, 'hq-modeling-runtime');
assert.deepEqual(parsed.implementedNow, implemented);

const help = execFileSync(cmd[0], [...cmd.slice(1), '--help'], {
  encoding: 'utf8',
  timeout: 10_000,
});
assert.match(help, /promote --input <proposal\.json> --confirmation <confirmation\.json>/);

function runCli(args) {
  return spawnSync(cmd[0], [...cmd.slice(1), ...args], {
    encoding: 'utf8',
    timeout: 10_000,
  });
}

function parseJsonOutput(run) {
  assert.equal(run.signal, null, run.stderr);
  return JSON.parse(run.stdout);
}

function errorCodes(run) {
  return `${run.stdout}${run.stderr}`;
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-modeling-promotion-'));
try {
  const proposal = {
    kind: 'modeling.proposal.v1',
    id: 'proposal_cli_001',
    sourceAgentTaskId: 'aq_cli_001',
    targetRef: { kind: 'repoMap.node', id: 'pkg:cli' },
    proposedOperation: {
      op: 'addEdge',
      payload: { from: 'pkg:cli', to: 'pkg:runtime', type: 'uses', optional: null },
    },
    evidence: [{ kind: 'digest', value: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }],
    acceptanceCriteria: ['explicit human confirmation is required'],
    status: 'proposed',
  };
  const confirmation = {
    confirm: true,
    confirmedBy: 'human-cli-review',
    proposalDigest: proposalDigest(proposal),
  };
  const badConfirmation = { ...confirmation, proposalDigest: 'sha256:wrong' };

  const proposalPath = path.join(temp, 'proposal.json');
  const confirmationPath = path.join(temp, 'confirmation.json');
  const badConfirmationPath = path.join(temp, 'confirmation-bad.json');
  const invalidJsonPath = path.join(temp, 'invalid.json');
  const proposalText = `${JSON.stringify(proposal)}\n`;
  const confirmationText = `${JSON.stringify(confirmation)}\n`;
  fs.writeFileSync(proposalPath, proposalText);
  fs.writeFileSync(confirmationPath, confirmationText);
  fs.writeFileSync(badConfirmationPath, `${JSON.stringify(badConfirmation)}\n`);
  fs.writeFileSync(invalidJsonPath, '{invalid json\n');
  const initialFiles = fs.readdirSync(temp).sort();

  {
    const run = runCli(['promote', '--input', proposalPath, '--confirmation', confirmationPath]);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /^hq proposal promotion: PASS /);
    assert.equal(run.stderr, '');
  }

  {
    const run = runCli(['promote', '--input', proposalPath, '--confirmation', confirmationPath, '--json']);
    assert.equal(run.status, 0, run.stderr);
    const result = parseJsonOutput(run);
    assert.equal(result.ok, true);
    assert.equal(result.queueRow.kind, 'hq.modelCommitQueued.v1');
    assert.equal(result.promotionReceipt.kind, 'proposal.promotionReceipt.v1');
  }

  {
    const run = runCli(['promote', '--input', proposalPath, '--confirmation', confirmationPath, '--queue-jsonl']);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stderr, '');
    const rows = run.stdout.trimEnd().split('\n');
    assert.equal(rows.length, 1);
    const row = JSON.parse(rows[0]);
    assert.equal(row.kind, 'hq.modelCommitQueued.v1');
    assert.equal(row.id, 'mq_from_proposal_cli_001');
    assert.deepEqual(row.evidence, proposal.evidence);
    assert.equal('promotionReceipt' in row, false);
  }

  {
    const run = runCli(['promote', '--input', proposalPath, '--confirmation', confirmationPath, '--receipt-jsonl']);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stderr, '');
    const rows = run.stdout.trimEnd().split('\n');
    assert.equal(rows.length, 1);
    const row = JSON.parse(rows[0]);
    assert.equal(row.kind, 'proposal.promotionReceipt.v1');
    assert.equal(row.evidenceOnly, true);
    assert.equal(row.nonAuthority, true);
  }

  {
    const run = runCli(['promote', '--input', proposalPath, '--confirmation', badConfirmationPath, '--queue-jsonl']);
    assert.equal(run.status, 1);
    assert.equal(run.stdout, '', 'rejected queue-jsonl mode must expose no queue intent');
    assert.match(run.stderr, /proposal-digest-mismatch/);
  }

  {
    const run = runCli(['promote', '--input', proposalPath, '--confirmation', badConfirmationPath, '--receipt-jsonl']);
    assert.equal(run.status, 1);
    assert.equal(run.stdout, '', 'rejected receipt-jsonl mode must expose no receipt');
    assert.match(run.stderr, /proposal-digest-mismatch/);
  }

  {
    const run = runCli(['promote', '--input', proposalPath, '--confirmation', badConfirmationPath, '--json']);
    assert.equal(run.status, 1);
    const result = parseJsonOutput(run);
    assert.equal(result.ok, false);
    assert.equal(result.queueRow, null);
    assert.equal('promotionReceipt' in result, false);
    assert.ok(result.errors.some((error) => error.code === 'proposal-digest-mismatch'));
  }

  {
    const run = runCli(['promote', '--input', invalidJsonPath, '--confirmation', confirmationPath, '--json']);
    assert.equal(run.status, 1);
    const result = parseJsonOutput(run);
    assert.ok(result.errors.some((error) => error.code === 'proposal-invalid-json'));
  }

  {
    const run = runCli(['promote', '--input', proposalPath, '--confirmation', invalidJsonPath, '--json']);
    assert.equal(run.status, 1);
    const result = parseJsonOutput(run);
    assert.ok(result.errors.some((error) => error.code === 'confirmation-invalid-json'));
  }

  {
    const run = runCli(['promote', '--input', path.join(temp, 'missing-proposal.json'), '--confirmation', confirmationPath, '--json']);
    assert.equal(run.status, 1);
    const result = parseJsonOutput(run);
    assert.ok(result.errors.some((error) => error.code === 'proposal-read-failed'));
  }

  {
    const run = runCli(['promote', '--input', proposalPath, '--confirmation', path.join(temp, 'missing-confirmation.json'), '--json']);
    assert.equal(run.status, 1);
    const result = parseJsonOutput(run);
    assert.ok(result.errors.some((error) => error.code === 'confirmation-read-failed'));
  }

  {
    const run = runCli(['promote', '--input', proposalPath, '--json']);
    assert.equal(run.status, 2);
    const result = parseJsonOutput(run);
    assert.ok(result.errors.some((error) => error.code === 'promotion-confirmation-required'));
  }

  {
    const run = runCli(['promote', '--confirmation', confirmationPath, '--json']);
    assert.equal(run.status, 2);
    const result = parseJsonOutput(run);
    assert.ok(result.errors.some((error) => error.code === 'promotion-input-required'));
  }

  {
    const run = runCli([
      'promote', '--input', proposalPath, '--confirmation', confirmationPath, '--json', '--queue-jsonl',
    ]);
    assert.equal(run.status, 2);
    const result = parseJsonOutput(run);
    assert.ok(result.errors.some((error) => error.code === 'promotion-output-mode-conflict'));
  }

  {
    const run = runCli(['promote', '--input', proposalPath, '--confirmation', confirmationPath, '--unknown']);
    assert.equal(run.status, 2);
    assert.match(errorCodes(run), /promotion-usage-error/);
  }

  assert.equal(fs.readFileSync(proposalPath, 'utf8'), proposalText, 'CLI must not mutate proposal input');
  assert.equal(fs.readFileSync(confirmationPath, 'utf8'), confirmationText, 'CLI must not mutate confirmation input');
  assert.deepEqual(fs.readdirSync(temp).sort(), initialFiles, 'CLI must not create queue, ledger, or receipt files');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log('hq-modeling-runtime scaffold check: PASS');
