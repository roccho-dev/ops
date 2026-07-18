import { sha256Digest } from './digest.mjs';
import { forbiddenAuthorityFields } from './queue-schema.mjs';

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
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

function addDataError(errors, path, reason, extra = {}) {
  const location = pointer(path);
  if (errors.some((error) => error.code === 'proposal-data-invalid'
    && error.path === location
    && error.reason === reason)) return;
  add(
    errors,
    'proposal-data-invalid',
    `proposal data is not JSON-compatible at ${location}: ${reason}`,
    { path: location, reason, ...extra },
  );
}

function ownKeys(value, errors, path) {
  try {
    return Reflect.ownKeys(value);
  } catch {
    addDataError(errors, path, 'property-enumeration-failed');
    return null;
  }
}

function readValue(value, key, errors, path) {
  try {
    return { ok: true, value: value[key] };
  } catch {
    addDataError(errors, path, 'property-read-failed');
    return { ok: false, value: undefined };
  }
}

function validateArray(value, errors, context, path, ancestors) {
  let length;
  try {
    length = value.length;
  } catch {
    addDataError(errors, path, 'array-length-read-failed');
    return;
  }

  const keys = ownKeys(value, errors, path);
  if (keys === null) return;

  const indices = [];
  for (const key of keys) {
    if (typeof key === 'symbol') {
      addDataError(errors, path, 'symbol-key', { symbol: key.description ?? null });
      continue;
    }
    if (key === 'length') continue;
    const index = Number(key);
    const canonicalIndex = Number.isInteger(index)
      && index >= 0
      && index < length
      && String(index) === key;
    if (!canonicalIndex) {
      addDataError(errors, [...path, key], 'extra-array-property');
    } else {
      indices.push(index);
    }
  }

  indices.sort((left, right) => left - right);
  let expectedIndex = 0;
  for (const index of indices) {
    if (index !== expectedIndex) break;
    expectedIndex += 1;
  }
  if (expectedIndex !== length) {
    addDataError(errors, [...path, String(expectedIndex)], 'sparse-array-hole');
  }

  for (const index of indices) {
    const nested = readValue(value, index, errors, [...path, String(index)]);
    if (nested.ok) validateJsonData(nested.value, errors, context, [...path, String(index)], ancestors);
  }
}

function validateObject(value, errors, context, path, ancestors) {
  const keys = ownKeys(value, errors, path);
  if (keys === null) return;

  for (const key of keys) {
    if (typeof key === 'symbol') {
      addDataError(errors, path, 'symbol-key', { symbol: key.description ?? null });
      continue;
    }

    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      addDataError(errors, [...path, key], 'property-descriptor-read-failed');
      continue;
    }
    if (!descriptor?.enumerable) {
      addDataError(errors, [...path, key], 'non-enumerable-property');
      continue;
    }

    const fieldPath = [...path, key];
    if (forbiddenAuthorityFields.includes(key)) {
      const dotPath = fieldPath.join('.');
      add(errors, 'authority-field-present', `authority field is prohibited: ${dotPath}`, {
        line: context.line,
        id: context.id,
        fieldPath: dotPath,
        path: pointer(fieldPath),
      });
    }

    const nested = readValue(value, key, errors, fieldPath);
    if (nested.ok) validateJsonData(nested.value, errors, context, fieldPath, ancestors);
  }
}

function validateJsonData(value, errors, context, path = [], ancestors = new Set()) {
  if (value === null) return;

  const type = typeof value;
  if (type === 'string' || type === 'boolean') return;
  if (type === 'number') {
    if (!Number.isFinite(value)) addDataError(errors, path, 'non-finite-number');
    else if (Object.is(value, -0)) addDataError(errors, path, 'negative-zero');
    return;
  }
  if (type === 'undefined' || type === 'bigint' || type === 'function' || type === 'symbol') {
    addDataError(errors, path, type);
    return;
  }
  if (type !== 'object') {
    addDataError(errors, path, `unsupported-${type}`);
    return;
  }

  const array = Array.isArray(value);
  if (!array && !isPlainObject(value)) {
    addDataError(errors, path, 'non-plain-object');
    return;
  }
  if (ancestors.has(value)) {
    addDataError(errors, path, 'cycle');
    return;
  }

  ancestors.add(value);
  if (array) validateArray(value, errors, context, path, ancestors);
  else validateObject(value, errors, context, path, ancestors);
  ancestors.delete(value);
}

function hasOwn(record, field, errors, line) {
  try {
    return Object.hasOwn(record, field);
  } catch {
    addDataError(errors, [field], 'property-presence-check-failed', { line });
    return false;
  }
}

function readTopLevel(record, field, errors, line) {
  const result = readValue(record, field, errors, [field]);
  if (!result.ok) return undefined;
  return result.value;
}

export function validateModelingProposal(record, { line = 1 } = {}) {
  const errors = [];

  if (!isPlainObject(record)) {
    add(errors, 'proposal-not-object', 'proposal must be an object', { line });
    return errors;
  }

  const kind = readTopLevel(record, 'kind', errors, line);
  if (kind !== 'modeling.proposal.v1') {
    add(errors, 'invalid-proposal-kind', `proposal kind must be modeling.proposal.v1, got ${kind}`, { line, kind });
    return errors;
  }

  const required = ['id', 'sourceAgentTaskId', 'targetRef', 'proposedOperation', 'evidence', 'acceptanceCriteria', 'status'];
  for (const field of required) {
    if (!hasOwn(record, field, errors, line)) {
      add(errors, 'missing-required-field', `missing required field: ${field}`, { line, field });
    }
  }

  const id = readTopLevel(record, 'id', errors, line);
  const sourceAgentTaskId = readTopLevel(record, 'sourceAgentTaskId', errors, line);
  const targetRef = readTopLevel(record, 'targetRef', errors, line);
  const proposedOperation = readTopLevel(record, 'proposedOperation', errors, line);
  const evidence = readTopLevel(record, 'evidence', errors, line);
  const acceptanceCriteria = readTopLevel(record, 'acceptanceCriteria', errors, line);
  const status = readTopLevel(record, 'status', errors, line);

  if (!isNonEmptyString(id)) add(errors, 'invalid-id', 'id must be a non-empty string', { line });
  if (!isNonEmptyString(sourceAgentTaskId)) {
    add(errors, 'invalid-sourceAgentTaskId', 'sourceAgentTaskId must be a non-empty string', { line, id });
  }

  if (!isPlainObject(targetRef)) {
    add(errors, 'targetRef-not-object', 'targetRef must be an object', { line, id });
  } else {
    const targetKind = readValue(targetRef, 'kind', errors, ['targetRef', 'kind']);
    const targetId = readValue(targetRef, 'id', errors, ['targetRef', 'id']);
    if (targetKind.ok && !isNonEmptyString(targetKind.value)) {
      add(errors, 'targetRef-missing-kind', 'targetRef.kind must be a non-empty string', { line, id });
    }
    if (targetId.ok && !isNonEmptyString(targetId.value)) {
      add(errors, 'targetRef-missing-id', 'targetRef.id must be a non-empty string', { line, id });
    }
  }

  if (!isPlainObject(proposedOperation)) {
    add(errors, 'proposedOperation-not-object', 'proposedOperation must be an object', { line, id });
  } else {
    const op = readValue(proposedOperation, 'op', errors, ['proposedOperation', 'op']);
    const payload = readValue(proposedOperation, 'payload', errors, ['proposedOperation', 'payload']);
    if (op.ok && !isNonEmptyString(op.value)) {
      add(errors, 'proposal-op-missing', 'proposedOperation.op must be a non-empty string', { line, id });
    }
    if (payload.ok && !isPlainObject(payload.value)) {
      add(errors, 'proposal-payload-not-object', 'proposedOperation.payload must be an object', { line, id });
    }
  }

  if (!Array.isArray(evidence) || evidence.length === 0) {
    add(errors, 'evidence-missing', 'evidence must be a non-empty array', { line, id });
  }
  if (!Array.isArray(acceptanceCriteria) || acceptanceCriteria.length === 0) {
    add(errors, 'acceptanceCriteria-missing', 'acceptanceCriteria must be a non-empty array', { line, id });
  }

  if (!['proposed', 'rejected', 'promoted'].includes(status)) {
    add(errors, 'invalid-proposal-status', 'status must be proposed, rejected, or promoted', { line, id, status });
  }

  try {
    validateJsonData(record, errors, { line, id });
  } catch {
    addDataError(errors, [], 'validation-failed');
  }

  if (hasOwn(record, 'modelQueueRow', errors, line) || hasOwn(record, 'acceptedRow', errors, line)) {
    add(errors, 'embedded-authority-shape', 'proposal must not embed modelQueueRow or acceptedRow', { line, id });
  }

  return errors;
}

export function proposalDigest(record) {
  return sha256Digest(record);
}
