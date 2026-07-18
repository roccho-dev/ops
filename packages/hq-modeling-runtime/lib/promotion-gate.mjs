import {
  proposalDigest,
  validateModelingProposal,
} from './modeling-proposal.mjs';
import { validateRecord } from './queue-validator.mjs';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function add(errors, code, message, extra = {}) {
  errors.push({ code, message, ...extra });
}

function proposalToQueueIntentCandidate(proposal, { confirmedBy, proposalDigest: digest }) {
  return {
    kind: 'hq.modelCommitQueued.v1',
    id: `mq_from_${proposal.id}`,
    status: 'queued',
    targetRef: proposal.targetRef,
    op: proposal.proposedOperation.op,
    payload: proposal.proposedOperation.payload,
    reason: `promoted proposal ${proposal.id}`,
    confirmedBy,
    proposalDigest: digest,
  };
}

export function promoteProposalToModelQueue(proposal, confirmation) {
  const proposalErrors = validateModelingProposal(proposal);
  if (proposalErrors.length > 0) return { ok: false, errors: proposalErrors, queueRow: null };

  const digest = proposalDigest(proposal);
  const errors = [];

  if (!isPlainObject(confirmation)) {
    add(errors, 'confirmation-missing', 'human confirmation object is required');
  } else {
    if (confirmation.confirm !== true) add(errors, 'confirmation-not-true', 'confirmation.confirm must be true');
    if (typeof confirmation.confirmedBy !== 'string' || confirmation.confirmedBy.trim().length === 0) {
      add(errors, 'confirmedBy-missing', 'confirmation.confirmedBy must be a non-empty string');
    }
    if (confirmation.proposalDigest !== digest) {
      add(errors, 'proposal-digest-mismatch', 'confirmation.proposalDigest must match proposal digest');
    }
  }

  if (proposal.status !== 'proposed') {
    add(errors, 'proposal-not-promotable', 'only status=proposed can be promoted', { status: proposal.status });
  }

  if (errors.length > 0) return { ok: false, errors, queueRow: null };

  const queueRow = proposalToQueueIntentCandidate(proposal, {
    confirmedBy: confirmation.confirmedBy,
    proposalDigest: digest,
  });
  const queueErrors = validateRecord(queueRow);
  if (queueErrors.length > 0) return { ok: false, errors: queueErrors, queueRow: null };

  return {
    ok: true,
    errors: [],
    queueRow,
    promotionReceipt: {
      kind: 'proposal.promotionReceipt.v1',
      proposalId: proposal.id,
      proposalDigest: digest,
      queueId: queueRow.id,
      confirmedBy: confirmation.confirmedBy,
      evidenceOnly: true,
      nonAuthority: true,
    },
  };
}
