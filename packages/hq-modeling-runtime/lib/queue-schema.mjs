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

const exactForbiddenFieldTokens = new Set([
  ...forbiddenAuthorityFields,
  ...forbiddenAcceptedLedgerShapeFields,
  'acceptedRow',
  'admission',
  'modelQueueRow',
].map(normalizeBoundaryToken));

const authorityConceptFragments = Object.freeze([
  'accepted',
  'admission',
  'admit',
  'approval',
  'approve',
  'authority',
  'authorization',
  'authorisation',
]);

const allowedAuthorityFieldValues = new Map([
  ['nonauthority', true],
]);

function authorityConcept(token) {
  return authorityConceptFragments.find((fragment) => token.includes(fragment)) ?? null;
}

function pathText(path) {
  return path.length === 0 ? '$' : path.join('.');
}

function pointer(path) {
  if (path.length === 0) return '/';
  return `/${path
    .map((segment) => String(segment).replaceAll('~', '~0').replaceAll('/', '~1'))
    .join('/')}`;
}

function addDataFinding(errors, path, reason, extra = {}) {
  const jsonPointer = pointer(path);
  if (errors.some((error) => error.path === jsonPointer && error.reason === reason)) return;
  errors.push({ path: jsonPointer, segments: [...path], reason, ...extra });
}

function defineData(target, key, value) {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

export function snapshotJsonData(input) {
  const errors = [];
  const active = new Set();
  let root;
  const stack = [{ type: 'visit', value: input, path: [], assign: (value) => { root = value; } }];

  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame.type === 'exit') {
      active.delete(frame.value);
      continue;
    }

    const { value, path, assign } = frame;
    if (value === null) {
      assign(null);
      continue;
    }

    const valueType = typeof value;
    if (valueType === 'string' || valueType === 'boolean') {
      assign(value);
      continue;
    }
    if (valueType === 'number') {
      if (!Number.isFinite(value)) addDataFinding(errors, path, 'non-finite-number');
      else if (Object.is(value, -0)) addDataFinding(errors, path, 'negative-zero');
      else assign(value);
      continue;
    }
    if (valueType === 'undefined' || valueType === 'bigint' || valueType === 'function' || valueType === 'symbol') {
      addDataFinding(errors, path, valueType);
      continue;
    }
    if (valueType !== 'object') {
      addDataFinding(errors, path, `unsupported-${valueType}`);
      continue;
    }

    if (types.isProxy(value)) {
      addDataFinding(errors, path, 'proxy-not-allowed');
      continue;
    }
    if (active.has(value)) {
      addDataFinding(errors, path, 'cycle');
      continue;
    }

    const array = Array.isArray(value);
    let prototype;
    try {
      prototype = Object.getPrototypeOf(value);
    } catch {
      addDataFinding(errors, path, 'prototype-read-failed');
      continue;
    }
    if ((array && prototype !== Array.prototype)
      || (!array && prototype !== Object.prototype && prototype !== null)) {
      addDataFinding(errors, path, 'non-plain-object');
      continue;
    }

    let keys;
    try {
      keys = Reflect.ownKeys(value);
    } catch {
      addDataFinding(errors, path, 'property-enumeration-failed');
      continue;
    }

    const entries = [];
    let nodeInvalid = false;
    let arrayLength = null;
    for (const key of keys) {
      let descriptor;
      try {
        descriptor = Object.getOwnPropertyDescriptor(value, key);
      } catch {
        addDataFinding(errors, [...path, typeof key === 'symbol' ? '<symbol>' : key], 'property-descriptor-read-failed');
        nodeInvalid = true;
        continue;
      }
      if (!descriptor) {
        addDataFinding(errors, [...path, typeof key === 'symbol' ? '<symbol>' : key], 'property-descriptor-missing');
        nodeInvalid = true;
        continue;
      }

      if (array && key === 'length') {
        if (!Object.hasOwn(descriptor, 'value')
          || !Number.isInteger(descriptor.value)
          || descriptor.value < 0
          || descriptor.value > 4_294_967_295) {
          addDataFinding(errors, path, 'array-length-invalid');
          nodeInvalid = true;
        } else {
          arrayLength = descriptor.value;
        }
        continue;
      }

      if (typeof key === 'symbol') {
        addDataFinding(errors, path, 'symbol-key', { symbol: key.description ?? null });
        nodeInvalid = true;
        continue;
      }
      if (descriptor.enumerable !== true) {
        addDataFinding(errors, [...path, key], 'non-enumerable-property');
        nodeInvalid = true;
        continue;
      }
      if (!Object.hasOwn(descriptor, 'value')) {
        addDataFinding(errors, [...path, key], 'accessor-property');
        nodeInvalid = true;
        continue;
      }
      entries.push({ key, value: descriptor.value });
    }

    if (array) {
      if (arrayLength === null) {
        addDataFinding(errors, path, 'array-length-missing');
        nodeInvalid = true;
      } else {
        const indexed = [];
        for (const entry of entries) {
          const index = Number(entry.key);
          const canonical = Number.isInteger(index)
            && index >= 0
            && index < arrayLength
            && String(index) === entry.key;
          if (!canonical) {
            addDataFinding(errors, [...path, entry.key], 'extra-array-property');
            nodeInvalid = true;
          } else {
            indexed.push({ ...entry, index });
          }
        }
        indexed.sort((left, right) => left.index - right.index);
        let expected = 0;
        for (const entry of indexed) {
          if (entry.index !== expected) break;
          expected += 1;
        }
        if (expected !== arrayLength) {
          addDataFinding(errors, [...path, String(expected)], 'sparse-array-hole');
          nodeInvalid = true;
        }
        entries.length = 0;
        entries.push(...indexed.map(({ key, value: nested }) => ({ key, value: nested })));
      }
    }

    if (nodeInvalid) continue;

    const snapshot = array
      ? new Array(arrayLength)
      : (prototype === null ? Object.create(null) : {});
    assign(snapshot);
    active.add(value);
    stack.push({ type: 'exit', value });
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      stack.push({
        type: 'visit',
        value: entry.value,
        path: [...path, entry.key],
        assign: (nested) => defineData(snapshot, entry.key, nested),
      });
    }
  }

  return {
    ok: errors.length === 0,
    value: errors.length === 0 ? root : null,
    errors,
  };
}

function allowedAuthorityField(token, value) {
  return allowedAuthorityFieldValues.has(token)
    && Object.is(allowedAuthorityFieldValues.get(token), value);
}

function forbiddenFieldConcept(token, value) {
  if (allowedAuthorityField(token, value)) return null;
  if (exactForbiddenFieldTokens.has(token)) return token;
  return authorityConcept(token);
}

export function findAuthorityBearingShapes(value) {
  const findings = [];
  const stack = [{ node: value, path: [] }];

  while (stack.length > 0) {
    const { node, path } = stack.pop();
    if (node === null || typeof node !== 'object') continue;
    if (types.isProxy(node)) {
      findings.push({ path: pathText(path), segments: [...path], reason: 'scan-failed', detail: 'proxy-not-allowed' });
      continue;
    }

    let keys;
    try {
      keys = Reflect.ownKeys(node);
    } catch {
      findings.push({ path: pathText(path), segments: [...path], reason: 'scan-failed', detail: 'own-keys-failed' });
      continue;
    }

    for (const key of keys) {
      if (Array.isArray(node) && key === 'length') continue;
      if (typeof key === 'symbol') {
        findings.push({ path: pathText(path), segments: [...path], reason: 'scan-failed', detail: 'symbol-key' });
        continue;
      }

      const fieldPath = [...path, key];
      let descriptor;
      try {
        descriptor = Object.getOwnPropertyDescriptor(node, key);
      } catch {
        findings.push({ path: pathText(fieldPath), segments: fieldPath, reason: 'scan-failed', detail: 'descriptor-read-failed' });
        continue;
      }
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
        findings.push({ path: pathText(fieldPath), segments: fieldPath, reason: 'scan-failed', detail: 'accessor-or-missing-descriptor' });
        continue;
      }

      const nested = descriptor.value;
      const token = normalizeBoundaryToken(key);
      const fieldConcept = forbiddenFieldConcept(token, nested);
      if (fieldConcept) {
        findings.push({
          path: pathText(fieldPath),
          segments: fieldPath,
          reason: 'forbidden-field',
          field: key,
          normalizedField: token,
          concept: fieldConcept,
        });
      }

      if ((token === 'kind' || token === 'status') && typeof nested === 'string') {
        const normalizedValue = normalizeBoundaryToken(nested);
        const concept = authorityConcept(normalizedValue);
        if (concept) {
          findings.push({
            path: pathText(fieldPath),
            segments: fieldPath,
            reason: token === 'kind' ? 'forbidden-kind' : 'forbidden-status',
            value: nested,
            normalizedValue,
            concept,
          });
        }
      }

      if (nested !== null && typeof nested === 'object') {
        stack.push({ node: nested, path: fieldPath });
      }
    }
  }

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
