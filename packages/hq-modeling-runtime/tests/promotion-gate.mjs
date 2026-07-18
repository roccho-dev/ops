#!/usr/bin/env node
import assert from 'node:assert/strict';

import * as modelingProposal from '../lib/modeling-proposal.mjs';
import { promoteProposalToModelQueue } from '../lib/promotion-gate.mjs';
import { validateRecord } from '../lib/queue-validator.mjs';

const { proposalDigest } = modelingProposal;

assert.deepEqual(
  Object.keys(modelingProposal).sort(),
  ['proposalDigest', 'validateModelingProposal'],
);
assert.equal('proposalToQueueIntentCandidate' in modelingProposal, false);

const proposal = {
  kind: 'modeling.proposal.v1',
  id: 'proposal_001',
  sourceAgentTaskId: 'aq_agent_001',
  targetRef: { kind: 'repoMap.node', id: 'pkg:core' },
  proposedOperation: { op: 'addEdge', payload: { from: 'pkg:core', to: 'pkg:ui', type: 'uses' } },
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
  const result = promoteProposalToModelQueue(proposal, validConfirmation);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.queueRow.kind, 'hq.modelCommitQueued.v1');
  assert.equal(result.queueRow.id, 'mq_from_proposal_001');
  assert.equal(result.queueRow.confirmedBy, 'human-review');
  assert.equal(result.queueRow.targetRef.id, proposal.targetRef.id);
  assert.equal(result.queueRow.op, proposal.proposedOperation.op);
  assert.equal(result.queueRow.payload, proposal.proposedOperation.payload);
  assert.equal(result.queueRow.proposalDigest, validProposalDigest);
  assert.equal(result.promotionReceipt.kind, 'proposal.promotionReceipt.v1');
  assert.equal(result.promotionReceipt.proposalDigest, validProposalDigest);
  assert.equal(result.promotionReceipt.evidenceOnly, true);
  assert.equal(result.promotionReceipt.nonAuthority, true);
  assert.ok(!('accepted' in result.promotionReceipt));
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
  assert.equal(reads, 2, 'proposal must be read once by validation and once by its single digest computation');
  assert.equal(result.queueRow.proposalDigest, expectedDigest);
  assert.equal(result.promotionReceipt.proposalDigest, expectedDigest);
}

console.log('hq human promotion gate check: PASS');
