import { sha256Digest } from './digest.mjs';
import { validateRecord } from './queue-validator.mjs';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonLine(lineText, line) {
  try {
    return { ok: true, record: JSON.parse(lineText) };
  } catch (error) {
    return {
      ok: false,
      error: { code: 'invalid-json', message: error.message, line },
    };
  }
}

function safeQueueId(record, line) {
  if (isPlainObject(record) && typeof record.id === 'string' && record.id.trim().length > 0) {
    return record.id;
  }
  return `line:${line}`;
}

function acceptedModelCommit(record, line) {
  const base = {
    kind: 'accepted.modelCommit.v1',
    id: `accepted:${record.id}`,
    sourceQueueId: record.id,
    admissionScope: 'local-dev',
    localDevOnly: true,
    targetRef: record.targetRef,
    op: record.op,
    payload: record.payload,
    confirmedBy: record.confirmedBy,
    line,
    queueDigest: sha256Digest(record),
  };
  const row = {
    ...base,
    acceptedDigest: sha256Digest(base),
  };
  if ('reason' in record) row.reason = record.reason;
  return row;
}

function admissionReceipt({ record, line, status, acceptedRow = null, errors = [], ledgerDigest = null }) {
  const queueId = safeQueueId(record, line);
  const receipt = {
    kind: 'admission.receipt.v1',
    id: `admission-receipt:${queueId}:${line}`,
    queueId,
    line,
    status,
    admissionScope: 'local-dev',
    localDevOnly: true,
    evidenceOnly: true,
    queueDigest: sha256Digest(record ?? { line, errors }),
    ledgerDigest,
    message: status === 'admitted'
      ? 'model commit admitted into local-dev accepted-ledger-shaped output'
      : 'queue row rejected by local-dev admission gate',
  };

  if (record?.kind) receipt.queueKind = record.kind;
  if (acceptedRow) receipt.acceptedId = acceptedRow.id;
  if (errors.length > 0) receipt.errorCodes = errors.map((error) => error.code);
  return receipt;
}

function reject({ record = null, line, errors }) {
  return {
    acceptedRow: null,
    receipt: admissionReceipt({ record, line, status: 'rejected', errors }),
    errors,
  };
}

export function runAdmissionGateJsonl(text) {
  const acceptedRows = [];
  const receipts = [];
  const errors = [];
  const seenIds = new Map();
  let records = 0;

  text.split(/\r?\n/).forEach((lineText, index) => {
    const line = index + 1;
    const trimmed = lineText.trim();
    if (trimmed.length === 0) return;
    records += 1;

    const parsed = parseJsonLine(trimmed, line);
    if (!parsed.ok) {
      const rejected = reject({ line, errors: [parsed.error] });
      receipts.push(rejected.receipt);
      errors.push(...rejected.errors);
      return;
    }

    const record = parsed.record;
    const validationErrors = validateRecord(record, { line });
    if (validationErrors.length > 0) {
      const rejected = reject({ record, line, errors: validationErrors });
      receipts.push(rejected.receipt);
      errors.push(...rejected.errors);
      return;
    }

    if (seenIds.has(record.id)) {
      const duplicate = {
        code: 'duplicate-id',
        message: `duplicate id: ${record.id}`,
        id: record.id,
        line,
        firstLine: seenIds.get(record.id),
      };
      const rejected = reject({ record, line, errors: [duplicate] });
      receipts.push(rejected.receipt);
      errors.push(duplicate);
      return;
    }
    seenIds.set(record.id, line);

    if (record.kind !== 'hq.modelCommitQueued.v1') {
      const error = {
        code: 'not-admissible-kind',
        message: `only hq.modelCommitQueued.v1 is admissible, got ${record.kind}`,
        kind: record.kind,
        line,
      };
      const rejected = reject({ record, line, errors: [error] });
      receipts.push(rejected.receipt);
      errors.push(error);
      return;
    }

    const acceptedRow = acceptedModelCommit(record, line);
    acceptedRows.push(acceptedRow);
    receipts.push(admissionReceipt({ record, line, status: 'admitted', acceptedRow }));
  });

  const ledgerDigest = sha256Digest(acceptedRows);
  const receiptsWithLedger = receipts.map((receipt) => ({ ...receipt, ledgerDigest }));

  return {
    ok: errors.length === 0,
    records,
    admitted: acceptedRows.length,
    rejected: receiptsWithLedger.filter((receipt) => receipt.status === 'rejected').length,
    acceptedRows,
    admissionReceipts: receiptsWithLedger,
    ledgerDigest,
    errors,
  };
}

export function rowsToJsonl(rows) {
  return `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
}
