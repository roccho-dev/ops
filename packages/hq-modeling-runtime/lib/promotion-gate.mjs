import {
  proposalDigest,
  validateModelingProposal,
} from './modeling-proposal.mjs';
import { validateRecord } from './queue-validator.mjs';

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function add(errors, code, message, extra = {}) {
  errors.push({ code, message, ...extra });
}

function failure(errors) {
  return { ok: false, errors, queueRow: null };
}

function readConfirmationField(confirmation, field, errors) {
  try {
    return { ok: true, value: confirmation[field] };
  } catch {
    add(errors, 'confirmation-read-failed', `confirmation.${field} could not be read`, { field });
    return { ok: false, value: undefined };
  }
}

function proposalToQueueIntentCandidate(proposal, { confirmedBy, proposalDigest: digest }) {
  return {
    kind: 'hq.modelCommitQueued.v1',
    id: `mq_from_${proposal.id}`,
    status: 'queued',
    targetRef: proposal.targetRef,
    op: proposal.proposedOperation.op,
    payload: proposal.proposedOperation.payload,
    evidence: proposal.evidence,
    reason: `promoted proposal ${proposal.id}`,
    confirmedBy,
    proposalDigest: digest,
  };
}

export function promoteProposalToModelQueue(proposal, confirmation) {
  const proposalErrors = validateModelingProposal(proposal);
  if (proposalErrors.length > 0) return failure(proposalErrors);

  let proposalSnapshot;
  try {
    proposalSnapshot = structuredClone(proposal);
  } catch {
    const errors = [];
    add(errors, 'proposal-snapshot-failed', 'proposal must be structured-cloneable for promotion');
    return failure(errors);
  }

  const snapshotErrors = validateModelingProposal(proposalSnapshot);
  if (snapshotErrors.length > 0) return failure(snapshotErrors);

  let digest;
  try {
    digest = proposalDigest(proposalSnapshot);
  } catch {
    const errors = [];
    add(errors, 'proposal-digest-failed', 'validated proposal snapshot could not be digested');
    return failure(errors);
  }

  const errors = [];
  let confirm;
  let confirmedBy;
  let confirmedDigest;

  if (!isPlainObject(confirmation)) {
    add(errors, 'confirmation-missing', 'human confirmation object is required');
  } else {
    const confirmField = readConfirmationField(confirmation, 'confirm', errors);
    const confirmedByField = readConfirmationField(confirmation, 'confirmedBy', errors);
    const digestField = readConfirmationField(confirmation, 'proposalDigest', errors);
    confirm = confirmField.value;
    confirmedBy = confirmedByField.value;
    confirmedDigest = digestField.value;

    if (confirmField.ok && confirm !== true) {
      add(errors, 'confirmation-not-true', 'confirmation.confirm must be true');
    }
    if (confirmedByField.ok && (typeof confirmedBy !== 'string' || confirmedBy.trim().length === 0)) {
      add(errors, 'confirmedBy-missing', 'confirmation.confirmedBy must be a non-empty string');
    }
    if (digestField.ok && confirmedDigest !== digest) {
      add(errors, 'proposal-digest-mismatch', 'confirmation.proposalDigest must match proposal digest');
    }
  }

  if (proposalSnapshot.status !== 'proposed') {
    add(errors, 'proposal-not-promotable', 'only status=proposed can be promoted', { status: proposalSnapshot.status });
  }

  if (errors.length > 0) return failure(errors);

  const queueRow = proposalToQueueIntentCandidate(proposalSnapshot, {
    confirmedBy,
    proposalDigest: digest,
  });
  const queueErrors = validateRecord(queueRow);
  if (queueErrors.length > 0) return failure(queueErrors);

  return {
    ok: true,
    errors: [],
    queueRow,
    promotionReceipt: {
      kind: 'proposal.promotionReceipt.v1',
      proposalId: proposalSnapshot.id,
      proposalDigest: digest,
      queueId: queueRow.id,
      confirmedBy,
      evidenceOnly: true,
      nonAuthority: true,
    },
  };
}
