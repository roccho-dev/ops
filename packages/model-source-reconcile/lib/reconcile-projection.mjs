import { sha256Digest } from './digest.mjs';
import { checkModelSourceReconcile } from './reconcile-checker.mjs';

export function buildReconcileProjection({ modelProjection, sourceObservations = [], sourceReceipts = [] }) {
  const result = checkModelSourceReconcile({ modelProjection, sourceObservations, sourceReceipts });
  const projection = {
    kind: 'modelSourceReconcile.projection.v1',
    projectionId: 'modelSourceReconcile.localShadow.v1',
    generatedBy: 'model-source-reconcile',
    evidenceOnly: true,
    nonAuthority: true,
    layers: {
      model: {
        kind: 'model.layer.v1',
        projectionId: modelProjection?.projectionId ?? null,
        modelDigest: modelProjection?.projectionDigest ?? sha256Digest(modelProjection),
        nodes: modelProjection?.nodes ?? [],
        edges: modelProjection?.edges ?? [],
      },
      source: {
        kind: 'source.layer.v1',
        observations: sourceObservations.map((row) => ({
          id: row.id,
          status: row.status,
          subjectRef: row.subjectRef,
          sourceRef: row.sourceRef,
          observedDigest: row.observedDigest,
        })),
        receipts: sourceReceipts.map((row) => ({
          id: row.id,
          observationId: row.observationId,
          status: row.status,
          observedDigest: row.observedDigest,
          receiptDigest: row.receiptDigest,
        })),
        sourceDigest: sha256Digest({ sourceObservations, sourceReceipts }),
      },
      reconcile: {
        kind: 'reconcile.layer.v1',
        rows: result.rows,
        checked: result.checked,
        reconcileDigest: result.reconcileDigest,
      },
    },
    errors: result.errors,
  };

  return {
    ok: result.ok,
    projection: {
      ...projection,
      projectionDigest: sha256Digest(projection),
    },
  };
}
