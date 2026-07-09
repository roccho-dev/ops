export const queueKinds = Object.freeze([
  'hq.modelCommitQueued.v1',
  'hq.agentTaskQueued.v1',
  'hq.receipt.v1',
]);

export const queueStatuses = Object.freeze([
  'queued',
]);

export const receiptStatuses = Object.freeze([
  'processed',
  'pending',
  'failed',
]);

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

export const schemaByKind = Object.freeze({
  'hq.modelCommitQueued.v1': Object.freeze({
    required: Object.freeze(['kind', 'id', 'status', 'targetRef', 'op', 'payload', 'confirmedBy']),
    status: queueStatuses,
    description: 'human-confirmed model intent row; not accepted authority',
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
