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
      metadata: { reviewed: true, risk: 'bounded' },
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

const validProposalDigest = proposalDigest(proposal);
const validConfirmation = { confirm: true, confirmedBy: 'human-review', proposalDigest: validProposalDigest };
assert.match(validProposalDigest, /^sha256:/);

{
  const promotedProposal = structuredClone(proposal);
  const result = promoteProposalToModelQueue(promotedProposal, validConfirmation);
  const expectedQueueRow = {
    kind: 'hq.modelCommitQueued.v1',
    id: 'mq_from_proposal_001',
    status: 'queued',
    targetRef: structuredClone(proposal.targetRef),
    op: 'addEdge',
    payload: structuredClone(proposal.proposedOperation.payload),
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
  assert.notStrictEqual(result.queueRow.targetRef, promotedProposal.targetRef);
  assert.notStrictEqual(result.queueRow.targetRef.coordinates, promotedProposal.targetRef.coordinates);
  assert.notStrictEqual(result.queueRow.targetRef.path, promotedProposal.targetRef.path);
  assert.notStrictEqual(result.queueRow.payload, promotedProposal.proposedOperation.payload);
  assert.notStrictEqual(result.queueRow.payload.metadata, promotedProposal.proposedOperation.payload.metadata);
  assert.notStrictEqual(result.queueRow.payload.steps, promotedProposal.proposedOperation.payload.steps);
  assert.notStrictEqual(result.queueRow.payload.steps[1], promotedProposal.proposedOperation.payload.steps[1]);
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
  const hostileConfirmation = new Proxy({}, {
    get() {
      throw new Error('confirmation must not be inspected for invalid proposal');
    },
  });
  assert.doesNotThrow(() => {
    assertStableFailure(promoteProposalToModelQueue(undefined, hostileConfirmation), 'proposal-not-object');
  });
}

{
  const uncloneable = structuredClone(proposal);
  uncloneable.proposedOperation.payload.uncloneable = () => {};
  const uncloneableConfirmation = {
    confirm: true,
    confirmedBy: 'human-review',
    proposalDigest: proposalDigest(uncloneable),
  };
  assert.doesNotThrow(() => {
    assertStableFailure(
      promoteProposalToModelQueue(uncloneable, uncloneableConfirmation),
      'proposal-snapshot-failed',
    );
  });
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

console.log('hq human promotion gate check: PASS');
