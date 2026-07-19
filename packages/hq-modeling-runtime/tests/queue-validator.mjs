#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  buildProposalPromotionOrigin,
  validateJsonl,
  validateRecord,
} from '../lib/queue-validator.mjs';

const validModel = {
  kind: 'hq.modelCommitQueued.v1',
  id: 'mq_001',
  status: 'queued',
  targetRef: { kind: 'repoMap.node', id: 'pkg:core' },
  op: 'addEdge',
  payload: { from: 'pkg:core', to: 'pkg:ui', type: 'uses' },
  reason: 'model dependency should be visible',
  confirmedBy: 'human',
  origin: { kind: 'direct-human.v1', confirmationId: 'confirmation:mq_001', confirmedBy: 'human' },
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
  const forged = { ...validModel };
  delete forged.origin;
  const errors = validateRecord(forged);
  assert.ok(errors.some((error) => error.code === 'missing-required-field'));
  assert.ok(errors.some((error) => error.code === 'model-origin-not-object'));
}

{
  const inheritedOrigin = Object.create({ kind: 'direct-human.v1', confirmationId: 'forged', confirmedBy: 'human' });
  const errors = validateRecord({ ...validModel, origin: inheritedOrigin });
  assert.ok(errors.some((error) => error.code === 'model-origin-not-object'));
}

{
  let reads = 0;
  const origin = { kind: 'direct-human.v1', confirmedBy: 'human' };
  Object.defineProperty(origin, 'confirmationId', {
    enumerable: true,
    get() { reads += 1; return 'forged'; },
  });
  const errors = validateRecord({ ...validModel, origin });
  assert.ok(errors.some((error) => error.code === 'model-origin-field-not-data'));
  assert.equal(reads, 0);
}

{
  const bad = { ...validModel, payload: { ...validModel.payload, acceptedLedger: true } };
  const result = validateJsonl(JSON.stringify(bad));
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('authority-field-present'));
}

{
  const directSource = { kind: 'source.observation.v1', id: 'obs_001', status: 'observed' };
  const result = validateJsonl(JSON.stringify(directSource));
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('unknown-kind'));
}

for (const embedded of [
  { kind: 'source.observation.v1', id: 'obs_001', status: 'observed' },
  { kind: 'source.receipt.v1', id: 'sr_001', status: 'observed' },
  { kind: 'model_source_reconcile.v1', id: 'rec_001', result: 'matched' },
  { kind: 'admission.receipt.v1', id: 'adm_001', status: 'admitted' },
  { kind: 'accepted.modelCommit.v1', id: 'accepted:mq_001', sourceQueueId: 'mq_001', acceptedDigest: 'sha256:x' },
]) {
  const bad = { ...validModel, id: `mq_${embedded.kind}`, payload: { edge: validModel.payload, embedded } };
  const result = validateJsonl(JSON.stringify(bad));
  assert.equal(result.ok, false, embedded.kind);
  assert.ok(codes(result).some((code) => ['payload-smuggled-row', 'authority-shape-present'].includes(code)), JSON.stringify(result.errors));
}

for (const [name, mutate] of [
  ['top acceptedRow', (row) => { row.acceptedRow = {}; }],
  ['evidence AcceptedDigest', (row) => { row.evidence = [{ AcceptedDigest: 'sha256:x' }]; }],
  ['target authority', (row) => { row.targetRef.AUTHORITY_STATE = 'accepted'; }],
  ['payload admission-like', (row) => { row.payload.AdmissionLike = true; }],
  ['extra accepted kind', (row) => { row.extra = { kind: 'Accepted.ModelCommit.v1' }; }],
  ['extra admitted status', (row) => { row.extra = { status: 'ADMITTED' }; }],
]) {
  const bad = structuredClone(validModel);
  mutate(bad);
  const errors = validateRecord(bad);
  assert.ok(errors.some((error) => ['authority-field-present', 'authority-shape-present'].includes(error.code)), `${name}: ${JSON.stringify(errors)}`);
}

{
  const proposalBase = {
    kind: 'hq.modelCommitQueued.v1',
    id: 'mq_from_proposal_001',
    status: 'queued',
    targetRef: { kind: 'repoMap.node', id: 'pkg:core' },
    op: 'addEdge',
    payload: { from: 'pkg:core', to: 'pkg:ui', type: 'uses' },
    evidence: [{ kind: 'digest', value: 'sha256:evidence' }],
    reason: 'promoted proposal proposal_001',
    confirmedBy: 'human-review',
    proposalDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  };
  const validProposalRow = {
    ...proposalBase,
    origin: buildProposalPromotionOrigin(proposalBase, {
      proposalId: 'proposal_001',
      proposalDigest: proposalBase.proposalDigest,
      confirmationDigest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      confirmedBy: proposalBase.confirmedBy,
    }),
  };
  assert.deepEqual(validateRecord(validProposalRow), []);

  const stripped = structuredClone(validProposalRow);
  delete stripped.origin;
  assert.ok(validateRecord(stripped).some((error) => error.code === 'missing-required-field'));

  const relabeled = structuredClone(validProposalRow);
  relabeled.origin = { kind: 'direct-human.v1', confirmationId: 'forged', confirmedBy: relabeled.confirmedBy };
  assert.ok(validateRecord(relabeled).some((error) => error.code === 'proposal-origin-mismatch'));

  for (const [name, mutate, expected] of [
    ['payload', (row) => { row.payload.to = 'pkg:tampered'; }, 'promotion-integrity-mismatch'],
    ['evidence', (row) => { row.evidence[0].value = 'tampered'; }, 'proposal-origin-evidence-digest-mismatch'],
    ['proposal digest', (row) => { row.proposalDigest = 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'; }, 'proposal-origin-digest-mismatch'],
    ['confirmation digest', (row) => { row.origin.confirmationDigest = 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'; }, 'promotion-evidence-id-mismatch'],
    ['promotion evidence id', (row) => { row.origin.promotionEvidenceId = 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'; }, 'promotion-evidence-id-mismatch'],
    ['integrity digest', (row) => { row.origin.integrityDigest = 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'; }, 'promotion-integrity-mismatch'],
  ]) {
    const bad = structuredClone(validProposalRow);
    mutate(bad);
    const errors = validateRecord(bad);
    assert.ok(errors.some((error) => error.code === expected), `${name}: ${JSON.stringify(errors)}`);
  }
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
  const cmd = fs.existsSync(siblingBin) ? [process.execPath, siblingBin] : ['hq-modeling-runtime'];

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
      encoding: 'utf8', timeout: 10_000,
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
