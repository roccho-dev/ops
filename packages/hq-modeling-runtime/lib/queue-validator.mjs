import { types } from 'node:util';

import { sha256Digest } from './digest.mjs';
import {
  findAuthorityBearingShapes,
  forbiddenAcceptedLedgerShapeFields,
  forbiddenEmbeddedRowKindPrefixes,
  forbiddenEmbeddedRowKinds,
  modelQueueOriginKinds,
  queueKinds,
  schemaByKind,
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

function hasOwn(value, field) {
  try {
    return Object.hasOwn(value, field);
  } catch {
    return false;
  }
}

function isForbiddenEmbeddedKind(kind) {
  return forbiddenEmbeddedRowKinds.includes(kind)
    || forbiddenEmbeddedRowKindPrefixes.some((prefix) => kind.startsWith(prefix));
}

function findForbiddenEmbeddedRows(value, path = ['payload']) {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => findForbiddenEmbeddedRows(entry, [...path, String(index)]));
  }
  if (!isPlainObject(value)) return [];

  const found = [];
  if (typeof value.kind === 'string' && isForbiddenEmbeddedKind(value.kind)) {
    found.push({ path: [...path, 'kind'].join('.'), kind: value.kind, reason: 'forbidden-kind' });
  }

  const acceptedShapeFields = forbiddenAcceptedLedgerShapeFields.filter((field) => hasOwn(value, field));
  if (acceptedShapeFields.length > 0) {
    found.push({
      path: path.join('.'),
      kind: typeof value.kind === 'string' ? value.kind : null,
      reason: 'accepted-ledger-shape',
      fields: acceptedShapeFields,
    });
  }

  for (const [key, nested] of Object.entries(value)) {
    found.push(...findForbiddenEmbeddedRows(nested, [...path, key]));
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

function integrityMaterial(record) {
  const origin = isPlainObject(record.origin) ? { ...record.origin } : record.origin;
  if (isPlainObject(origin)) delete origin.integrityDigest;
  return { ...record, origin };
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
  const origin = {
    kind: 'proposal-promotion.v1',
    proposalId,
    proposalDigest,
    confirmationDigest,
    confirmedBy,
    evidenceDigest: sha256Digest(queueRow.evidence),
    promotionEvidenceId: proposalPromotionEvidenceId({ proposalId, proposalDigest, confirmationDigest, confirmedBy }),
  };
  return {
    ...origin,
    integrityDigest: modelQueueIntegrityDigest({ ...queueRow, origin }),
  };
}

function readOriginSnapshot(record, errors, line) {
  if (!isPlainObject(record.origin)) {
    add(errors, 'model-origin-not-object', 'model queue origin must be a plain non-Proxy object', { line, id: record.id });
    return null;
  }
  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(record.origin);
  } catch {
    add(errors, 'model-origin-snapshot-failed', 'model queue origin descriptors could not be snapshotted', { line, id: record.id });
    return null;
  }
  const snapshot = Object.create(null);
  for (const [field, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      add(errors, 'model-origin-field-not-data', `origin.${field} must be an enumerable data property`, {
        line, id: record.id, field,
      });
      continue;
    }
    snapshot[field] = descriptor.value;
  }
  return snapshot;
}

function validateModelQueueOrigin(record, errors, line) {
  const origin = readOriginSnapshot(record, errors, line);
  if (!origin) return;

  if (!hasOwn(origin, 'kind') || !modelQueueOriginKinds.includes(origin.kind)) {
    add(errors, 'invalid-model-origin-kind', `model queue origin.kind must be one of: ${modelQueueOriginKinds.join(', ')}`, {
      line,
      id: record.id,
      originKind: origin.kind,
    });
    return;
  }

  if (origin.kind === 'direct-human.v1') {
    for (const field of ['confirmationId', 'confirmedBy']) {
      if (!hasOwn(origin, field) || !isNonEmptyString(origin[field])) {
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
    const proposalMarkers = hasOwn(record, 'proposalDigest')
      || hasOwn(record, 'proposalId')
      || (typeof record.id === 'string' && record.id.startsWith('mq_from_'))
      || (typeof record.reason === 'string' && record.reason.startsWith('promoted proposal '));
    if (proposalMarkers) {
      add(errors, 'proposal-origin-mismatch', 'proposal-derived row cannot claim direct-human origin', { line, id: record.id });
    }
    return;
  }

  for (const field of ['proposalId', 'proposalDigest', 'confirmationDigest', 'confirmedBy', 'evidenceDigest', 'promotionEvidenceId', 'integrityDigest']) {
    if (!hasOwn(origin, field) || !isNonEmptyString(origin[field])) {
      add(errors, 'proposal-origin-field-invalid', `proposal promotion origin.${field} must be a non-empty own data field`, {
        line,
        id: record.id,
        field,
      });
    }
  }

  if (isNonEmptyString(origin.proposalDigest) && !isCanonicalDigest(origin.proposalDigest)) {
    add(errors, 'proposal-origin-digest-invalid', 'origin.proposalDigest must be a canonical sha256 digest', { line, id: record.id });
  }
  if (isNonEmptyString(origin.confirmationDigest) && !isCanonicalDigest(origin.confirmationDigest)) {
    add(errors, 'proposal-origin-confirmation-digest-invalid', 'origin.confirmationDigest must be a canonical sha256 digest', { line, id: record.id });
  }
  if (isNonEmptyString(origin.evidenceDigest) && !isCanonicalDigest(origin.evidenceDigest)) {
    add(errors, 'proposal-origin-evidence-digest-invalid', 'origin.evidenceDigest must be a canonical sha256 digest', { line, id: record.id });
  }
  if (isNonEmptyString(origin.promotionEvidenceId) && !isCanonicalDigest(origin.promotionEvidenceId)) {
    add(errors, 'promotion-evidence-id-invalid', 'origin.promotionEvidenceId must be a canonical sha256 digest', { line, id: record.id });
  }
  if (isNonEmptyString(origin.integrityDigest) && !isCanonicalDigest(origin.integrityDigest)) {
    add(errors, 'promotion-integrity-digest-invalid', 'origin.integrityDigest must be a canonical sha256 digest', { line, id: record.id });
  }
  if (!hasOwn(record, 'proposalDigest') || record.proposalDigest !== origin.proposalDigest) {
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
    let observedEvidenceDigest;
    try {
      observedEvidenceDigest = sha256Digest(record.evidence);
    } catch {
      add(errors, 'proposal-origin-evidence-check-failed', 'proposal-origin evidence could not be digested', { line, id: record.id });
    }
    if (observedEvidenceDigest && observedEvidenceDigest !== origin.evidenceDigest) {
      add(errors, 'proposal-origin-evidence-digest-mismatch', 'origin.evidenceDigest must match preserved proposal evidence', {
        line, id: record.id, expected: origin.evidenceDigest, observed: observedEvidenceDigest,
      });
    }
  }

  if (isCanonicalDigest(origin.promotionEvidenceId)) {
    const observedPromotionEvidenceId = proposalPromotionEvidenceId(origin);
    if (observedPromotionEvidenceId !== origin.promotionEvidenceId) {
      add(errors, 'promotion-evidence-id-mismatch', 'origin.promotionEvidenceId must link proposal and confirmation identities', {
        line, id: record.id, expected: origin.promotionEvidenceId, observed: observedPromotionEvidenceId,
      });
    }
  }

  if (isCanonicalDigest(origin.integrityDigest)) {
    let observed;
    try {
      observed = modelQueueIntegrityDigest(record);
    } catch {
      add(errors, 'promotion-integrity-check-failed', 'proposal-origin row could not be integrity checked', { line, id: record.id });
      return;
    }
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
  let findings;
  try {
    findings = findAuthorityBearingShapes(record);
  } catch {
    add(errors, 'authority-shape-scan-failed', 'queue row authority-shape scan failed closed', { line, kind: record.kind, id: record.id });
    return;
  }
  for (const finding of findings) {
    const code = finding.reason === 'forbidden-field' ? 'authority-field-present' : 'authority-shape-present';
    add(errors, code, `authority-bearing shape is prohibited: ${finding.path}`, {
      line,
      kind: record.kind,
      id: record.id,
      fieldPath: (finding.segments ?? []).join('.'),
      reason: finding.reason,
      detail: finding.detail,
      normalizedField: finding.normalizedField,
      normalizedValue: finding.normalizedValue,
    });
  }
}

export function validateRecord(record, { line = 1 } = {}) {
  const errors = [];

  if (!isPlainObject(record)) {
    add(errors, 'record-not-object', 'row must be a JSON object', { line });
    return errors;
  }

  if (!queueKinds.includes(record.kind)) {
    add(errors, 'unknown-kind', `unsupported queue kind: ${record.kind}`, { line, kind: record.kind });
    return errors;
  }

  const schema = schemaByKind[record.kind];
  for (const field of schema.required) {
    if (!hasOwn(record, field)) {
      add(errors, 'missing-required-field', `missing required field: ${field}`, { line, kind: record.kind, field });
    }
  }

  if (!isNonEmptyString(record.id)) {
    add(errors, 'invalid-id', 'id must be a non-empty string', { line, kind: record.kind });
  }

  if (!schema.status.includes(record.status)) {
    add(errors, 'invalid-status', `status must be one of: ${schema.status.join(', ')}`, {
      line,
      kind: record.kind,
      status: record.status,
    });
  }

  addAuthorityShapeErrors(errors, record, line);

  if (record.kind === 'hq.modelCommitQueued.v1') {
    validateTargetRef(record, errors, line);
    if (!isNonEmptyString(record.op)) add(errors, 'invalid-op', 'op must be a non-empty string', { line, id: record.id });
    if (!isPlainObject(record.payload)) {
      add(errors, 'payload-not-object', 'payload must be an object', { line, id: record.id });
    } else {
      let smuggledRows = [];
      try {
        smuggledRows = findForbiddenEmbeddedRows(record.payload);
      } catch {
        add(errors, 'payload-smuggling-scan-failed', 'model payload smuggling scan failed closed', { line, id: record.id });
      }
      for (const smuggled of smuggledRows) {
        add(errors, 'payload-smuggled-row', `model payload must not embed source/reconcile/admission/accepted rows: ${smuggled.path}`, {
          line,
          kind: record.kind,
          id: record.id,
          fieldPath: smuggled.path,
          embeddedKind: smuggled.kind,
          reason: smuggled.reason,
          fields: smuggled.fields,
        });
      }
    }
    if (!isNonEmptyString(record.confirmedBy)) add(errors, 'invalid-confirmedBy', 'confirmedBy must be a non-empty string', { line, id: record.id });
    validateModelQueueOrigin(record, errors, line);
  }

  if (record.kind === 'hq.agentTaskQueued.v1') {
    validateTargetRef(record, errors, line);
    if (!isNonEmptyString(record.goal)) add(errors, 'invalid-goal', 'goal must be a non-empty string', { line, id: record.id });
    if (!isNonEmptyString(record.confirmedBy)) add(errors, 'invalid-confirmedBy', 'confirmedBy must be a non-empty string', { line, id: record.id });
    if (hasOwn(record, 'context') && !Array.isArray(record.context)) add(errors, 'context-not-array', 'context must be an array when present', { line, id: record.id });
    if (hasOwn(record, 'acceptance') && !Array.isArray(record.acceptance)) add(errors, 'acceptance-not-array', 'acceptance must be an array when present', { line, id: record.id });
  }

  if (record.kind === 'hq.receipt.v1') {
    if (!isNonEmptyString(record.queueId)) add(errors, 'invalid-queueId', 'queueId must be a non-empty string', { line, id: record.id });
    if (hasOwn(record, 'queueDigest') && !isNonEmptyString(record.queueDigest)) add(errors, 'invalid-queueDigest', 'queueDigest must be a non-empty string when present', { line, id: record.id });
  }

  return errors;
}

export function validateJsonl(text) {
  const records = [];
  const errors = [];
  const seenIds = new Map();
  const lines = text.split(/\r?\n/);
  lines.forEach((lineText, index) => {
    const line = index + 1;
    const trimmed = lineText.trim();
    if (trimmed.length === 0) return;
    let record;
    try { record = JSON.parse(trimmed); } catch (error) { add(errors, 'invalid-json', error.message, { line }); return; }
    records.push(record);
    errors.push(...validateRecord(record, { line }));
    if (isPlainObject(record) && isNonEmptyString(record.id)) {
      if (seenIds.has(record.id)) add(errors, 'duplicate-id', `duplicate id: ${record.id}`, { id: record.id, line, firstLine: seenIds.get(record.id) });
      else seenIds.set(record.id, line);
    }
  });
  return { ok: errors.length === 0, records: records.length, errors };
}
