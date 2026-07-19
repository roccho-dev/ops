import { types } from 'node:util';

import { sha256Digest } from './digest.mjs';
import {
  findAuthorityBearingShapes,
  snapshotJsonData,
} from './queue-schema.mjs';

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)) return false;
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

function pointer(path) {
  if (path.length === 0) return '/';
  return `/${path
    .map((segment) => String(segment).replaceAll('~', '~0').replaceAll('/', '~1'))
    .join('/')}`;
}

function addSnapshotErrors(errors, snapshotErrors, line) {
  for (const error of snapshotErrors) {
    add(
      errors,
      'proposal-data-invalid',
      `proposal data is not JSON-compatible at ${error.path}: ${error.reason}`,
      {
        line,
        path: error.path,
        reason: error.reason,
        detail: error.detail,
        symbol: error.symbol,
      },
    );
  }
}

function addAuthorityShapeErrors(errors, record, line) {
  const findings = findAuthorityBearingShapes(record);
  const id = record.id;
  for (const finding of findings) {
    const code = finding.reason === 'forbidden-field'
      ? 'authority-field-present'
      : 'authority-shape-present';
    const segments = finding.segments ?? [];
    const fieldPath = segments.join('.');
    add(errors, code, `authority-bearing proposal shape is prohibited: ${fieldPath || '$'}`, {
      line,
      id,
      fieldPath,
      path: pointer(segments),
      reason: finding.reason,
      detail: finding.detail,
      concept: finding.concept,
      normalizedField: finding.normalizedField,
      normalizedValue: finding.normalizedValue,
    });
  }
}

function validateProposalSnapshot(record, { line = 1 } = {}) {
  const errors = [];
  addAuthorityShapeErrors(errors, record, line);
  const id = record.id;

  if (record.kind !== 'modeling.proposal.v1') {
    add(errors, 'invalid-proposal-kind', `proposal kind must be modeling.proposal.v1, got ${record.kind}`, {
      line,
      kind: record.kind,
    });
    return errors;
  }

  const required = ['id', 'sourceAgentTaskId', 'targetRef', 'proposedOperation', 'evidence', 'acceptanceCriteria', 'status'];
  for (const field of required) {
    if (!Object.hasOwn(record, field)) {
      add(errors, 'missing-required-field', `missing required field: ${field}`, { line, field });
    }
  }

  if (!isNonEmptyString(record.id)) add(errors, 'invalid-id', 'id must be a non-empty string', { line });
  if (!isNonEmptyString(record.sourceAgentTaskId)) {
    add(errors, 'invalid-sourceAgentTaskId', 'sourceAgentTaskId must be a non-empty string', { line, id });
  }

  if (!isPlainObject(record.targetRef)) {
    add(errors, 'targetRef-not-object', 'targetRef must be an object', { line, id });
  } else {
    if (!isNonEmptyString(record.targetRef.kind)) {
      add(errors, 'targetRef-missing-kind', 'targetRef.kind must be a non-empty string', { line, id });
    }
    if (!isNonEmptyString(record.targetRef.id)) {
      add(errors, 'targetRef-missing-id', 'targetRef.id must be a non-empty string', { line, id });
    }
  }

  if (!isPlainObject(record.proposedOperation)) {
    add(errors, 'proposedOperation-not-object', 'proposedOperation must be an object', { line, id });
  } else {
    if (!isNonEmptyString(record.proposedOperation.op)) {
      add(errors, 'proposal-op-missing', 'proposedOperation.op must be a non-empty string', { line, id });
    }
    if (!isPlainObject(record.proposedOperation.payload)) {
      add(errors, 'proposal-payload-not-object', 'proposedOperation.payload must be an object', { line, id });
    }
  }

  if (!Array.isArray(record.evidence) || record.evidence.length === 0) {
    add(errors, 'evidence-missing', 'evidence must be a non-empty array', { line, id });
  }
  if (!Array.isArray(record.acceptanceCriteria) || record.acceptanceCriteria.length === 0) {
    add(errors, 'acceptanceCriteria-missing', 'acceptanceCriteria must be a non-empty array', { line, id });
  }

  if (!['proposed', 'rejected', 'promoted'].includes(record.status)) {
    add(errors, 'invalid-proposal-status', 'status must be proposed, rejected, or promoted', {
      line,
      id,
      status: record.status,
    });
  }

  return errors;
}

export function snapshotModelingProposal(record, { line = 1 } = {}) {
  const errors = [];
  if (!isPlainObject(record)) {
    add(errors, 'proposal-not-object', 'proposal must be a plain non-Proxy object', { line });
    return { snapshot: null, errors };
  }

  const dataSnapshot = snapshotJsonData(record);
  if (!dataSnapshot.ok) {
    addSnapshotErrors(errors, dataSnapshot.errors, line);
    return { snapshot: null, errors };
  }

  errors.push(...validateProposalSnapshot(dataSnapshot.value, { line }));
  return { snapshot: dataSnapshot.value, errors };
}

export function validateModelingProposal(record, { line = 1 } = {}) {
  return snapshotModelingProposal(record, { line }).errors;
}

export function proposalDigest(record) {
  const snapshot = snapshotJsonData(record);
  if (!snapshot.ok) {
    const first = snapshot.errors[0];
    throw new TypeError(`proposal data is not digestible at ${first?.path ?? '/'}: ${first?.reason ?? 'invalid-data'}`);
  }
  return sha256Digest(snapshot.value);
}
