import { sha256Digest } from './digest.mjs';

const REQUIRED_DIGESTS = [
  'targetRefDigest',
  'queueDigest',
  'workerReceiptDigest',
  'projectionDigest',
  'previewDigest',
];

function isDigest(value) {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
}

function add(errors, code, message, extra = {}) {
  errors.push({ code, message, ...extra });
}

export function createEditorToUiReceipt(fields) {
  const receipt = {
    kind: 'crossRepo.editorToUiReceipt.v1',
    evidenceOnly: true,
    nonAuthority: true,
    targetRefDigest: fields.targetRefDigest,
    queueDigest: fields.queueDigest,
    workerReceiptDigest: fields.workerReceiptDigest,
    projectionDigest: fields.projectionDigest,
    previewDigest: fields.previewDigest,
    sourceRefs: fields.sourceRefs ?? {},
  };
  return {
    ...receipt,
    receiptDigest: sha256Digest(receipt),
  };
}

export function validateEditorToUiReceipt(receipt, expected = {}) {
  const errors = [];

  if (receipt?.kind !== 'crossRepo.editorToUiReceipt.v1') {
    add(errors, 'invalid-kind', 'receipt kind must be crossRepo.editorToUiReceipt.v1');
    return errors;
  }
  if (receipt.evidenceOnly !== true) add(errors, 'not-evidence-only', 'receipt must be evidenceOnly');
  if (receipt.nonAuthority !== true) add(errors, 'not-non-authority', 'receipt must be nonAuthority');

  for (const field of REQUIRED_DIGESTS) {
    if (!isDigest(receipt[field])) {
      add(errors, 'invalid-digest', `${field} must be a sha256 digest`, { field });
    }
    if (expected[field] && receipt[field] !== expected[field]) {
      add(errors, 'digest-mismatch', `${field} does not match expected digest`, { field, expected: expected[field], actual: receipt[field] });
    }
  }

  for (const authorityField of ['accepted', 'acceptedLedger', 'authority', 'sourceModelAuthority', 'uiStateAuthority']) {
    if (authorityField in receipt) {
      add(errors, 'authority-field-present', `authority field is prohibited: ${authorityField}`, { field: authorityField });
    }
  }

  if (!isDigest(receipt.receiptDigest)) {
    add(errors, 'invalid-receipt-digest', 'receiptDigest must be a sha256 digest');
  } else {
    const { receiptDigest: _discard, ...withoutDigest } = receipt;
    const actual = sha256Digest(withoutDigest);
    if (actual !== receipt.receiptDigest) {
      add(errors, 'receipt-digest-mismatch', 'receiptDigest does not match receipt content', { expected: actual, actual: receipt.receiptDigest });
    }
  }

  return errors;
}
