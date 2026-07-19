import { types } from 'node:util';

import { sha256Digest } from './digest.mjs';
import {
  proposalDigest,
  snapshotModelingProposal,
} from './modeling-proposal.mjs';
import {
  buildProposalPromotionOrigin,
  validateProposalPromotionRecord,
} from './queue-validator.mjs';

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  if (types.isProxy(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function add(errors, code, message, extra = {}) {
  errors.push({ code, message, ...extra });
}

function failure(errors) {
  return { ok: false, errors, queueRow: null };
}

const confirmationFields = Object.freeze([
  ['confirm', 'boolean'],
  ['confirmedBy', 'string'],
  ['proposalDigest', 'string'],
]);

function snapshotConfirmation(confirmation, errors) {
  if (!isPlainObject(confirmation)) {
    add(errors, types.isProxy(confirmation) ? 'confirmation-proxy-rejected' : 'confirmation-missing', 'plain human confirmation object is required');
    return null;
  }

  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(confirmation);
  } catch {
    add(errors, 'confirmation-snapshot-failed', 'human confirmation descriptors could not be snapshotted');
    return null;
  }

  const snapshot = Object.create(null);
  for (const [field, expectedType] of confirmationFields) {
    const descriptor = Object.hasOwn(descriptors, field) ? descriptors[field] : null;
    if (!descriptor) {
      add(errors, 'confirmation-field-not-own', `confirmation.${field} must be an own property`, { field });
      continue;
    }
    if (descriptor.enumerable !== true) {
      add(errors, 'confirmation-field-not-enumerable', `confirmation.${field} must be enumerable`, { field });
      continue;
    }
    if (!Object.hasOwn(descriptor, 'value')) {
      add(errors, 'confirmation-field-not-data', `confirmation.${field} must be a data property`, { field });
      continue;
    }
    if (typeof descriptor.value !== expectedType) {
      add(errors, 'confirmation-field-type-invalid', `confirmation.${field} must be a primitive ${expectedType}`, {
        field,
        expectedType,
        actualType: typeof descriptor.value,
      });
      continue;
    }
    snapshot[field] = descriptor.value;
  }
  return snapshot;
}

function proposalToQueueIntentCandidate(proposal, confirmation, digest) {
  const row = {
    kind: 'hq.modelCommitQueued.v1',
    id: `mq_from_${proposal.id}`,
    status: 'queued',
    targetRef: proposal.targetRef,
    op: proposal.proposedOperation.op,
    payload: proposal.proposedOperation.payload,
    evidence: proposal.evidence,
    reason: `promoted proposal ${proposal.id}`,
    confirmedBy: confirmation.confirmedBy,
    proposalDigest: digest,
  };
  row.origin = buildProposalPromotionOrigin(row, {
    proposalId: proposal.id,
    proposalDigest: digest,
    confirmationDigest: sha256Digest({
      kind: 'proposal.promotionConfirmation.v1',
      confirm: confirmation.confirm,
      confirmedBy: confirmation.confirmedBy,
      proposalDigest: confirmation.proposalDigest,
    }),
    confirmedBy: confirmation.confirmedBy,
  });
  return row;
}

export function promoteProposalToModelQueue(proposal, confirmation) {
  const proposalResult = snapshotModelingProposal(proposal);
  if (proposalResult.errors.length > 0) return failure(proposalResult.errors);
  const proposalSnapshot = proposalResult.snapshot;

  let digest;
  try {
    digest = proposalDigest(proposalSnapshot);
  } catch {
    const errors = [];
    add(errors, 'proposal-digest-failed', 'validated proposal snapshot could not be digested');
    return failure(errors);
  }

  const errors = [];
  const confirmationSnapshot = snapshotConfirmation(confirmation, errors);
  if (confirmationSnapshot) {
    if (confirmationSnapshot.confirm !== true) {
      add(errors, 'confirmation-not-true', 'confirmation.confirm must be true');
    }
    if (!isNonEmptyString(confirmationSnapshot.confirmedBy)) {
      add(errors, 'confirmedBy-missing', 'confirmation.confirmedBy must be a non-empty string');
    }
    if (confirmationSnapshot.proposalDigest !== digest) {
      add(errors, 'proposal-digest-mismatch', 'confirmation.proposalDigest must match proposal digest');
    }
  }

  if (proposalSnapshot.status !== 'proposed') {
    add(errors, 'proposal-not-promotable', 'only status=proposed can be promoted', { status: proposalSnapshot.status });
  }
  if (errors.length > 0) return failure(errors);

  const queueRow = proposalToQueueIntentCandidate(proposalSnapshot, confirmationSnapshot, digest);
  const queueErrors = validateProposalPromotionRecord(queueRow, {
    expectedOrigin: queueRow.origin,
  });
  if (queueErrors.length > 0) return failure(queueErrors);

  return {
    ok: true,
    errors: [],
    queueRow,
    promotionReceipt: {
      kind: 'proposal.promotionReceipt.v1',
      id: queueRow.origin.promotionEvidenceId,
      proposalId: proposalSnapshot.id,
      proposalDigest: digest,
      queueId: queueRow.id,
      queueIntegrityDigest: queueRow.origin.integrityDigest,
      confirmationDigest: queueRow.origin.confirmationDigest,
      confirmedBy: confirmationSnapshot.confirmedBy,
      evidenceDigest: queueRow.origin.evidenceDigest,
      promotionEvidenceId: queueRow.origin.promotionEvidenceId,
      evidenceOnly: true,
      nonAuthority: true,
    },
  };
}
