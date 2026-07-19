#!/usr/bin/env node
import assert from 'node:assert/strict';

import * as modelingProposal from '../lib/modeling-proposal.mjs';
import * as promotionGate from '../lib/promotion-gate.mjs';
import {
  buildProposalPromotionOrigin,
  modelQueueIntegrityDigest,
  validateRecord,
} from '../lib/queue-validator.mjs';

const { proposalDigest, validateModelingProposal } = modelingProposal;
const { promoteProposalToModelQueue } = promotionGate;

assert.deepEqual(Object.keys(modelingProposal).sort(), ['proposalDigest', 'validateModelingProposal']);
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
const validConfirmation = { confirm: true, confirmedBy: 'human-review', proposalDigest: validProposalDigest };
assert.match(validProposalDigest, /^sha256:[0-9a-f]{64}$/);

let validResult;
{
  const promotedProposal = structuredClone(proposal);
  const beforeProposal = structuredClone(promotedProposal);
  const beforeConfirmation = structuredClone(validConfirmation);
  const result = promoteProposalToModelQueue(promotedProposal, validConfirmation);
  validResult = result;

  const expectedBase = {
    kind: 'hq.modelCommitQueued.v1',
    id: 'mq_from_proposal_001',
    status: 'queued',
    targetRef: structuredClone(proposal.targetRef),
    op: 'addEdge',
    payload: structuredClone(proposal.proposedOperation.payload),
    evidence: structuredClone(proposal.evidence),
    reason: 'promoted proposal proposal_001',
    confirmedBy: 'human-review',
    proposalDigest: validProposalDigest,
  };
  const expectedQueueRow = {
    ...expectedBase,
    origin: buildProposalPromotionOrigin(expectedBase, {
      proposalId: proposal.id,
      proposalDigest: validProposalDigest,
      confirmationDigest: result.queueRow.origin.confirmationDigest,
      confirmedBy: 'human-review',
    }),
  };

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.queueRow, expectedQueueRow);
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
  assert.match(result.queueRow.origin.confirmationDigest, /^sha256:[0-9a-f]{64}$/);
  assert.match(result.queueRow.origin.evidenceDigest, /^sha256:[0-9a-f]{64}$/);
  assert.match(result.queueRow.origin.promotionEvidenceId, /^sha256:[0-9a-f]{64}$/);
  assert.match(result.queueRow.origin.integrityDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(modelQueueIntegrityDigest(result.queueRow), result.queueRow.origin.integrityDigest);
  assert.deepEqual(promotedProposal, beforeProposal, 'promotion must not mutate proposal input');
  assert.deepEqual(validConfirmation, beforeConfirmation, 'promotion must not mutate confirmation input');
  assert.notStrictEqual(result.queueRow.targetRef, promotedProposal.targetRef);
  assert.notStrictEqual(result.queueRow.targetRef.coordinates, promotedProposal.targetRef.coordinates);
  assert.notStrictEqual(result.queueRow.targetRef.path, promotedProposal.targetRef.path);
  assert.notStrictEqual(result.queueRow.payload, promotedProposal.proposedOperation.payload);
  assert.notStrictEqual(result.queueRow.payload.metadata, promotedProposal.proposedOperation.payload.metadata);
  assert.notStrictEqual(result.queueRow.payload.steps, promotedProposal.proposedOperation.payload.steps);
  assert.notStrictEqual(result.queueRow.evidence, promotedProposal.evidence);
  assert.notStrictEqual(result.queueRow.evidence[0], promotedProposal.evidence[0]);
  assert.deepEqual(validateRecord(result.queueRow), []);

  promotedProposal.targetRef.id = 'pkg:mutated';
  promotedProposal.proposedOperation.payload.type = 'dependsOn';
  promotedProposal.evidence[0].value = 'sha256:mutated';
  promotedProposal.status = 'rejected';
  assert.deepEqual(result.queueRow, expectedQueueRow);
  assert.deepEqual(validateRecord(result.queueRow), []);
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
  assert.ok(codes(result).some((code) => ['confirmation-field-not-own', 'confirmation-not-true', 'confirmation-field-type-invalid'].includes(code)));
}

for (const confirmedBy of [undefined, null, '', '   ']) {
  const result = promoteProposalToModelQueue(proposal, { confirm: true, confirmedBy, proposalDigest: validProposalDigest });
  assert.equal(result.ok, false);
  assert.ok(codes(result).some((code) => ['confirmedBy-missing', 'confirmation-field-type-invalid'].includes(code)));
}

for (const digest of [undefined, null, '', 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb']) {
  const result = promoteProposalToModelQueue(proposal, { confirm: true, confirmedBy: 'human-review', proposalDigest: digest });
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

{
  const incomplete = { kind: 'modeling.proposal.v1' };
  const result = promoteProposalToModelQueue(incomplete, validConfirmation);
  assertStableFailure(result, 'missing-required-field');
  assert.equal(codes(result).includes('proposal-digest-mismatch'), false);
}

{
  let confirmationReads = 0;
  const hostileConfirmation = new Proxy({}, {
    get() { confirmationReads += 1; throw new Error('get trap'); },
    ownKeys() { confirmationReads += 1; throw new Error('ownKeys trap'); },
    getOwnPropertyDescriptor() { confirmationReads += 1; throw new Error('descriptor trap'); },
    getPrototypeOf() { confirmationReads += 1; throw new Error('prototype trap'); },
  });
  assert.doesNotThrow(() => {
    assertStableFailure(promoteProposalToModelQueue(proposal, hostileConfirmation), 'confirmation-proxy-rejected');
  });
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
  assert.equal(getterReads, 0, 'confirmation accessors must never run');
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
  assert.deepEqual(validateRecord(result.queueRow), []);
}

for (const [name, value, reason] of [
  ['bigint', 1n, 'bigint'],
  ['nan', Number.NaN, 'non-finite-number'],
  ['positive-infinity', Number.POSITIVE_INFINITY, 'non-finite-number'],
  ['negative-zero', -0, 'negative-zero'],
  ['date', new Date('2026-07-18T00:00:00Z'), 'non-plain-object'],
  ['map', new Map([['key', 'value']]), 'non-plain-object'],
  ['undefined', undefined, 'undefined'],
  ['function', () => {}, 'function'],
  ['symbol', Symbol('value'), 'symbol'],
]) {
  assert.doesNotThrow(() => {
    const result = promoteProposalToModelQueue(withPayload(value), validConfirmation);
    assertStableFailure(result, 'proposal-data-invalid');
    const error = result.errors.find((entry) => entry.code === 'proposal-data-invalid');
    assert.equal(error.reason, reason, name);
    assert.equal(error.path, '/proposedOperation/payload/bad', name);
  });
}

{
  const cycle = {};
  cycle.self = cycle;
  assertStableFailure(promoteProposalToModelQueue(withPayload(cycle), validConfirmation), 'proposal-data-invalid');
}

const proposalAuthorityCounterexamples = [
  ['top acceptedRow', (candidate) => { candidate.acceptedRow = { id: 'a' }; }],
  ['evidence AcceptedDigest', (candidate) => { candidate.evidence[0].AcceptedDigest = 'sha256:x'; }],
  ['target admission-like', (candidate) => { candidate.targetRef.admissionLike = true; }],
  ['payload authority-state', (candidate) => { candidate.proposedOperation.payload.nested = { AUTHORITY_STATE: 'accepted' }; }],
  ['extra accepted kind', (candidate) => { candidate.extra = { kind: 'Accepted.ModelCommit.v1' }; }],
  ['extra admitted status', (candidate) => { candidate.extra = { status: 'ADMITTED' }; }],
];
for (const [name, mutate] of proposalAuthorityCounterexamples) {
  const candidate = structuredClone(proposal);
  mutate(candidate);
  const errors = validateModelingProposal(candidate);
  assert.ok(errors.some((error) => ['authority-field-present', 'authority-shape-present', 'embedded-authority-shape'].includes(error.code)), `${name}: ${JSON.stringify(errors)}`);
  assert.equal(promoteProposalToModelQueue(candidate, validConfirmation).ok, false, name);
}

const queueAuthorityCounterexamples = [
  ['evidence acceptedRow', (row) => { row.evidence[0].acceptedRow = {}; }],
  ['target AcceptedDigest', (row) => { row.targetRef.AcceptedDigest = 'sha256:x'; }],
  ['payload admission kind', (row) => { row.payload.extra = { kind: 'ADMISSION.RECEIPT.V1' }; }],
  ['extra accepted status', (row) => { row.extra = { status: 'Accepted' }; }],
  ['extra authority-like', (row) => { row.extra = { authorityClaim: true }; }],
];
for (const [name, mutate] of queueAuthorityCounterexamples) {
  const row = structuredClone(validResult.queueRow);
  mutate(row);
  const errors = validateRecord(row);
  assert.ok(errors.some((error) => ['authority-field-present', 'authority-shape-present'].includes(error.code)), `${name}: ${JSON.stringify(errors)}`);
}

{
  const stripped = structuredClone(validResult.queueRow);
  delete stripped.origin;
  const errors = validateRecord(stripped);
  assert.ok(errors.some((error) => error.code === 'missing-required-field'));
  assert.ok(errors.some((error) => error.code === 'model-origin-not-object'));
}

for (const [name, mutate, expectedCode] of [
  ['payload', (row) => { row.payload.to = 'pkg:tampered'; }, 'promotion-integrity-mismatch'],
  ['target', (row) => { row.targetRef.id = 'pkg:tampered'; }, 'promotion-integrity-mismatch'],
  ['evidence', (row) => { row.evidence[0].value = 'sha256:tampered'; }, 'proposal-origin-evidence-digest-mismatch'],
  ['proposal digest', (row) => { row.proposalDigest = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'; }, 'proposal-origin-digest-mismatch'],
  ['confirmation identity', (row) => { row.origin.confirmationDigest = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'; }, 'promotion-evidence-id-mismatch'],
  ['promotion evidence identity', (row) => { row.origin.promotionEvidenceId = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'; }, 'promotion-evidence-id-mismatch'],
  ['integrity', (row) => { row.origin.integrityDigest = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'; }, 'promotion-integrity-mismatch'],
]) {
  const row = structuredClone(validResult.queueRow);
  mutate(row);
  const errors = validateRecord(row);
  assert.ok(errors.some((error) => error.code === expectedCode), `${name}: ${JSON.stringify(errors)}`);
}

{
  const relabeled = structuredClone(validResult.queueRow);
  relabeled.origin = { kind: 'direct-human.v1', confirmationId: 'forged', confirmedBy: relabeled.confirmedBy };
  const errors = validateRecord(relabeled);
  assert.ok(errors.some((error) => error.code === 'proposal-origin-mismatch'), JSON.stringify(errors));
}

{
  const forgedMinimal = {
    kind: 'hq.modelCommitQueued.v1',
    id: 'mq_forged',
    status: 'queued',
    targetRef: { kind: 'repoMap.node', id: 'pkg:forged' },
    op: 'addEdge',
    payload: {},
    confirmedBy: 'human',
  };
  const errors = validateRecord(forgedMinimal);
  assert.ok(errors.some((error) => error.code === 'missing-required-field'));
}

{
  const originalStructuredClone = globalThis.structuredClone;
  let clones = 0;
  globalThis.structuredClone = (value) => {
    clones += 1;
    return originalStructuredClone(value);
  };
  try {
    const result = promoteProposalToModelQueue(proposal, validConfirmation);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(clones, 1, 'promotion must take exactly one proposal structuredClone snapshot');
  } finally {
    globalThis.structuredClone = originalStructuredClone;
  }
}

{
  const originalStructuredClone = globalThis.structuredClone;
  globalThis.structuredClone = () => { throw new Error('forced clone failure'); };
  try {
    assertStableFailure(promoteProposalToModelQueue(proposal, validConfirmation), 'proposal-snapshot-failed');
  } finally {
    globalThis.structuredClone = originalStructuredClone;
  }
}

console.log('hq human promotion gate check: PASS');
