import {
  forbiddenSourceAuthorityFields,
  schemaByKind,
  sourceKinds,
  sourceSurfaces,
} from './source-schema.mjs';
import { sha256Digest } from './digest.mjs';

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
    if (forbiddenSourceAuthorityFields.includes(key)) {
      found.push([...path, key].join('.'));
    }
    found.push(...findForbiddenAuthorityFields(nested, [...path, key]));
  }
  return found;
}

function validateRef(record, key, errors, line) {
  const ref = record[key];
  if (!isPlainObject(ref)) {
    add(errors, `${key}-not-object`, `${key} must be an object`, { line, id: record.id });
    return;
  }
  if (!isNonEmptyString(ref.kind)) {
    add(errors, `${key}-missing-kind`, `${key}.kind must be a non-empty string`, { line, id: record.id });
  }
  if (!isNonEmptyString(ref.id)) {
    add(errors, `${key}-missing-id`, `${key}.id must be a non-empty string`, { line, id: record.id });
  }
}

export function observationDigestInput(record) {
  const { observedDigest, ...input } = record;
  return input;
}

export function expectedObservedDigest(record) {
  return sha256Digest(observationDigestInput(record));
}

export function receiptDigestInput(record) {
  const { receiptDigest, ...input } = record;
  return input;
}

export function expectedReceiptDigest(record) {
  return sha256Digest(receiptDigestInput(record));
}

export function validateSourceRecord(record, { line = 1 } = {}) {
  const errors = [];

  if (!isPlainObject(record)) {
    add(errors, 'record-not-object', 'row must be a JSON object', { line });
    return errors;
  }

  if (!sourceKinds.includes(record.kind)) {
    add(errors, 'unknown-kind', `unsupported source evidence kind: ${record.kind}`, { line, kind: record.kind });
    return errors;
  }

  const schema = schemaByKind[record.kind];
  for (const field of schema.required) {
    if (!(field in record)) {
      add(errors, 'missing-required-field', `missing required field: ${field}`, { line, kind: record.kind, field });
    }
  }

  if (!isNonEmptyString(record.id)) {
    add(errors, 'invalid-id', 'id must be a non-empty string', { line, kind: record.kind });
  }

  if (!schema.status.includes(record.status)) {
    add(errors, 'invalid-status', `status must be one of: ${schema.status.join(', ')}`, { line, kind: record.kind, status: record.status });
  }

  if (!sourceSurfaces.includes(record.surface)) {
    add(errors, 'invalid-surface', `surface must be one of: ${sourceSurfaces.join(', ')}`, { line, kind: record.kind, surface: record.surface });
  }

  const forbidden = findForbiddenAuthorityFields(record);
  for (const fieldPath of forbidden) {
    add(errors, 'authority-field-present', `authority field is prohibited: ${fieldPath}`, { line, kind: record.kind, id: record.id, fieldPath });
  }

  if (record.kind === 'source.observation.v1') {
    if (!isNonEmptyString(record.observedAt)) {
      add(errors, 'invalid-observedAt', 'observedAt must be a non-empty string', { line, id: record.id });
    }
    validateRef(record, 'subjectRef', errors, line);
    validateRef(record, 'sourceRef', errors, line);
    if (!isPlainObject(record.observation)) {
      add(errors, 'observation-not-object', 'observation must be an object', { line, id: record.id });
    }
    if (!isNonEmptyString(record.observedDigest)) {
      add(errors, 'invalid-observedDigest', 'observedDigest must be a non-empty string', { line, id: record.id });
    } else {
      const expected = expectedObservedDigest(record);
      if (record.observedDigest !== expected) {
        add(errors, 'observed-digest-mismatch', 'observedDigest must match the deterministic observation digest', {
          line,
          id: record.id,
          expected,
          actual: record.observedDigest,
        });
      }
    }
  }

  if (record.kind === 'source.receipt.v1') {
    if (!isNonEmptyString(record.observationId)) {
      add(errors, 'invalid-observationId', 'observationId must be a non-empty string', { line, id: record.id });
    }
    if (!isNonEmptyString(record.observedDigest)) {
      add(errors, 'invalid-observedDigest', 'observedDigest must be a non-empty string', { line, id: record.id });
    }
    if (record.evidenceOnly !== true) {
      add(errors, 'not-evidence-only', 'source receipts must be evidenceOnly=true', { line, id: record.id });
    }
    if (!isNonEmptyString(record.receiptDigest)) {
      add(errors, 'invalid-receiptDigest', 'receiptDigest must be a non-empty string', { line, id: record.id });
    } else {
      const expected = expectedReceiptDigest(record);
      if (record.receiptDigest !== expected) {
        add(errors, 'receipt-digest-mismatch', 'receiptDigest must match the deterministic receipt digest', {
          line,
          id: record.id,
          expected,
          actual: record.receiptDigest,
        });
      }
    }
  }

  return errors;
}

export function validateSourceJsonl(text) {
  const errors = [];
  const records = [];
  const seenIds = new Map();

  text.split(/\r?\n/).forEach((lineText, index) => {
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

    records.push(record);
    errors.push(...validateSourceRecord(record, { line }));
    if (isPlainObject(record) && isNonEmptyString(record.id)) {
      if (seenIds.has(record.id)) {
        add(errors, 'duplicate-id', `duplicate id: ${record.id}`, { id: record.id, line, firstLine: seenIds.get(record.id) });
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
