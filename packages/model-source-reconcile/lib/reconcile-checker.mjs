import { reconcileResults } from './reconcile-schema.mjs';
import { sha256Digest } from './digest.mjs';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function refId(value) {
  return isPlainObject(value) && typeof value.id === 'string' ? value.id : null;
}

function withoutKey(record, keyToRemove) {
  const { [keyToRemove]: _removed, ...rest } = record;
  return rest;
}

function expectedObservedDigest(record) {
  return sha256Digest(withoutKey(record, 'observedDigest'));
}

function expectedReceiptDigest(record) {
  return sha256Digest(withoutKey(record, 'receiptDigest'));
}

function observationKey(subjectId, sourceId) {
  return `${subjectId}\u0000${sourceId}`;
}

function isLocationExpectation(edge) {
  return edge?.type === 'located_in'
    || (typeof edge?.from === 'string' && edge.from.startsWith('package:')
      && typeof edge?.to === 'string' && edge.to.startsWith('repo:'));
}

function modelDigest(modelProjection) {
  return typeof modelProjection?.projectionDigest === 'string'
    ? modelProjection.projectionDigest
    : sha256Digest(modelProjection);
}

function baseSourceRef(edge, observation = null) {
  return {
    kind: 'source.expectation.v1',
    subjectRef: { kind: 'package', id: edge.from },
    sourceRef: { kind: 'repo', id: edge.to },
    observationId: observation?.id ?? null,
  };
}

function receiptFor(observation, receipts) {
  return receipts.find((receipt) => receipt.observationId === observation.id) ?? null;
}

function classifyReceipt(observation, receipt) {
  if (!receipt) {
    return { ok: false, result: 'invalid_source_receipt', reason: 'missing source receipt' };
  }

  if (observation.observedDigest !== expectedObservedDigest(observation)) {
    return { ok: false, result: 'stale_source_receipt', reason: 'observation digest mismatch' };
  }

  if (receipt.observedDigest !== observation.observedDigest) {
    return { ok: false, result: 'stale_source_receipt', reason: 'receipt observedDigest does not match observation' };
  }
  if (receipt.receiptDigest !== expectedReceiptDigest(receipt)) {
    return { ok: false, result: 'invalid_source_receipt', reason: 'receipt digest mismatch' };
  }
  if (receipt.evidenceOnly !== true) {
    return { ok: false, result: 'invalid_source_receipt', reason: 'source receipt is not evidenceOnly' };
  }

  return { ok: true, result: 'matched', reason: 'source receipt matches observation' };
}

function reconcileRow({ edge, result, modelProjection, observation = null, receipt = null, reason }) {
  if (!reconcileResults.includes(result)) {
    throw new Error(`unsupported reconcile result: ${result}`);
  }

  const base = {
    kind: 'model_source_reconcile.v1',
    id: `reconcile:${edge.id ?? `${edge.from}->${edge.to}:${edge.type ?? 'located_in'}`}`,
    status: 'checked',
    modelRef: {
      kind: 'repoMap.edge',
      id: edge.id ?? null,
      from: edge.from,
      to: edge.to,
      type: edge.type ?? 'located_in',
      sourceQueueId: edge.sourceQueueId ?? null,
    },
    sourceRef: baseSourceRef(edge, observation),
    reconcileType: 'package-location',
    result,
    reason,
    modelDigest: modelDigest(modelProjection),
    sourceDigest: observation?.observedDigest ?? sha256Digest({ subjectRef: edge.from, sourceRef: edge.to, missing: true }),
    receiptDigest: receipt?.receiptDigest ?? null,
    evidenceOnly: true,
    nonAuthority: true,
  };

  return {
    ...base,
    reconcileDigest: sha256Digest(base),
  };
}

export function checkModelSourceReconcile({ modelProjection, sourceObservations = [], sourceReceipts = [] }) {
  const errors = [];
  const rows = [];

  if (!isPlainObject(modelProjection)) {
    errors.push({ code: 'model-projection-not-object', message: 'model projection must be an object' });
    return { ok: false, checked: 0, rows, errors, reconcileDigest: sha256Digest(rows) };
  }

  if (!Array.isArray(modelProjection.edges)) {
    errors.push({ code: 'model-projection-edges-not-array', message: 'model projection edges must be an array' });
    return { ok: false, checked: 0, rows, errors, reconcileDigest: sha256Digest(rows) };
  }

  const observationByKey = new Map();
  const observedBySubject = new Map();
  for (const observation of sourceObservations) {
    if (observation?.kind !== 'source.observation.v1') continue;
    const subjectId = refId(observation.subjectRef);
    const sourceId = refId(observation.sourceRef);
    if (!subjectId || !sourceId) continue;
    observationByKey.set(observationKey(subjectId, sourceId), observation);
    if (observation.status === 'observed') {
      if (!observedBySubject.has(subjectId)) observedBySubject.set(subjectId, []);
      observedBySubject.get(subjectId).push(observation);
    }
  }

  for (const edge of modelProjection.edges.filter(isLocationExpectation)) {
    const exact = observationByKey.get(observationKey(edge.from, edge.to));
    const alternatives = (observedBySubject.get(edge.from) ?? []).filter((entry) => refId(entry.sourceRef) !== edge.to);

    if (!exact && alternatives.length > 0) {
      const observation = alternatives[0];
      const receipt = receiptFor(observation, sourceReceipts);
      rows.push(reconcileRow({
        edge,
        result: 'conflict',
        modelProjection,
        observation,
        receipt,
        reason: `source observed ${edge.from} in ${refId(observation.sourceRef)} instead of ${edge.to}`,
      }));
      continue;
    }

    if (!exact || exact.status === 'missing') {
      rows.push(reconcileRow({
        edge,
        result: 'missing_source_observation',
        modelProjection,
        observation: exact ?? null,
        receipt: exact ? receiptFor(exact, sourceReceipts) : null,
        reason: exact ? 'source observation reports missing' : 'no source observation for model expectation',
      }));
      continue;
    }

    const receipt = receiptFor(exact, sourceReceipts);
    const receiptStatus = classifyReceipt(exact, receipt);
    if (!receiptStatus.ok) {
      rows.push(reconcileRow({
        edge,
        result: receiptStatus.result,
        modelProjection,
        observation: exact,
        receipt,
        reason: receiptStatus.reason,
      }));
      continue;
    }

    rows.push(reconcileRow({
      edge,
      result: 'matched',
      modelProjection,
      observation: exact,
      receipt,
      reason: 'model expectation matched source observation and receipt',
    }));
  }

  const failed = rows.filter((row) => row.result !== 'matched');
  return {
    ok: errors.length === 0 && failed.length === 0,
    checked: rows.length,
    rows,
    errors,
    reconcileDigest: sha256Digest(rows),
  };
}
