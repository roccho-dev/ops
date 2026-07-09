#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  proposalDigest,
  proposalToQueueIntentCandidate,
  validateModelingProposal,
} from '../lib/modeling-proposal.mjs';
import { validateRecord } from '../lib/queue-validator.mjs';

const proposal = {
  kind: 'modeling.proposal.v1',
  id: 'proposal_001',
  sourceAgentTaskId: 'aq_agent_001',
  targetRef: { kind: 'repoMap.node', id: 'pkg:core' },
  proposedOperation: {
    op: 'addEdge',
    payload: { from: 'pkg:core', to: 'pkg:ui', type: 'uses' },
  },
  evidence: [
    { kind: 'digest', value: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
  ],
  acceptanceCriteria: ['human may promote into model queue only after review'],
  status: 'proposed',
};

function codes(errors) {
  return errors.map((error) => error.code);
}

{
  const errors = validateModelingProposal(proposal);
  assert.deepEqual(errors, []);
  assert.match(proposalDigest(proposal), /^sha256:/);
}

{
  const missingEvidence = { ...proposal, evidence: [] };
  const errors = validateModelingProposal(missingEvidence);
  assert.ok(codes(errors).includes('evidence-missing'));
}

{
  const missingTarget = { ...proposal, targetRef: { kind: 'repoMap.node' } };
  const errors = validateModelingProposal(missingTarget);
  assert.ok(codes(errors).includes('targetRef-missing-id'));
}

{
  const missingOp = { ...proposal, proposedOperation: { payload: {} } };
  const errors = validateModelingProposal(missingOp);
  assert.ok(codes(errors).includes('proposal-op-missing'));
}

{
  const authority = { ...proposal, acceptedLedger: true };
  const errors = validateModelingProposal(authority);
  assert.ok(codes(errors).includes('authority-field-present'));
}

{
  const embedded = { ...proposal, acceptedRow: { kind: 'accepted.modelCommit.v1' } };
  const errors = validateModelingProposal(embedded);
  assert.ok(codes(errors).includes('embedded-authority-shape'));
}

{
  const candidate = proposalToQueueIntentCandidate(proposal, { confirmedBy: 'human-review' });
  assert.equal(candidate.kind, 'hq.modelCommitQueued.v1');
  assert.equal(candidate.id, 'mq_from_proposal_001');
  assert.equal(candidate.confirmedBy, 'human-review');
  assert.equal(candidate.targetRef.id, proposal.targetRef.id);
  assert.equal(candidate.op, proposal.proposedOperation.op);
  assert.match(candidate.proposalDigest, /^sha256:/);
  const errors = validateRecord(candidate);
  assert.deepEqual(errors, []);
}

console.log('hq modeling proposal schema check: PASS');
