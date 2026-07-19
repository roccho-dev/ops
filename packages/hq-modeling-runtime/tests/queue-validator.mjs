#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  buildProposalPromotionOrigin,
  modelQueueIntegrityDigest,
  validateJsonl,
  validateProposalPromotionRecord,
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

function codes(resultOrErrors) {
  const errors = Array.isArray(resultOrErrors) ? resultOrErrors : resultOrErrors.errors;
  return errors.map((error) => error.code);
}

function recordDataError(errors, reason, path) {
  return errors.find((error) => error.code === 'record-data-invalid'
    && error.reason === reason
    && error.path === path);
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
  const errors = validateRecord(bad);
  assert.ok(errors.some((error) => error.code === 'missing-required-field'));
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
  assert.ok(errors.some((error) => error.code === 'record-data-invalid'));
}

{
  let reads = 0;
  const origin = { kind: 'direct-human.v1', confirmedBy: 'human' };
  Object.defineProperty(origin, 'confirmationId', {
    enumerable: true,
    get() { reads += 1; return 'forged'; },
  });
  const errors = validateRecord({ ...validModel, origin });
  assert.ok(recordDataError(errors, 'accessor-property', '/origin/confirmationId'));
  assert.equal(reads, 0);
}

const authorityCounterexamples = [
  ['acceptedRow field', (row) => { row.acceptedRow = {}; }],
  ['accepted kind infix', (row) => { row.extra = { kind: 'hq.acceptedRow.v1' }; }],
  ['accepted status suffix', (row) => { row.extra = { status: 'accepted-status' }; }],
  ['model authority infix', (row) => { row.evidence = [{ modelAuthorityClaim: true }]; }],
  ['admission infix and approval suffix', (row) => { row.targetRef.isAdmissionApproved = true; }],
  ['authorization field', (row) => { row.payload.authorizationDecision = 'pending'; }],
  ['punctuation/case', (row) => { row.extra = { 'LEDGER-AUTHORITY.CLAIM': true }; }],
  ['admit suffix', (row) => { row.extra = { shouldAdmit: true }; }],
  ['nonAuthority false', (row) => { row.nonAuthority = false; }],
];
for (const [name, mutate] of authorityCounterexamples) {
  const row = structuredClone(validModel);
  mutate(row);
  const errors = validateRecord(row);
  assert.ok(
    errors.some((error) => ['authority-field-present', 'authority-shape-present'].includes(error.code)),
    `${name}: ${JSON.stringify(errors)}`,
  );
}

for (const benign of [
  { ...validModel, author: 'human' },
  { ...validModel, acceptanceCriteria: ['reviewed'] },
  { ...validModel, nonAuthority: true, evidenceOnly: true },
  { ...validModel, payload: { ...validModel.payload, authoritativeSourceName: 'catalog' } },
]) {
  assert.deepEqual(validateRecord(benign), []);
}

for (const embedded of [
  { kind: 'source.observation.v1', id: 'obs_001', status: 'observed' },
  { kind: 'SOURCE.RECEIPT.V1', id: 'sr_001', status: 'observed' },
  { kind: 'model_source_reconcile.v1', id: 'rec_001', result: 'matched' },
]) {
  const bad = { ...validModel, id: `mq_${embedded.kind}`, payload: { edge: validModel.payload, embedded } };
  const errors = validateRecord(bad);
  assert.ok(errors.some((error) => error.code === 'payload-smuggled-row'), JSON.stringify(errors));
}

for (const [name, row, reason, path] of [
  ['payload Date', { ...validModel, payload: { meta: new Date() } }, 'non-plain-object', '/payload/meta'],
  ['target Date', { ...validModel, targetRef: { ...validModel.targetRef, meta: new Date() } }, 'non-plain-object', '/targetRef/meta'],
  ['evidence Map', { ...validModel, evidence: [{ meta: new Map() }] }, 'non-plain-object', '/evidence/0/meta'],
  ['extra NaN', { ...validModel, extra: Number.NaN }, 'non-finite-number', '/extra'],
  ['negative zero', { ...validModel, extra: -0 }, 'negative-zero', '/extra'],
]) {
  const errors = validateRecord(row);
  assert.ok(recordDataError(errors, reason, path), `${name}: ${JSON.stringify(errors)}`);
}

{
  const sparse = [];
  sparse.length = 2;
  sparse[1] = 'present';
  const errors = validateRecord({ ...validModel, extra: sparse });
  assert.ok(recordDataError(errors, 'sparse-array-hole', '/extra/0'));
}

{
  const cycle = {};
  cycle.self = cycle;
  const errors = validateRecord({ ...validModel, extra: cycle });
  assert.ok(recordDataError(errors, 'cycle', '/extra/self'));
}

{
  const nestedProxy = new Proxy({}, {
    ownKeys() { throw new Error('must not run'); },
  });
  const errors = validateRecord({ ...validModel, extra: nestedProxy });
  assert.ok(recordDataError(errors, 'proxy-not-allowed', '/extra'));
}

{
  let reads = 0;
  const selfErasing = structuredClone(validModel);
  Object.defineProperty(selfErasing, 'kind', {
    enumerable: true,
    configurable: true,
    get() {
      reads += 1;
      Object.defineProperty(selfErasing, 'kind', {
        enumerable: true,
        configurable: true,
        writable: true,
        value: 'hq.modelCommitQueued.v1',
      });
      return 'hq.modelCommitQueued.v1';
    },
  });
  const errors = validateRecord(selfErasing);
  assert.ok(recordDataError(errors, 'accessor-property', '/kind'), JSON.stringify(errors));
  assert.equal(reads, 0, 'queue kind getter must never execute');
}

{
  let reads = 0;
  const nested = structuredClone(validModel);
  Object.defineProperty(nested.payload, 'from', {
    enumerable: true,
    configurable: true,
    get() { reads += 1; return 'pkg:core'; },
  });
  const errors = validateRecord(nested);
  assert.ok(recordDataError(errors, 'accessor-property', '/payload/from'));
  assert.equal(reads, 0);
}

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

{
  assert.deepEqual(validateRecord(validProposalRow), []);
  assert.deepEqual(
    validateProposalPromotionRecord(validProposalRow, { expectedOrigin: validProposalRow.origin }),
    [],
  );
  assert.equal(modelQueueIntegrityDigest(validProposalRow), validProposalRow.origin.integrityDigest);
  assert.ok(validateProposalPromotionRecord(validProposalRow).some((error) => error.code === 'expected-proposal-origin-required'));
}

{
  const relabeled = structuredClone(validProposalRow);
  delete relabeled.proposalDigest;
  delete relabeled.evidence;
  relabeled.id = 'mq_relabelled';
  relabeled.reason = 'direct human';
  relabeled.origin = {
    kind: 'direct-human.v1',
    confirmationId: 'forged',
    confirmedBy: relabeled.confirmedBy,
  };
  assert.deepEqual(validateRecord(relabeled), [], 'generic validator accepts explicit direct-human rows at that producer boundary');
  const specialized = validateProposalPromotionRecord(relabeled, { expectedOrigin: validProposalRow.origin });
  assert.ok(specialized.some((error) => error.code === 'proposal-promotion-origin-required'), JSON.stringify(specialized));
}

{
  const rewrittenBase = {
    kind: 'hq.modelCommitQueued.v1',
    id: 'mq_from_proposal_rewritten',
    status: 'queued',
    targetRef: { kind: 'repoMap.node', id: 'pkg:rewritten' },
    op: 'removeEdge',
    payload: { from: 'pkg:a', to: 'pkg:b', type: 'rewritten' },
    evidence: [{ kind: 'digest', value: 'sha256:rewritten' }],
    reason: 'promoted proposal proposal_rewritten',
    confirmedBy: 'rewriter',
    proposalDigest: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  };
  const rewritten = {
    ...rewrittenBase,
    origin: buildProposalPromotionOrigin(rewrittenBase, {
      proposalId: 'proposal_rewritten',
      proposalDigest: rewrittenBase.proposalDigest,
      confirmationDigest: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      confirmedBy: rewrittenBase.confirmedBy,
    }),
  };
  assert.deepEqual(validateRecord(rewritten), [], 'recomputed unkeyed digests prove only internal self-consistency');
  assert.deepEqual(
    validateProposalPromotionRecord(rewritten, { expectedOrigin: rewritten.origin }),
    [],
    'rewritten row is structurally self-consistent against its own supplied origin',
  );
  const continuity = validateProposalPromotionRecord(rewritten, { expectedOrigin: validProposalRow.origin });
  assert.ok(continuity.some((error) => error.code === 'proposal-promotion-expected-origin-mismatch'), JSON.stringify(continuity));
}

for (const [name, mutate, expected] of [
  ['payload', (row) => { row.payload.to = 'pkg:tampered'; }, 'promotion-integrity-mismatch'],
  ['evidence', (row) => { row.evidence[0].value = 'tampered'; }, 'proposal-origin-evidence-digest-mismatch'],
  ['proposal digest', (row) => { row.proposalDigest = 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'; }, 'proposal-origin-digest-mismatch'],
  ['confirmation digest', (row) => { row.origin.confirmationDigest = 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'; }, 'promotion-evidence-id-mismatch'],
  ['promotion evidence id', (row) => { row.origin.promotionEvidenceId = 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'; }, 'promotion-evidence-id-mismatch'],
  ['integrity digest', (row) => { row.origin.integrityDigest = 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'; }, 'promotion-integrity-mismatch'],
]) {
  const bad = structuredClone(validProposalRow);
  mutate(bad);
  const errors = validateProposalPromotionRecord(bad, { expectedOrigin: validProposalRow.origin });
  assert.ok(errors.some((error) => error.code === expected), `${name}: ${JSON.stringify(errors)}`);
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
  assert.ok(validateRecord(bad).some((error) => error.code === 'context-not-array'));
}

{
  const bad = { ...validReceipt, status: 'accepted' };
  const errors = validateRecord(bad);
  assert.ok(errors.some((error) => error.code === 'invalid-status'));
  assert.ok(errors.some((error) => error.code === 'authority-shape-present'));
}

console.log('hq queue validator check: PASS');
