export const reconcileKinds = Object.freeze([
  'model_source_reconcile.v1',
  'modelSourceReconcile.projection.v1',
]);

export const reconcileResults = Object.freeze([
  'matched',
  'missing_source_observation',
  'conflict',
  'stale_source_receipt',
  'invalid_source_receipt',
]);

export const reconcileStatuses = Object.freeze([
  'checked',
]);

export const reconcileSchema = Object.freeze({
  kind: 'model_source_reconcile.v1',
  required: Object.freeze([
    'kind',
    'id',
    'status',
    'modelRef',
    'sourceRef',
    'reconcileType',
    'result',
    'modelDigest',
    'sourceDigest',
    'receiptDigest',
    'reconcileDigest',
    'evidenceOnly',
    'nonAuthority',
  ]),
});
