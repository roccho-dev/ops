import { sha256Digest } from './digest.mjs';
import { forbiddenAuthorityFields } from './queue-schema.mjs';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function add(errors, code, message, extra = {}) {
  errors.push({ code, message, ...extra });
}

function findForbiddenAuthorityFields(value, path = []) {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => findForbiddenAuthorityFields(entry, [...path, String(index)]));
  }
  if (!isPlainObject(value)) return [];

  const found = [];
  for (const [key, nested] of Object.entries(value)) {
    if (forbiddenAuthorityFields.includes(key)) {
      found.push([...path, key].join('.'));
    }
    found.push(...findForbiddenAuthorityFields(nested, [...path, key]));
  }
  return found;
}

export function validateModelingProposal(record, { line = 1 } = {}) {
  const errors = [];

  if (!isPlainObject(record)) {
    add(errors, 'proposal-not-object', 'proposal must be an object', { line });
    return errors;
  }

  if (record.kind !== 'modeling.proposal.v1') {
    add(errors, 'invalid-proposal-kind', `proposal kind must be modeling.proposal.v1, got ${record.kind}`, { line, kind: record.kind });
    return errors;
  }

  for (const field of ['id', 'sourceAgentTaskId', 'targetRef', 'proposedOperation', 'evidence', 'acceptanceCriteria', 'status']) {
    if (!(field in record)) {
      add(errors, 'missing-required-field', `missing required field: ${field}`, { line, field });
    }
  }

  if (!isNonEmptyString(record.id)) add(errors, 'invalid-id', 'id must be a non-empty string', { line });
  if (!isNonEmptyString(record.sourceAgentTaskId)) add(errors, 'invalid-sourceAgentTaskId', 'sourceAgentTaskId must be a non-empty string', { line, id: record.id });

  if (!isPlainObject(record.targetRef)) {
    add(errors, 'targetRef-not-object', 'targetRef must be an object', { line, id: record.id });
  } else {
    if (!isNonEmptyString(record.targetRef.kind)) add(errors, 'targetRef-missing-kind', 'targetRef.kind must be a non-empty string', { line, id: record.id });
    if (!isNonEmptyString(record.targetRef.id)) add(errors, 'targetRef-missing-id', 'targetRef.id must be a non-empty string', { line, id: record.id });
  }

  if (!isPlainObject(record.proposedOperation)) {
    add(errors, 'proposedOperation-not-object', 'proposedOperation must be an object', { line, id: record.id });
  } else {
    if (!isNonEmptyString(record.proposedOperation.op)) add(errors, 'proposal-op-missing', 'proposedOperation.op must be a non-empty string', { line, id: record.id });
    if (!isPlainObject(record.proposedOperation.payload)) add(errors, 'proposal-payload-not-object', 'proposedOperation.payload must be an object', { line, id: record.id });
  }

  if (!Array.isArray(record.evidence) || record.evidence.length === 0) {
    add(errors, 'evidence-missing', 'evidence must be a non-empty array', { line, id: record.id });
  }
  if (!Array.isArray(record.acceptanceCriteria) || record.acceptanceCriteria.length === 0) {
    add(errors, 'acceptanceCriteria-missing', 'acceptanceCriteria must be a non-empty array', { line, id: record.id });
  }

  if (!['proposed', 'rejected', 'promoted'].includes(record.status)) {
    add(errors, 'invalid-proposal-status', 'status must be proposed, rejected, or promoted', { line, id: record.id, status: record.status });
  }

  for (const fieldPath of findForbiddenAuthorityFields(record)) {
    add(errors, 'authority-field-present', `authority field is prohibited: ${fieldPath}`, { line, id: record.id, fieldPath });
  }

  if ('modelQueueRow' in record || 'acceptedRow' in record) {
    add(errors, 'embedded-authority-shape', 'proposal must not embed modelQueueRow or acceptedRow', { line, id: record.id });
  }

  return errors;
}

export function proposalDigest(record) {
  return sha256Digest(record);
}
