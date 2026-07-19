#!/usr/bin/env node
import assert from 'node:assert/strict';

import * as modelingProposal from '../lib/modeling-proposal.mjs';
import * as promotionGate from '../lib/promotion-gate.mjs';
import {
  buildProposalPromotionOrigin,
  modelQueueIntegrityDigest,
  validateProposalPromotionRecord,
  validateRecord,
} from '../lib/queue-validator.mjs';

const {
  proposalDigest,
  snapshotModelingProposal,
  validateModelingProposal,
} = modelingProposal;
const { promoteProposalToModelQueue } = promotionGate;

assert.deepEqual(
  Object.keys(modelingProposal).sort(),
  ['proposalDigest', 'snapshotModelingProposal', 'validateModelingProposal'],
);
assert.equal('proposalToQueueIntentCandidate' in modelingProposal, false);
assert.deepEqual(Object.keys(promotionGate).sort(), ['promoteProposalToModelQueue']);

const proposal = {
  kind: 'modeling.proposal.v1',
  id: 'proposal_001',
  sourceAgentTaskId: 'aq_agent_001',
  targetRef: {
    kind: 'repoMap.node',
    id: 'pkg:core',
    coordinates: { repo: 'ops', package: 'hq-modeling-runtime' },
    path: ['packages', 'hq-modeling-runtime'],
  },
  proposedOperation: {
    op: 'addEdge',
    payload: {
      from: 'pkg:core',
      to: 'pkg:ui',
      type: 'uses',
      metadata: { reviewed: true, risk: 'bounded', optional: null },
      steps: ['validate', { kind: 'emit', details: { destination: 'model-queue' } }],
    },
  },
  evidence: [{ kind: 'digest', value: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }],
  acceptanceCriteria: ['human may promote into model queue only after review'],
  status: 'proposed',
};

function codes(result) {
  return result.errors.map((error) => error.code);
}

function assertStableFailure(result, expectedCode) {
  assert.equal(result.ok, false);
  assert.deepEqual(Object.keys(result).sort(), ['errors', 'ok', 'queueRow']);
  assert.equal(result.queueRow, null);
  assert.equal('promotionReceipt' in result, false);
  assert.ok(codes(result).includes(expectedCode), JSON.stringify(result.errors));
}

function withPayload(value) {
  return {
    ...proposal,
    proposedOperation: {
      ...proposal.proposedOperation,
      payload: { ...proposal.proposedOperation.payload, bad: value },
    },
  };
}

const validProposalDigest = proposalDigest(proposal);
const validConfirmation = {
  confirm: true,
  confirmedBy: 'human-review',
  proposalDigest: validProposalDigest,
};

let validResult;
{
  const promotedProposal = structuredClone(proposal);
  const beforeProposal = structuredClone(promotedProposal);
  const beforeConfirmation = structuredClone(validConfirmation);
  const result = promoteProposalToModelQueue(promotedProposal, validConfirmation);
  validResult = result;

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.queueRow.kind, 'hq.modelCommitQueued.v1');
  assert.equal(result.queueRow.origin.kind, 'proposal-promotion.v1');
  assert.equal(result.queueRow.origin.proposalId, proposal.id);
  assert.equal(result.queueRow.origin.proposalDigest, validProposalDigest);
  assert.equal(result.queueRow.proposalDigest, validProposalDigest);
  assert.deepEqual(result.queueRow.evidence, proposal.evidence);
  assert.equal(modelQueueIntegrityDigest(result.queueRow), result.queueRow.origin.integrityDigest);
  assert.deepEqual(validateRecord(result.queueRow), []);
  assert.deepEqual(
    validateProposalPromotionRecord(result.queueRow, { expectedOrigin: result.queueRow.origin }),
    [],
  );

  assert.equal(result.promotionReceipt.kind, 'proposal.promotionReceipt.v1');
  assert.equal(result.promotionReceipt.id, result.queueRow.origin.promotionEvidenceId);
  assert.equal(result.promotionReceipt.proposalId, proposal.id);
  assert.equal(result.promotionReceipt.proposalDigest, validProposalDigest);
  assert.equal(result.promotionReceipt.queueId, result.queueRow.id);
  assert.equal(result.promotionReceipt.queueIntegrityDigest, result.queueRow.origin.integrityDigest);
  assert.equal(result.promotionReceipt.confirmationDigest, result.queueRow.origin.confirmationDigest);
  assert.equal(result.promotionReceipt.evidenceDigest, result.queueRow.origin.evidenceDigest);
  assert.equal(result.promotionReceipt.promotionEvidenceId, result.queueRow.origin.promotionEvidenceId);
  assert.equal(result.promotionReceipt.confirmedBy, 'human-review');
  assert.equal(result.promotionReceipt.evidenceOnly, true);
  assert.equal(result.promotionReceipt.nonAuthority, true);

  assert.deepEqual(promotedProposal, beforeProposal, 'promotion must not mutate proposal input');
  assert.deepEqual(validConfirmation, beforeConfirmation, 'promotion must not mutate confirmation input');
  assert.notStrictEqual(result.queueRow.targetRef, promotedProposal.targetRef);
  assert.notStrictEqual(result.queueRow.payload, promotedProposal.proposedOperation.payload);
  assert.notStrictEqual(result.queueRow.evidence, promotedProposal.evidence);

  promotedProposal.targetRef.id = 'pkg:mutated';
  promotedProposal.proposedOperation.payload.type = 'dependsOn';
  promotedProposal.evidence[0].value = 'sha256:mutated';
  promotedProposal.status = 'rejected';
  assert.equal(result.queueRow.targetRef.id, 'pkg:core');
  assert.equal(result.queueRow.payload.type, 'uses');
  assert.equal(result.queueRow.evidence[0].value, proposal.evidence[0].value);
}

for (const confirmation of [undefined, null, [], 'confirmed', 1, true]) {
  assertStableFailure(promoteProposalToModelQueue(proposal, confirmation), 'confirmation-missing');
}

for (const confirmation of [
  { confirmedBy: 'human-review', proposalDigest: validProposalDigest },
  { confirm: false, confirmedBy: 'human-review', proposalDigest: validProposalDigest },
  { confirm: null, confirmedBy: 'human-review', proposalDigest: validProposalDigest },
]) {
  const result = promoteProposalToModelQueue(proposal, confirmation);
  assert.equal(result.ok, false);
  assert.ok(codes(result).some((code) => [
    'confirmation-field-not-own',
    'confirmation-not-true',
    'confirmation-field-type-invalid',
  ].includes(code)));
}

for (const confirmedBy of [undefined, null, '', '   ']) {
  const result = promoteProposalToModelQueue(proposal, {
    confirm: true,
    confirmedBy,
    proposalDigest: validProposalDigest,
  });
  assert.equal(result.ok, false);
  assert.ok(codes(result).some((code) => ['confirmedBy-missing', 'confirmation-field-type-invalid'].includes(code)));
}

for (const digest of [undefined, null, '', 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb']) {
  const result = promoteProposalToModelQueue(proposal, {
    confirm: true,
    confirmedBy: 'human-review',
    proposalDigest: digest,
  });
  assert.equal(result.ok, false);
  assert.ok(codes(result).some((code) => ['proposal-digest-mismatch', 'confirmation-field-type-invalid'].includes(code)));
}

for (const status of ['rejected', 'promoted']) {
  const nonProposed = { ...proposal, status };
  assertStableFailure(
    promoteProposalToModelQueue(nonProposed, {
      confirm: true,
      confirmedBy: 'human-review',
      proposalDigest: proposalDigest(nonProposed),
    }),
    'proposal-not-promotable',
  );
}

for (const malformed of [undefined, null, [], 'proposal', 1, true, 1n, Symbol('proposal'), () => {}]) {
  assert.doesNotThrow(() => {
    assertStableFailure(promoteProposalToModelQueue(malformed, validConfirmation), 'proposal-not-object');
  });
}

// B1: own enumerable primitive data properties only; no getter or Proxy execution.
{
  let confirmationReads = 0;
  const hostileConfirmation = new Proxy({}, {
    get() { confirmationReads += 1; throw new Error('get trap'); },
    ownKeys() { confirmationReads += 1; throw new Error('ownKeys trap'); },
    getOwnPropertyDescriptor() { confirmationReads += 1; throw new Error('descriptor trap'); },
    getPrototypeOf() { confirmationReads += 1; throw new Error('prototype trap'); },
  });
  assertStableFailure(promoteProposalToModelQueue(proposal, hostileConfirmation), 'confirmation-proxy-rejected');
  assert.equal(confirmationReads, 0, 'Proxy traps must not be invoked');
}

{
  const lyingProxy = new Proxy({}, {
    getPrototypeOf() { return Object.prototype; },
    ownKeys() { return ['confirm', 'confirmedBy', 'proposalDigest']; },
    getOwnPropertyDescriptor(_target, field) {
      return { enumerable: true, configurable: true, value: validConfirmation[field], writable: true };
    },
  });
  assertStableFailure(promoteProposalToModelQueue(proposal, lyingProxy), 'confirmation-proxy-rejected');
}

{
  let getterReads = 0;
  const accessorConfirmation = {
    confirmedBy: 'human-review',
    proposalDigest: validProposalDigest,
  };
  Object.defineProperty(accessorConfirmation, 'confirm', {
    enumerable: true,
    get() {
      getterReads += 1;
      accessorConfirmation.confirmedBy = 'mutated-on-read';
      return true;
    },
  });
  assertStableFailure(promoteProposalToModelQueue(proposal, accessorConfirmation), 'confirmation-field-not-data');
  assert.equal(getterReads, 0);
  assert.equal(accessorConfirmation.confirmedBy, 'human-review');
}

{
  const throwingAccessor = { confirmedBy: 'human-review', proposalDigest: validProposalDigest };
  Object.defineProperty(throwingAccessor, 'confirm', {
    enumerable: true,
    get() { throw new Error('must never run'); },
  });
  assert.doesNotThrow(() => {
    assertStableFailure(promoteProposalToModelQueue(proposal, throwingAccessor), 'confirmation-field-not-data');
  });
}

{
  const nonEnumerable = { confirm: true, confirmedBy: 'human-review', proposalDigest: validProposalDigest };
  Object.defineProperty(nonEnumerable, 'confirm', { value: true, enumerable: false });
  assertStableFailure(promoteProposalToModelQueue(proposal, nonEnumerable), 'confirmation-field-not-enumerable');
}

{
  Object.defineProperties(Object.prototype, {
    confirm: { value: true, enumerable: true, configurable: true },
    confirmedBy: { value: 'polluted-human', enumerable: true, configurable: true },
    proposalDigest: { value: validProposalDigest, enumerable: true, configurable: true },
  });
  try {
    assertStableFailure(promoteProposalToModelQueue(proposal, {}), 'confirmation-field-not-own');
  } finally {
    delete Object.prototype.confirm;
    delete Object.prototype.confirmedBy;
    delete Object.prototype.proposalDigest;
  }
}

{
  const nullPrototypeConfirmation = Object.assign(Object.create(null), validConfirmation);
  const result = promoteProposalToModelQueue(proposal, nullPrototypeConfirmation);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(
    validateProposalPromotionRecord(result.queueRow, { expectedOrigin: result.queueRow.origin }),
    [],
  );
}

// B2: whole proposal JSON totality, authority vocabulary, and mutation-on-read.
for (const [candidate, reason, path] of [
  [withPayload(new Date()), 'non-plain-object', '/proposedOperation/payload/bad'],
  [{ ...proposal, targetRef: { ...proposal.targetRef, meta: new Date() } }, 'non-plain-object', '/targetRef/meta'],
  [{ ...proposal, evidence: [{ ...proposal.evidence[0], meta: new Map() }] }, 'non-plain-object', '/evidence/0/meta'],
]) {
  const result = promoteProposalToModelQueue(candidate, validConfirmation);
  assertStableFailure(result, 'proposal-data-invalid');
  assert.ok(result.errors.some((error) => error.reason === reason && error.path === path));
}

for (const [name, mutate] of [
  ['accepted kind infix', (candidate) => { candidate.extra = { kind: 'hq.acceptedRow.v1' }; }],
  ['accepted status suffix', (candidate) => { candidate.extra = { status: 'accepted-status' }; }],
  ['authority field infix', (candidate) => { candidate.evidence[0].modelAuthorityClaim = true; }],
  ['admission and approval field', (candidate) => { candidate.targetRef.isAdmissionApproved = true; }],
]) {
  const candidate = structuredClone(proposal);
  mutate(candidate);
  const result = promoteProposalToModelQueue(candidate, validConfirmation);
  assert.equal(result.ok, false, name);
  assert.ok(result.errors.some((error) => ['authority-field-present', 'authority-shape-present'].includes(error.code)), `${name}: ${JSON.stringify(result.errors)}`);
}

{
  let reads = 0;
  const selfErasing = structuredClone(proposal);
  Object.defineProperty(selfErasing, 'kind', {
    enumerable: true,
    configurable: true,
    get() {
      reads += 1;
      Object.defineProperty(selfErasing, 'kind', {
        enumerable: true,
        configurable: true,
        writable: true,
        value: 'modeling.proposal.v1',
      });
      return 'modeling.proposal.v1';
    },
  });
  const result = promoteProposalToModelQueue(selfErasing, validConfirmation);
  assertStableFailure(result, 'proposal-data-invalid');
  assert.equal(reads, 0, 'proposal getter must never execute');
}

// B3: generic direct-human trust boundary versus proposal-promotion continuity port.
{
  const relabeled = structuredClone(validResult.queueRow);
  delete relabeled.proposalDigest;
  delete relabeled.evidence;
  relabeled.id = 'mq_relabelled';
  relabeled.reason = 'direct human';
  relabeled.origin = {
    kind: 'direct-human.v1',
    confirmationId: 'forged',
    confirmedBy: relabeled.confirmedBy,
  };
  assert.deepEqual(validateRecord(relabeled), []);
  const specialized = validateProposalPromotionRecord(relabeled, {
    expectedOrigin: validResult.queueRow.origin,
  });
  assert.ok(specialized.some((error) => error.code === 'proposal-promotion-origin-required'));
}

{
  const rewrittenBase = {
    kind: 'hq.modelCommitQueued.v1',
    id: 'mq_from_rewritten',
    status: 'queued',
    targetRef: { kind: 'repoMap.node', id: 'pkg:rewritten' },
    op: 'replace',
    payload: { complete: 'rewrite' },
    evidence: [{ kind: 'digest', value: 'rewritten' }],
    reason: 'promoted proposal rewritten',
    confirmedBy: 'rewriter',
    proposalDigest: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  };
  const rewritten = {
    ...rewrittenBase,
    origin: buildProposalPromotionOrigin(rewrittenBase, {
      proposalId: 'rewritten',
      proposalDigest: rewrittenBase.proposalDigest,
      confirmationDigest: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      confirmedBy: rewrittenBase.confirmedBy,
    }),
  };
  assert.deepEqual(validateRecord(rewritten), []);
  assert.deepEqual(validateProposalPromotionRecord(rewritten, { expectedOrigin: rewritten.origin }), []);
  const continuity = validateProposalPromotionRecord(rewritten, {
    expectedOrigin: validResult.queueRow.origin,
  });
  assert.ok(continuity.some((error) => error.code === 'proposal-promotion-expected-origin-mismatch'));
}

for (const [name, mutate, expected] of [
  ['payload', (row) => { row.payload.to = 'pkg:tampered'; }, 'promotion-integrity-mismatch'],
  ['evidence', (row) => { row.evidence[0].value = 'tampered'; }, 'proposal-origin-evidence-digest-mismatch'],
  ['confirmation', (row) => { row.origin.confirmationDigest = 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'; }, 'promotion-evidence-id-mismatch'],
]) {
  const row = structuredClone(validResult.queueRow);
  mutate(row);
  const errors = validateProposalPromotionRecord(row, {
    expectedOrigin: validResult.queueRow.origin,
  });
  assert.ok(errors.some((error) => error.code === expected), `${name}: ${JSON.stringify(errors)}`);
}

console.log('hq human promotion gate check: PASS');
