import { sha256Digest } from './digest.mjs';
import {
  expectedObservedDigest,
  validateSourceRecord,
} from './source-validator.mjs';

function parseJsonLine(lineText, line) {
  try {
    return { ok: true, record: JSON.parse(lineText) };
  } catch (error) {
    return { ok: false, error: { code: 'invalid-json', message: error.message, line } };
  }
}

function safeId(record, line) {
  if (record && typeof record.id === 'string' && record.id.trim().length > 0) return record.id;
  return `line:${line}`;
}

export function sourceObservationRow(input) {
  const base = {
    kind: 'source.observation.v1',
    id: input.id,
    status: input.status,
    surface: input.surface,
    observedAt: input.observedAt,
    subjectRef: input.subjectRef,
    sourceRef: input.sourceRef,
    observation: input.observation,
  };
  return {
    ...base,
    observedDigest: sha256Digest(base),
  };
}

export function sourceReceiptFromObservation(observation, { line = 1 } = {}) {
  const observedDigest = observation.observedDigest ?? expectedObservedDigest(observation);
  const base = {
    kind: 'source.receipt.v1',
    id: `source-receipt:${observation.id}:${line}`,
    status: observation.status,
    observationId: observation.id,
    surface: observation.surface,
    subjectRef: observation.subjectRef,
    sourceRef: observation.sourceRef,
    observedDigest,
    line,
    evidenceOnly: true,
  };
  return {
    ...base,
    receiptDigest: sha256Digest(base),
  };
}

export function sourceReceiptsToJsonl(receipts) {
  return `${receipts.map((receipt) => JSON.stringify(receipt)).join('\n')}\n`;
}

export function writeSourceReceiptsJsonl(text) {
  const observations = [];
  const receipts = [];
  const errors = [];
  let records = 0;

  text.split(/\r?\n/).forEach((lineText, index) => {
    const line = index + 1;
    const trimmed = lineText.trim();
    if (trimmed.length === 0) return;
    records += 1;

    const parsed = parseJsonLine(trimmed, line);
    if (!parsed.ok) {
      errors.push(parsed.error);
      return;
    }

    const record = parsed.record;
    const validationErrors = validateSourceRecord(record, { line });
    if (validationErrors.length > 0) {
      errors.push(...validationErrors);
      return;
    }

    if (record.kind !== 'source.observation.v1') {
      errors.push({
        code: 'not-observation-kind',
        message: `receipt writer consumes source.observation.v1 rows, got ${record.kind}`,
        line,
        id: safeId(record, line),
        kind: record.kind,
      });
      return;
    }

    observations.push(record);
    receipts.push(sourceReceiptFromObservation(record, { line }));
  });

  return {
    ok: errors.length === 0,
    records,
    observations: observations.length,
    receipts: receipts.length,
    receiptRows: receipts,
    receiptDigest: sha256Digest(receipts),
    errors,
  };
}
