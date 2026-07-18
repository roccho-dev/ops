#!/usr/bin/env node
import assert from 'node:assert/strict';

import { proposalDigest } from '../lib/modeling-proposal.mjs';
import { promoteProposalToModelQueue } from '../lib/promotion-gate.mjs';
import { validateRecord } from '../lib/queue-validator.mjs';

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

function codes(result) { return result.errors.map((error) => error.code); }

{
  const result = promoteProposalToModelQueue(proposal, { confirm: true, confirmedBy: 'human-review', proposalDigest: proposalDigest(proposal) });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.queueRow.kind, 'hq.modelCommitQueued.v1');
  assert.equal(result.queueRow.id, 'mq_from_proposal_001');
  assert.equal(result.queueRow.confirmedBy, 'human-review');
  assert.equal(result.queueRow.targetRef.id, proposal.targetRef.id);
  assert.match(result.queueRow.proposalDigest, /^sha256:/);
  assert.equal(result.promotionReceipt.kind, 'proposal.promotionReceipt.v1');
  assert.equal(result.promotionReceipt.evidenceOnly, true);
  assert.equal(result.promotionReceipt.nonAuthority, true);
  assert.ok(!('accepted' in result.promotionReceipt));
  assert.deepEqual(validateRecord(result.queueRow), []);
}

{
  const result = promoteProposalToModelQueue(proposal, { confirm: false, confirmedBy: 'human-review', proposalDigest: proposalDigest(proposal) });
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('confirmation-not-true'));
  assert.equal(result.queueRow, null);
}

{
  const result = promoteProposalToModelQueue(proposal, { confirm: true, confirmedBy: 'human-review', proposalDigest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' });
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('proposal-digest-mismatch'));
}

{
  const promoted = { ...proposal, status: 'promoted' };
  const result = promoteProposalToModelQueue(promoted, { confirm: true, confirmedBy: 'human-review', proposalDigest: proposalDigest(promoted) });
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('proposal-not-promotable'));
}

{
  const authority = { ...proposal, acceptedLedger: true };
  const result = promoteProposalToModelQueue(authority, { confirm: true, confirmedBy: 'human-review', proposalDigest: proposalDigest(authority) });
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('authority-field-present'));
}

console.log('hq human promotion gate check: PASS');
