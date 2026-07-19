import { types } from 'node:util';

import { sha256Digest } from './digest.mjs';
import {
  findAuthorityBearingShapes,
  forbiddenEmbeddedRowKindPrefixes,
  forbiddenEmbeddedRowKinds,
  modelQueueOriginKinds,
  queueKinds,
  schemaByKind,
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

function isCanonicalDigest(value) {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
}

function add(errors, code, message, extra = {}) {
  errors.push({ code, message, ...extra });
}

function addSnapshotErrors(errors, snapshotErrors, line) {
  for (const error of snapshotErrors) {
    add(errors, 'record-data-invalid', `queue row is not complete JSON data at ${error.path}: ${error.reason}`, {
      line,
      path: error.path,
      reason: error.reason,
      detail: error.detail,
      symbol: error.symbol,
    });
  }
}

function isForbiddenEmbeddedKind(kind) {
  if (typeof kind !== 'string') return false;
  const normalized = kind.toLowerCase();
  return forbiddenEmbeddedRowKinds.some((entry) => entry.toLowerCase() === normalized)
    || forbiddenEmbeddedRowKindPrefixes.some((prefix) => normalized.startsWith(prefix.toLowerCase()));
}

function findForbiddenEmbeddedRows(value, initialPath = ['payload']) {
  const found = [];
  const stack = [{ node: value, path: initialPath }];
  while (stack.length > 0) {
    const { node, path } = stack.pop();
    if (node === null || typeof node !== 'object') continue;
    if (!Array.isArray(node) && !isPlainObject(node)) continue;

    if (!Array.isArray(node) && isForbiddenEmbeddedKind(node.kind)) {
      found.push({ path: [...path, 'kind'].join('.'), kind: node.kind, reason: 'forbidden-kind' });
    }
    if (!Array.isArray(node) && typeof node.kind === 'string'
      && node.kind.toLowerCase() === 'model_source_reconcile.v1') {
      found.push({ path: [...path, 'kind'].join('.'), kind: node.kind, reason: 'forbidden-kind' });
    }

    for (const [key, nested] of Object.entries(node)) {
      if (nested !== null && typeof nested === 'object') {
        stack.push({ node: nested, path: [...path, key] });
      }
    }
  }
  return found;
}

function validateTargetRef(record, errors, line) {
  if (!isPlainObject(record.targetRef)) {
    add(errors, 'targetRef-not-object', 'targetRef must be an object', { line, id: record.id });
    return;
  }
  if (!isNonEmptyString(record.targetRef.kind)) {
    add(errors, 'targetRef-missing-kind', 'targetRef.kind must be a non-empty string', { line, id: record.id });
  }
  if (!isNonEmptyString(record.targetRef.id)) {
    add(errors, 'targetRef-missing-id', 'targetRef.id must be a non-empty string', { line, id: record.id });
  }
}

function snapshotForDigest(record) {
  const snapshot = snapshotJsonData(record);
  if (!snapshot.ok) {
    const first = snapshot.errors[0];
    throw new TypeError(`queue row is not digestible at ${first?.path ?? '/'}: ${first?.reason ?? 'invalid-data'}`);
  }
  return snapshot.value;
}

function integrityMaterial(record) {
  const snapshot = snapshotForDigest(record);
  const origin = isPlainObject(snapshot.origin) ? { ...snapshot.origin } : snapshot.origin;
  if (isPlainObject(origin)) delete origin.integrityDigest;
  return { ...snapshot, origin };
}

export function modelQueueIntegrityDigest(record) {
  return sha256Digest(integrityMaterial(record));
}

export function proposalPromotionEvidenceId({ proposalId, proposalDigest, confirmationDigest, confirmedBy }) {
  return sha256Digest({
    kind: 'proposal.promotionEvidence.v1',
    proposalId,
    proposalDigest,
    confirmationDigest,
    confirmedBy,
  });
}

export function buildProposalPromotionOrigin(queueRow, {
  proposalId,
  proposalDigest,
  confirmationDigest,
  confirmedBy,
}) {
  const snapshot = snapshotForDigest(queueRow);
  const origin = {
    kind: 'proposal-promotion.v1',
    proposalId,
    proposalDigest,
    confirmationDigest,
    confirmedBy,
    evidenceDigest: sha256Digest(snapshot.evidence),
    promotionEvidenceId: proposalPromotionEvidenceId({ proposalId, proposalDigest, confirmationDigest, confirmedBy }),
  };
  return {
    ...origin,
    integrityDigest: modelQueueIntegrityDigest({ ...snapshot, origin }),
  };
}

const proposalOriginFields = Object.freeze([
  'kind',
  'proposalId',
  'proposalDigest',
  'confirmationDigest',
  'confirmedBy',
  'evidenceDigest',
  'promotionEvidenceId',
  'integrityDigest',
]);

function validateModelQueueOrigin(record, errors, line) {
  const origin = record.origin;
  if (!isPlainObject(origin)) {
    add(errors, 'model-origin-not-object', 'model queue origin must be a plain object', { line, id: record.id });
    return;
  }

  if (!modelQueueOriginKinds.includes(origin.kind)) {
    add(errors, 'invalid-model-origin-kind', `model queue origin.kind must be one of: ${modelQueueOriginKinds.join(', ')}`, {
      line,
      id: record.id,
      originKind: origin.kind,
    });
    return;
  }

  if (origin.kind === 'direct-human.v1') {
    for (const field of ['confirmationId', 'confirmedBy']) {
      if (!Object.hasOwn(origin, field) || !isNonEmptyString(origin[field])) {
        add(errors, 'direct-human-origin-field-invalid', `direct-human origin.${field} must be a non-empty own data field`, {
          line,
          id: record.id,
          field,
        });
      }
    }
    if (isNonEmptyString(origin.confirmedBy) && origin.confirmedBy !== record.confirmedBy) {
      add(errors, 'origin-confirmedBy-mismatch', 'origin.confirmedBy must match row.confirmedBy', { line, id: record.id });
    }
    return;
  }

  for (const field of proposalOriginFields.slice(1)) {
    if (!Object.hasOwn(origin, field) || !isNonEmptyString(origin[field])) {
      add(errors, 'proposal-origin-field-invalid', `proposal promotion origin.${field} must be a non-empty own data field`, {
        line,
        id: record.id,
        field,
      });
    }
  }

  for (const [field, code] of [
    ['proposalDigest', 'proposal-origin-digest-invalid'],
    ['confirmationDigest', 'proposal-origin-confirmation-digest-invalid'],
    ['evidenceDigest', 'proposal-origin-evidence-digest-invalid'],
    ['promotionEvidenceId', 'promotion-evidence-id-invalid'],
    ['integrityDigest', 'promotion-integrity-digest-invalid'],
  ]) {
    if (isNonEmptyString(origin[field]) && !isCanonicalDigest(origin[field])) {
      add(errors, code, `origin.${field} must be a canonical sha256 digest`, { line, id: record.id });
    }
  }

  if (!Object.hasOwn(record, 'proposalDigest') || record.proposalDigest !== origin.proposalDigest) {
    add(errors, 'proposal-origin-digest-mismatch', 'row.proposalDigest must match origin.proposalDigest', { line, id: record.id });
  }
  if (origin.confirmedBy !== record.confirmedBy) {
    add(errors, 'origin-confirmedBy-mismatch', 'origin.confirmedBy must match row.confirmedBy', { line, id: record.id });
  }
  if (isNonEmptyString(origin.proposalId) && record.id !== `mq_from_${origin.proposalId}`) {
    add(errors, 'proposal-origin-queue-id-mismatch', 'proposal-origin queue id must link to origin.proposalId', { line, id: record.id });
  }
  if (isNonEmptyString(origin.proposalId) && record.reason !== `promoted proposal ${origin.proposalId}`) {
    add(errors, 'proposal-origin-reason-mismatch', 'proposal-origin reason must link to origin.proposalId', { line, id: record.id });
  }

  if (!Array.isArray(record.evidence) || record.evidence.length === 0) {
    add(errors, 'proposal-origin-evidence-missing', 'proposal-origin row must preserve non-empty proposal evidence', { line, id: record.id });
  } else if (isCanonicalDigest(origin.evidenceDigest)) {
    const observedEvidenceDigest = sha256Digest(record.evidence);
    if (observedEvidenceDigest !== origin.evidenceDigest) {
      add(errors, 'proposal-origin-evidence-digest-mismatch', 'origin.evidenceDigest must match preserved proposal evidence', {
        line,
        id: record.id,
        expected: origin.evidenceDigest,
        observed: observedEvidenceDigest,
      });
    }
  }

  if (isCanonicalDigest(origin.promotionEvidenceId)) {
    const observedPromotionEvidenceId = proposalPromotionEvidenceId(origin);
    if (observedPromotionEvidenceId !== origin.promotionEvidenceId) {
      add(errors, 'promotion-evidence-id-mismatch', 'origin.promotionEvidenceId must link proposal and confirmation identities', {
        line,
        id: record.id,
        expected: origin.promotionEvidenceId,
        observed: observedPromotionEvidenceId,
      });
    }
  }

  if (isCanonicalDigest(origin.integrityDigest)) {
    const observed = modelQueueIntegrityDigest(record);
    if (observed !== origin.integrityDigest) {
      add(errors, 'promotion-integrity-mismatch', 'proposal-origin row integrity digest does not match row content', {
        line,
        id: record.id,
        expected: origin.integrityDigest,
        observed,
      });
    }
  }
}

function addAuthorityShapeErrors(errors, record, line) {
  for (const finding of findAuthorityBearingShapes(record)) {
    const code = finding.reason === 'forbidden-field' ? 'authority-field-present' : 'authority-shape-present';
    add(errors, code, `authority-bearing shape is prohibited: ${finding.path}`, {
      line,
      kind: record.kind,
      id: record.id,
      fieldPath: (finding.segments ?? []).join('.'),
      reason: finding.reason,
      detail: finding.detail,
      concept: finding.concept,
      normalizedField: finding.normalizedField,
      normalizedValue: finding.normalizedValue,
    });
  }
}

function validateRecordSnapshot(record, { line = 1 } = {}) {
  const errors = [];
  if (!isPlainObject(record)) {
    add(errors, 'record-not-object', 'row must be a plain non-Proxy JSON object', { line });
    return { snapshot: null, errors };
  }

  const dataSnapshot = snapshotJsonData(record);
  if (!dataSnapshot.ok) {
    addSnapshotErrors(errors, dataSnapshot.errors, line);
    return { snapshot: null, errors };
  }

  const snapshot = dataSnapshot.value;
  addAuthorityShapeErrors(errors, snapshot, line);

  if (!queueKinds.includes(snapshot.kind)) {
    add(errors, 'unknown-kind', `unsupported queue kind: ${snapshot.kind}`, {
      line,
      kind: snapshot.kind,
    });
    return { snapshot, errors };
  }

  const schema = schemaByKind[snapshot.kind];
  for (const field of schema.required) {
    if (!Object.hasOwn(snapshot, field)) {
      add(errors, 'missing-required-field', `missing required field: ${field}`, {
        line,
        kind: snapshot.kind,
        field,
      });
    }
  }

  if (!isNonEmptyString(snapshot.id)) {
    add(errors, 'invalid-id', 'id must be a non-empty string', { line, kind: snapshot.kind });
  }
  if (!schema.status.includes(snapshot.status)) {
    add(errors, 'invalid-status', `status must be one of: ${schema.status.join(', ')}`, {
      line,
      kind: snapshot.kind,
      status: snapshot.status,
    });
  }

  if (snapshot.kind === 'hq.modelCommitQueued.v1') {
    validateTargetRef(snapshot, errors, line);
    if (!isNonEmptyString(snapshot.op)) {
      add(errors, 'invalid-op', 'op must be a non-empty string', { line, id: snapshot.id });
    }
    if (!isPlainObject(snapshot.payload)) {
      add(errors, 'payload-not-object', 'payload must be an object', { line, id: snapshot.id });
    } else {
      for (const smuggled of findForbiddenEmbeddedRows(snapshot.payload)) {
        add(errors, 'payload-smuggled-row', `model payload must not embed source or reconcile rows: ${smuggled.path}`, {
          line,
          kind: snapshot.kind,
          id: snapshot.id,
          fieldPath: smuggled.path,
          embeddedKind: smuggled.kind,
          reason: smuggled.reason,
        });
      }
    }
    if (!isNonEmptyString(snapshot.confirmedBy)) {
      add(errors, 'invalid-confirmedBy', 'confirmedBy must be a non-empty string', { line, id: snapshot.id });
    }
    validateModelQueueOrigin(snapshot, errors, line);
  }

  if (snapshot.kind === 'hq.agentTaskQueued.v1') {
    validateTargetRef(snapshot, errors, line);
    if (!isNonEmptyString(snapshot.goal)) {
      add(errors, 'invalid-goal', 'goal must be a non-empty string', { line, id: snapshot.id });
    }
    if (!isNonEmptyString(snapshot.confirmedBy)) {
      add(errors, 'invalid-confirmedBy', 'confirmedBy must be a non-empty string', { line, id: snapshot.id });
    }
    if (Object.hasOwn(snapshot, 'context') && !Array.isArray(snapshot.context)) {
      add(errors, 'context-not-array', 'context must be an array when present', { line, id: snapshot.id });
    }
    if (Object.hasOwn(snapshot, 'acceptance') && !Array.isArray(snapshot.acceptance)) {
      add(errors, 'acceptance-not-array', 'acceptance must be an array when present', { line, id: snapshot.id });
    }
  }

  if (snapshot.kind === 'hq.receipt.v1') {
    if (!isNonEmptyString(snapshot.queueId)) {
      add(errors, 'invalid-queueId', 'queueId must be a non-empty string', { line, id: snapshot.id });
    }
    if (Object.hasOwn(snapshot, 'queueDigest') && !isNonEmptyString(snapshot.queueDigest)) {
      add(errors, 'invalid-queueDigest', 'queueDigest must be a non-empty string when present', { line, id: snapshot.id });
    }
  }

  return { snapshot, errors };
}

export function validateRecord(record, { line = 1 } = {}) {
  return validateRecordSnapshot(record, { line }).errors;
}

function snapshotExpectedOrigin(expectedOrigin, errors, line, id) {
  if (expectedOrigin === undefined) {
    add(errors, 'expected-proposal-origin-required', 'proposal-promotion validation requires an expected origin from the trusted promotion boundary', {
      line,
      id,
    });
    return null;
  }
  if (!isPlainObject(expectedOrigin)) {
    add(errors, 'expected-proposal-origin-invalid', 'expected proposal origin must be a plain object', { line, id });
    return null;
  }
  const snapshot = snapshotJsonData(expectedOrigin);
  if (!snapshot.ok || !isPlainObject(snapshot.value) || snapshot.value.kind !== 'proposal-promotion.v1') {
    add(errors, 'expected-proposal-origin-invalid', 'expected proposal origin must be complete proposal-promotion.v1 JSON data', {
      line,
      id,
    });
    return null;
  }
  return snapshot.value;
}

export function validateProposalPromotionRecord(record, { line = 1, expectedOrigin } = {}) {
  const { snapshot, errors } = validateRecordSnapshot(record, { line });
  const id = snapshot?.id ?? null;
  const expected = snapshotExpectedOrigin(expectedOrigin, errors, line, id);

  if (!snapshot || snapshot.kind !== 'hq.modelCommitQueued.v1') {
    add(errors, 'proposal-promotion-model-row-required', 'proposal-promotion validation requires hq.modelCommitQueued.v1', {
      line,
      id,
      kind: snapshot?.kind ?? null,
    });
    return errors;
  }
  if (!isPlainObject(snapshot.origin) || snapshot.origin.kind !== 'proposal-promotion.v1') {
    add(errors, 'proposal-promotion-origin-required', 'downstream proposal-gated validation requires origin.kind=proposal-promotion.v1', {
      line,
      id,
      originKind: snapshot.origin?.kind ?? null,
    });
    return errors;
  }

  if (expected) {
    for (const field of proposalOriginFields) {
      if (!Object.is(snapshot.origin[field], expected[field])) {
        add(errors, 'proposal-promotion-expected-origin-mismatch', `origin.${field} does not match the expected promotion origin`, {
          line,
          id,
          field,
          expected: expected[field],
          observed: snapshot.origin[field],
        });
      }
    }
  }

  return errors;
}

export function validateJsonl(text) {
  const errors = [];
  const seenIds = new Map();
  let records = 0;
  const lines = text.split(/\r?\n/);
  lines.forEach((lineText, index) => {
    const line = index + 1;
    const trimmed = lineText.trim();
    if (trimmed.length === 0) return;
    let record;
    try {
      record = JSON.parse(trimmed);
    } catch (error) {
      add(errors, 'invalid-json', error.message, { line });
      return;
    }
    records += 1;
    const validated = validateRecordSnapshot(record, { line });
    errors.push(...validated.errors);
    const id = validated.snapshot?.id;
    if (isNonEmptyString(id)) {
      if (seenIds.has(id)) {
        add(errors, 'duplicate-id', `duplicate id: ${id}`, {
          id,
          line,
          firstLine: seenIds.get(id),
        });
      } else {
        seenIds.set(id, line);
      }
    }
  });
  return { ok: errors.length === 0, records, errors };
}
