import { types } from 'node:util';

export const queueKinds = Object.freeze([
  'hq.modelCommitQueued.v1',
  'hq.agentTaskQueued.v1',
  'hq.receipt.v1',
]);

export const queueStatuses = Object.freeze(['queued']);
export const receiptStatuses = Object.freeze(['processed', 'pending', 'failed']);

export const forbiddenAuthorityFields = Object.freeze([
  'accepted',
  'acceptedLedger',
  'admitted',
  'admissionApproved',
  'approved',
  'approval',
  'authority',
  'authorityState',
  'ledgerAuthority',
  'ledgerWrite',
  'sourceModelAuthority',
  'writesAcceptedLedger',
]);

export const forbiddenEmbeddedRowKindPrefixes = Object.freeze(['source.', 'admission.', 'accepted.']);
export const forbiddenEmbeddedRowKinds = Object.freeze([
  'source.observation.v1',
  'source.receipt.v1',
  'model_source_reconcile.v1',
]);
export const forbiddenAcceptedLedgerShapeFields = Object.freeze([
  'acceptedDigest',
  'admissionScope',
  'localDevOnly',
  'sourceQueueId',
]);

export const modelQueueOriginKinds = Object.freeze([
  'direct-human.v1',
  'proposal-promotion.v1',
]);

export function normalizeBoundaryToken(value) {
  return typeof value === 'string' ? value.toLowerCase().replaceAll(/[^a-z0-9]/g, '') : '';
}

const queueOnlyAuthorityFields = Object.freeze([
  'acceptedDigest',
  'acceptedRow',
  'admission',
  'admissionScope',
  'localDevOnly',
  'sourceQueueId',
]);
const forbiddenFieldTokens = new Set(
  [...forbiddenAuthorityFields, ...queueOnlyAuthorityFields].map(normalizeBoundaryToken),
);
const allowedFieldTokens = new Set(['nonauthority']);
const forbiddenStatusTokens = new Set(['accepted', 'admitted', 'approved']);

function isForbiddenFieldToken(token) {
  if (allowedFieldTokens.has(token)) return false;
  return forbiddenFieldTokens.has(token)
    || token.startsWith('accepted')
    || token.startsWith('admission')
    || token.startsWith('authority')
    || token.endsWith('authority');
}

function isForbiddenKindToken(token) {
  return token.startsWith('accepted') || token.startsWith('admission');
}

function pathText(path) {
  return path.length === 0 ? '$' : path.join('.');
}

export function findAuthorityBearingShapes(value) {
  const findings = [];
  const ancestors = new Set();

  function add(path, reason, extra = {}) {
    findings.push({ path: pathText(path), segments: [...path], reason, ...extra });
  }

  function visit(node, path) {
    if (node === null || typeof node !== 'object') return;
    if (types.isProxy(node)) {
      add(path, 'scan-failed', { detail: 'proxy-not-allowed' });
      return;
    }
    if (ancestors.has(node)) {
      add(path, 'scan-failed', { detail: 'cycle' });
      return;
    }

    ancestors.add(node);
    let keys;
    try {
      keys = Reflect.ownKeys(node);
    } catch {
      add(path, 'scan-failed', { detail: 'own-keys-failed' });
      ancestors.delete(node);
      return;
    }

    for (const key of keys) {
      if (Array.isArray(node) && key === 'length') continue;
      if (typeof key === 'symbol') {
        add(path, 'scan-failed', { detail: 'symbol-key' });
        continue;
      }

      const fieldPath = [...path, key];
      let descriptor;
      try {
        descriptor = Object.getOwnPropertyDescriptor(node, key);
      } catch {
        add(fieldPath, 'scan-failed', { detail: 'descriptor-read-failed' });
        continue;
      }
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
        add(fieldPath, 'scan-failed', { detail: 'accessor-or-missing-descriptor' });
        continue;
      }

      const token = normalizeBoundaryToken(key);
      if (isForbiddenFieldToken(token)) {
        add(fieldPath, 'forbidden-field', { field: key, normalizedField: token });
      }

      const nested = descriptor.value;
      if (token === 'kind' && typeof nested === 'string') {
        const normalizedKind = normalizeBoundaryToken(nested);
        if (isForbiddenKindToken(normalizedKind)) {
          add(fieldPath, 'forbidden-kind', { value: nested, normalizedValue: normalizedKind });
        }
      }
      if (token === 'status' && typeof nested === 'string') {
        const normalizedStatus = normalizeBoundaryToken(nested);
        if (forbiddenStatusTokens.has(normalizedStatus)) {
          add(fieldPath, 'forbidden-status', { value: nested, normalizedValue: normalizedStatus });
        }
      }
      visit(nested, fieldPath);
    }
    ancestors.delete(node);
  }

  visit(value, []);
  return findings;
}

export const schemaByKind = Object.freeze({
  'hq.modelCommitQueued.v1': Object.freeze({
    required: Object.freeze(['kind', 'id', 'status', 'targetRef', 'op', 'payload', 'confirmedBy', 'origin']),
    status: queueStatuses,
    description: 'human-confirmed model intent row with explicit origin; not accepted authority',
  }),
  'hq.agentTaskQueued.v1': Object.freeze({
    required: Object.freeze(['kind', 'id', 'status', 'targetRef', 'goal', 'confirmedBy']),
    status: queueStatuses,
    description: 'human-confirmed agent task intent row; not proposal or ledger authority',
  }),
  'hq.receipt.v1': Object.freeze({
    required: Object.freeze(['kind', 'id', 'status', 'queueId']),
    status: receiptStatuses,
    description: 'evidence-only receipt row; not accepted authority',
  }),
});
