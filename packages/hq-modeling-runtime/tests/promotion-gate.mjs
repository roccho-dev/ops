#!/usr/bin/env node
import assert from 'node:assert/strict';

import * as modelingProposal from '../lib/modeling-proposal.mjs';
import * as promotionGate from '../lib/promotion-gate.mjs';
import { validateRecord } from '../lib/queue-validator.mjs';

const { proposalDigest } = modelingProposal;
const { promoteProposalToModelQueue } = promotionGate;

assert.deepEqual(
  Object.keys(modelingProposal).sort(),
  ['proposalDigest', 'validateModelingProposal'],
);
assert.equal('proposalToQueueIntentCandidate' in modelingProposal, false);
assert.deepEqual(
  Object.keys(promotionGate).sort(),
  ['promoteProposalToModelQueue'],
);

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
assert.match(validProposalDigest, /^sha256:/);

{
  const promotedProposal = structuredClone(proposal);
  const beforeProposal = structuredClone(promotedProposal);
  const beforeConfirmation = structuredClone(validConfirmation);
  const result = promoteProposalToModelQueue(promotedProposal, validConfirmation);
  const expectedQueueRow = {
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
  const expectedReceipt = {
    kind: 'proposal.promotionReceipt.v1',
    proposalId: 'proposal_001',
    proposalDigest: validProposalDigest,
    queueId: 'mq_from_proposal_001',
    confirmedBy: 'human-review',
    evidenceOnly: true,
    nonAuthority: true,
  };

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.queueRow, expectedQueueRow);
  assert.deepEqual(result.promotionReceipt, expectedReceipt);
  assert.deepEqual(promotedProposal, beforeProposal, 'promotion must not mutate proposal input');
  assert.deepEqual(validConfirmation, beforeConfirmation, 'promotion must not mutate confirmation input');
  assert.notStrictEqual(result.queueRow.targetRef, promotedProposal.targetRef);
  assert.notStrictEqual(result.queueRow.targetRef.coordinates, promotedProposal.targetRef.coordinates);
  assert.notStrictEqual(result.queueRow.targetRef.path, promotedProposal.targetRef.path);
  assert.notStrictEqual(result.queueRow.payload, promotedProposal.proposedOperation.payload);
  assert.notStrictEqual(result.queueRow.payload.metadata, promotedProposal.proposedOperation.payload.metadata);
  assert.notStrictEqual(result.queueRow.payload.steps, promotedProposal.proposedOperation.payload.steps);
  assert.notStrictEqual(result.queueRow.payload.steps[1], promotedProposal.proposedOperation.payload.steps[1]);
  assert.notStrictEqual(result.queueRow.evidence, promotedProposal.evidence);
  assert.notStrictEqual(result.queueRow.evidence[0], promotedProposal.evidence[0]);
  assert.ok(!('accepted' in result.promotionReceipt));
  assert.deepEqual(validateRecord(result.queueRow), []);

  promotedProposal.targetRef.id = 'pkg:mutated';
  promotedProposal.targetRef.coordinates.repo = 'mutated';
  promotedProposal.targetRef.path.push('mutated');
  promotedProposal.proposedOperation.payload.type = 'dependsOn';
  promotedProposal.proposedOperation.payload.metadata.reviewed = false;
  promotedProposal.proposedOperation.payload.steps.push('mutated');
  promotedProposal.proposedOperation.payload.steps[1].kind = 'mutated';
  promotedProposal.proposedOperation.payload.steps[1].details.destination = 'mutated';
  promotedProposal.evidence[0].value = 'sha256:mutated';
  promotedProposal.evidence.push({ kind: 'note', value: 'mutated' });
  promotedProposal.id = 'proposal_mutated';
  promotedProposal.proposedOperation.op = 'removeEdge';
  promotedProposal.status = 'rejected';

  assert.deepEqual(result.queueRow, expectedQueueRow);
  assert.deepEqual(result.promotionReceipt, expectedReceipt);
  assert.equal(result.queueRow.proposalDigest, validProposalDigest);
  assert.equal(result.promotionReceipt.proposalDigest, validProposalDigest);
  assert.notEqual(proposalDigest(promotedProposal), validProposalDigest);
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
  assertStableFailure(promoteProposalToModelQueue(proposal, confirmation), 'confirmation-not-true');
}

for (const confirmedBy of [undefined, null, '', '   ']) {
  assertStableFailure(
    promoteProposalToModelQueue(proposal, { confirm: true, confirmedBy, proposalDigest: validProposalDigest }),
    'confirmedBy-missing',
  );
}

for (const digest of [undefined, null, '', 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb']) {
  assertStableFailure(
    promoteProposalToModelQueue(proposal, { confirm: true, confirmedBy: 'human-review', proposalDigest: digest }),
    'proposal-digest-mismatch',
  );
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

{
  const authority = { ...proposal, acceptedLedger: true };
  assertStableFailure(promoteProposalToModelQueue(authority, validConfirmation), 'authority-field-present');
}

{
  const nestedAuthority = {
    ...proposal,
    proposedOperation: {
      ...proposal.proposedOperation,
      payload: { nested: [{ authorityState: 'accepted' }] },
    },
  };
  assertStableFailure(promoteProposalToModelQueue(nestedAuthority, validConfirmation), 'authority-field-present');
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
  const invalidKindWithDigestTrap = { kind: 'not.modeling.proposal.v1' };
  Object.defineProperty(invalidKindWithDigestTrap, 'digestTrap', {
    enumerable: true,
    get() {
      throw new Error('digest must not inspect validator-invalid proposal');
    },
  });
  assert.doesNotThrow(() => {
    assertStableFailure(
      promoteProposalToModelQueue(invalidKindWithDigestTrap, validConfirmation),
      'invalid-proposal-kind',
    );
  });
}

{
  let confirmationReads = 0;
  const hostileConfirmation = new Proxy({}, {
    get() {
      confirmationReads += 1;
      throw new Error('confirmation must not be inspected for invalid proposal');
    },
  });
  assert.doesNotThrow(() => {
    assertStableFailure(promoteProposalToModelQueue(undefined, hostileConfirmation), 'proposal-not-object');
  });
  assert.equal(confirmationReads, 0);
}

{
  const hostileConfirmation = {};
  Object.defineProperty(hostileConfirmation, 'confirm', {
    enumerable: true,
    get() {
      throw new Error('hostile confirmation getter');
    },
  });
  hostileConfirmation.confirmedBy = 'human-review';
  hostileConfirmation.proposalDigest = validProposalDigest;
  assert.doesNotThrow(() => {
    assertStableFailure(promoteProposalToModelQueue(proposal, hostileConfirmation), 'confirmation-read-failed');
  });
}

for (const [name, value, reason] of [
  ['bigint', 1n, 'bigint'],
  ['nan', Number.NaN, 'non-finite-number'],
  ['positive-infinity', Number.POSITIVE_INFINITY, 'non-finite-number'],
  ['negative-infinity', Number.NEGATIVE_INFINITY, 'non-finite-number'],
  ['negative-zero', -0, 'negative-zero'],
  ['date', new Date('2026-07-18T00:00:00Z'), 'non-plain-object'],
  ['map', new Map([['key', 'value']]), 'non-plain-object'],
  ['set', new Set(['value']), 'non-plain-object'],
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
  class CustomValue {
    constructor() {
      this.value = 'custom';
    }
  }
  assertStableFailure(promoteProposalToModelQueue(withPayload(new CustomValue()), validConfirmation), 'proposal-data-invalid');
}

{
  const sparse = [];
  sparse.length = 2;
  sparse[1] = 'present';
  assertStableFailure(promoteProposalToModelQueue(withPayload(sparse), validConfirmation), 'proposal-data-invalid');
}

{
  const cycle = {};
  cycle.self = cycle;
  assert.doesNotThrow(() => {
    assertStableFailure(promoteProposalToModelQueue(withPayload(cycle), validConfirmation), 'proposal-data-invalid');
  });
}

{
  const deeplyNested = {};
  let cursor = deeplyNested;
  for (let index = 0; index < 20_000; index += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  assert.doesNotThrow(() => {
    assertStableFailure(
      promoteProposalToModelQueue(withPayload(deeplyNested), validConfirmation),
      'proposal-data-invalid',
    );
  });
}

{
  const payload = { safe: true };
  payload[Symbol('hidden')] = 'symbol-key-value';
  const invalid = {
    ...proposal,
    proposedOperation: { ...proposal.proposedOperation, payload },
  };
  assertStableFailure(promoteProposalToModelQueue(invalid, validConfirmation), 'proposal-data-invalid');
}

{
  const nullProposal = {
    ...proposal,
    proposedOperation: {
      ...proposal.proposedOperation,
      payload: { ...proposal.proposedOperation.payload, actualNull: null },
    },
  };
  const nullDigest = proposalDigest(nullProposal);
  const result = promoteProposalToModelQueue(nullProposal, {
    confirm: true,
    confirmedBy: 'human-review',
    proposalDigest: nullDigest,
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.queueRow.payload.actualNull, null);
}

{
  const reentrant = structuredClone(proposal);
  let reads = 0;
  Object.defineProperty(reentrant, 'validationProbe', {
    enumerable: true,
    get() {
      reads += 1;
      reentrant.evidence = [];
      return 'mutated-during-validation';
    },
  });

  assert.doesNotThrow(() => {
    assertStableFailure(
      promoteProposalToModelQueue(reentrant, validConfirmation),
      'evidence-missing',
    );
  });
  assert.equal(reads, 2, 'proposal getter is read by initial validation and structuredClone only');
}

for (const [name, mutatedProposal] of [
  ['evidence', {
    ...proposal,
    evidence: [{ ...proposal.evidence[0], value: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' }],
  }],
  ['acceptanceCriteria', {
    ...proposal,
    acceptanceCriteria: [...proposal.acceptanceCriteria, 'promotion must preserve reviewed acceptance criteria'],
  }],
  ['targetRef', { ...proposal, targetRef: { ...proposal.targetRef, id: 'pkg:changed' } }],
  ['operation', { ...proposal, proposedOperation: { ...proposal.proposedOperation, op: 'removeEdge' } }],
  ['payload', {
    ...proposal,
    proposedOperation: {
      ...proposal.proposedOperation,
      payload: { ...proposal.proposedOperation.payload, type: 'dependsOn' },
    },
  }],
  ['extra-field', { ...proposal, reviewContext: { ticket: 'changed-after-confirmation' } }],
]) {
  assert.notEqual(proposalDigest(mutatedProposal), validProposalDigest, name);
  assertStableFailure(
    promoteProposalToModelQueue(mutatedProposal, validConfirmation),
    'proposal-digest-mismatch',
  );
}

{
  const expectedDigest = proposalDigest({ ...proposal, digestProbe: 'one-digest' });
  let reads = 0;
  const countedProposal = { ...proposal };
  Object.defineProperty(countedProposal, 'digestProbe', {
    enumerable: true,
    get() {
      reads += 1;
      return 'one-digest';
    },
  });

  const result = promoteProposalToModelQueue(countedProposal, {
    confirm: true,
    confirmedBy: 'human-review',
    proposalDigest: expectedDigest,
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(reads, 2, 'proposal must be read once by validation and once by structuredClone');
  assert.equal(result.queueRow.proposalDigest, expectedDigest);
  assert.equal(result.promotionReceipt.proposalDigest, expectedDigest);
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
    assert.equal(clones, 1, 'promotion must take exactly one structuredClone snapshot');
  } finally {
    globalThis.structuredClone = originalStructuredClone;
  }
}

{
  const originalStructuredClone = globalThis.structuredClone;
  globalThis.structuredClone = () => {
    throw new Error('forced clone failure');
  };
  try {
    assertStableFailure(
      promoteProposalToModelQueue(proposal, validConfirmation),
      'proposal-snapshot-failed',
    );
  } finally {
    globalThis.structuredClone = originalStructuredClone;
  }
}

{
  const originalStringify = JSON.stringify;
  JSON.stringify = () => {
    throw new Error('forced digest failure');
  };
  let result;
  try {
    result = promoteProposalToModelQueue(proposal, validConfirmation);
  } finally {
    JSON.stringify = originalStringify;
  }
  assertStableFailure(result, 'proposal-digest-failed');
}

console.log('hq human promotion gate check: PASS');
