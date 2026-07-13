export const sourceKinds = Object.freeze([
  'source.observation.v1',
  'source.receipt.v1',
]);

export const observationStatuses = Object.freeze([
  'observed',
  'missing',
  'failed',
]);

export const receiptStatuses = Object.freeze([
  'observed',
  'missing',
  'failed',
]);

export const sourceSurfaces = Object.freeze([
  'github',
  'local',
  'remote-bare',
  'fixture',
]);

export const forbiddenSourceAuthorityFields = Object.freeze([
  'accepted',
  'acceptedLedger',
  'admitted',
  'admissionApproved',
  'approval',
  'authority',
  'authorityState',
  'ledgerAuthority',
  'ledgerWrite',
  'productionAuthority',
  'sourceModelAuthority',
  'writesAcceptedLedger',
]);

export const schemaByKind = Object.freeze({
  'source.observation.v1': Object.freeze({
    required: Object.freeze([
      'kind',
      'id',
      'status',
      'surface',
      'observedAt',
      'subjectRef',
      'sourceRef',
      'observation',
      'observedDigest',
    ]),
    status: observationStatuses,
    description: 'evidence-only real-world source observation',
  }),
  'source.receipt.v1': Object.freeze({
    required: Object.freeze([
      'kind',
      'id',
      'status',
      'observationId',
      'surface',
      'observedDigest',
      'receiptDigest',
      'evidenceOnly',
    ]),
    status: receiptStatuses,
    description: 'deterministic evidence-only source observation receipt',
  }),
});
