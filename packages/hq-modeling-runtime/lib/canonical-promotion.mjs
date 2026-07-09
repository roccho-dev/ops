import { sha256Digest } from './digest.mjs';
import { forbiddenAuthorityFields } from './queue-schema.mjs';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
    if ((forbiddenAuthorityFields.includes(key) || key === 'canonicalAuthority') && nested !== false) {
      found.push([...path, key].join('.'));
    }
    found.push(...findForbiddenAuthorityFields(nested, [...path, key]));
  }
  return found;
}

export const canonicalPromotionContract = Object.freeze({
  kind: 'hq.canonicalPromotion.contract.v1',
  stagedAcceptedKind: 'accepted.modelCommit.v1',
  canonicalTarget: 'remote-bare-repo',
  authorityBoundary: 'local staged accepted is not canonical; canonical authority requires remote promotion and readback',
  requiredReceipts: Object.freeze([
    'admission.receipt.v1',
    'hq.cueAppendContract.receipt.v1',
    'remote.writeCandidateManifest.v1',
    'remote.readback.receipt.v1',
  ]),
});

export function evaluateCanonicalPromotionCandidate(candidate = {}) {
  const errors = [];
  const stagedRows = Array.isArray(candidate.stagedAcceptedRows) ? candidate.stagedAcceptedRows : [];
  const receipts = Array.isArray(candidate.receipts) ? candidate.receipts : [];
  const receiptKinds = new Set(receipts.map((receipt) => receipt.kind));

  if (stagedRows.length === 0) {
    errors.push({ code: 'missing-staged-accepted', message: 'staged accepted rows are required' });
  }
  stagedRows.forEach((row, index) => {
    if (!isPlainObject(row) || row.kind !== canonicalPromotionContract.stagedAcceptedKind) {
      errors.push({ code: 'invalid-staged-kind', index, message: 'staged rows must be accepted.modelCommit.v1' });
    }
  });

  for (const requiredKind of canonicalPromotionContract.requiredReceipts) {
    if (!receiptKinds.has(requiredKind)) {
      errors.push({ code: 'missing-required-receipt', kind: requiredKind, message: `missing required receipt: ${requiredKind}` });
    }
  }

  if (Array.isArray(candidate.queueRows) && candidate.queueRows.length > 0) {
    errors.push({ code: 'queue-only-not-promotable', message: 'queue rows cannot promote directly to canonical' });
  }
  if (candidate.projection || candidate.preview) {
    errors.push({ code: 'artifact-only-not-promotable', message: 'projection and preview artifacts cannot promote directly to canonical' });
  }

  const remoteReadback = receipts.find((receipt) => receipt.kind === 'remote.readback.receipt.v1');
  if (remoteReadback) {
    if (remoteReadback.target !== canonicalPromotionContract.canonicalTarget) {
      errors.push({ code: 'wrong-remote-target', message: 'remote readback target must be remote-bare-repo', observed: remoteReadback.target });
    }
    if (remoteReadback.status !== 'matched') {
      errors.push({ code: 'remote-readback-not-matched', message: 'remote readback must be matched', observed: remoteReadback.status });
    }
    if (remoteReadback.stale === true) {
      errors.push({ code: 'stale-remote-readback', message: 'stale remote readback blocks promotion' });
    }
  }

  for (const fieldPath of findForbiddenAuthorityFields(candidate)) {
    errors.push({ code: 'authority-field-present', fieldPath, message: `authority field is prohibited before promotion: ${fieldPath}` });
  }

  const stagedLedgerDigest = sha256Digest(stagedRows);
  const receiptDigest = sha256Digest(receipts);
  return {
    ok: errors.length === 0,
    eligible: errors.length === 0,
    kind: 'hq.canonicalPromotionEligibility.v1',
    target: canonicalPromotionContract.canonicalTarget,
    stagedLedgerDigest,
    receiptDigest,
    candidateDigest: sha256Digest({ stagedLedgerDigest, receiptDigest }),
    authority: false,
    canonicalAuthorityAfterPromotionOnly: true,
    errors,
  };
}
