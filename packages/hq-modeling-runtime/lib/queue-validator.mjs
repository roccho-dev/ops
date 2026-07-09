import {
  forbiddenAcceptedLedgerShapeFields,
  forbiddenAuthorityFields,
  forbiddenEmbeddedRowKindPrefixes,
  forbiddenEmbeddedRowKinds,
  queueKinds,
  schemaByKind,
} from './queue-schema.mjs';

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
  if (!isPlainObject(value)) {
    return [];
  }

  const found = [];
  for (const [key, nested] of Object.entries(value)) {
    if (forbiddenAuthorityFields.includes(key)) {
      found.push([...path, key].join('.'));
    }
    found.push(...findForbiddenAuthorityFields(nested, [...path, key]));
  }
  return found;
}

function isForbiddenEmbeddedKind(kind) {
  return forbiddenEmbeddedRowKinds.includes(kind)
    || forbiddenEmbeddedRowKindPrefixes.some((prefix) => kind.startsWith(prefix));
}

function findForbiddenEmbeddedRows(value, path = ['payload']) {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => findForbiddenEmbeddedRows(entry, [...path, String(index)]));
  }
  if (!isPlainObject(value)) {
    return [];
  }

  const found = [];
  if (typeof value.kind === 'string' && isForbiddenEmbeddedKind(value.kind)) {
    found.push({ path: [...path, 'kind'].join('.'), kind: value.kind, reason: 'forbidden-kind' });
  }

  const acceptedShapeFields = forbiddenAcceptedLedgerShapeFields.filter((field) => field in value);
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
    if (!(field in record)) {
      add(errors, 'missing-required-field', `missing required field: ${field}`, {
        line,
        kind: record.kind,
        field,
      });
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

  const forbidden = findForbiddenAuthorityFields(record);
  for (const fieldPath of forbidden) {
    add(errors, 'authority-field-present', `authority field is prohibited: ${fieldPath}`, {
      line,
      kind: record.kind,
      id: record.id,
      fieldPath,
    });
  }

  if (record.kind === 'hq.modelCommitQueued.v1') {
    validateTargetRef(record, errors, line);
    if (!isNonEmptyString(record.op)) {
      add(errors, 'invalid-op', 'op must be a non-empty string', { line, id: record.id });
    }
    if (!isPlainObject(record.payload)) {
      add(errors, 'payload-not-object', 'payload must be an object', { line, id: record.id });
    } else {
      const smuggledRows = findForbiddenEmbeddedRows(record.payload);
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
    if (!isNonEmptyString(record.confirmedBy)) {
      add(errors, 'invalid-confirmedBy', 'confirmedBy must be a non-empty string', { line, id: record.id });
    }
  }

  if (record.kind === 'hq.agentTaskQueued.v1') {
    validateTargetRef(record, errors, line);
    if (!isNonEmptyString(record.goal)) {
      add(errors, 'invalid-goal', 'goal must be a non-empty string', { line, id: record.id });
    }
    if (!isNonEmptyString(record.confirmedBy)) {
      add(errors, 'invalid-confirmedBy', 'confirmedBy must be a non-empty string', { line, id: record.id });
    }
    if ('context' in record && !Array.isArray(record.context)) {
      add(errors, 'context-not-array', 'context must be an array when present', { line, id: record.id });
    }
    if ('acceptance' in record && !Array.isArray(record.acceptance)) {
      add(errors, 'acceptance-not-array', 'acceptance must be an array when present', { line, id: record.id });
    }
  }

  if (record.kind === 'hq.receipt.v1') {
    if (!isNonEmptyString(record.queueId)) {
      add(errors, 'invalid-queueId', 'queueId must be a non-empty string', { line, id: record.id });
    }
    if ('queueDigest' in record && !isNonEmptyString(record.queueDigest)) {
      add(errors, 'invalid-queueDigest', 'queueDigest must be a non-empty string when present', { line, id: record.id });
    }
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
    if (trimmed.length === 0) {
      return;
    }

    let record;
    try {
      record = JSON.parse(trimmed);
    } catch (error) {
      add(errors, 'invalid-json', error.message, { line });
      return;
    }

    records.push(record);
    errors.push(...validateRecord(record, { line }));

    if (isPlainObject(record) && isNonEmptyString(record.id)) {
      if (seenIds.has(record.id)) {
        add(errors, 'duplicate-id', `duplicate id: ${record.id}`, {
          id: record.id,
          line,
          firstLine: seenIds.get(record.id),
        });
      } else {
        seenIds.set(record.id, line);
      }
    }
  });

  return {
    ok: errors.length === 0,
    records: records.length,
    errors,
  };
}
