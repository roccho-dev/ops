import { runAdmissionGateJsonl } from './admission-gate.mjs';
import { sha256Digest } from './digest.mjs';

const CREATED_AT = '2026-07-09T00:00:00Z';
const SCHEMA_VERSION = 'contract.meta.v1';
const PURPOSE_LEVEL = 'purpose';
const AUTHORITY = 'projection_runner';

function contractEvent(base) {
  return {
    schema_version: SCHEMA_VERSION,
    created_at: CREATED_AT,
    purpose_level: PURPOSE_LEVEL,
    authority: AUTHORITY,
    ...base,
  };
}

export function hqAcceptedContractBaseLedger() {
  return [
    contractEvent({
      kind: 'contract.schema.v1',
      event_id: 'evt_hqacc_schema',
      schema_id: 'accepted_model_commit.v1',
      title: 'Local dev accepted hq model commit candidate',
      lifecycle: 'active',
    }),
    contractEvent({
      kind: 'contract.field.v1',
      event_id: 'evt_hqacc_srcqid',
      schema_id: 'accepted_model_commit.v1',
      field_id: 'source_queue_id',
      field_type: 'id',
      required: true,
      pii: false,
      description: 'Source hq.modelCommitQueued.v1 id.',
    }),
    contractEvent({
      kind: 'contract.field.v1',
      event_id: 'evt_hqacc_target',
      schema_id: 'accepted_model_commit.v1',
      field_id: 'target_ref_id',
      field_type: 'id',
      required: true,
      pii: false,
      description: 'TargetRef id from the admitted local-dev model commit.',
    }),
    contractEvent({
      kind: 'contract.field.v1',
      event_id: 'evt_hqacc_op',
      schema_id: 'accepted_model_commit.v1',
      field_id: 'op',
      field_type: 'string',
      required: true,
      pii: false,
      description: 'Model operation name.',
    }),
    contractEvent({
      kind: 'contract.field.v1',
      event_id: 'evt_hqacc_qdigest',
      schema_id: 'accepted_model_commit.v1',
      field_id: 'queue_digest',
      field_type: 'hash',
      required: true,
      pii: false,
      description: 'Digest of the source queue row.',
    }),
    contractEvent({
      kind: 'contract.field.v1',
      event_id: 'evt_hqacc_adigest',
      schema_id: 'accepted_model_commit.v1',
      field_id: 'accepted_digest',
      field_type: 'hash',
      required: true,
      pii: false,
      description: 'Digest of the accepted-ledger-shaped local-dev row.',
    }),
  ];
}

function stableEventSuffix(value) {
  return sha256Digest(value).slice('sha256:'.length, 'sha256:'.length + 16);
}

export function contractEventsForAcceptedRows(acceptedRows) {
  return acceptedRows.flatMap((row, index) => {
    const suffix = stableEventSuffix({ row, index });
    const queryId = `q_hqacc_${suffix}.v1`;
    const fixtureId = `fx_hqacc_${suffix}`;
    return [
      contractEvent({
        kind: 'contract.query.v1',
        event_id: `evt_hqacc_q_${suffix}`,
        query_id: queryId,
        query_family: 'hqacc',
        input_fields: [
          'accepted_model_commit.v1#source_queue_id',
          'accepted_model_commit.v1#target_ref_id',
          'accepted_model_commit.v1#op',
          'accepted_model_commit.v1#queue_digest',
          'accepted_model_commit.v1#accepted_digest',
        ],
        output_schema: 'accepted_model_commit.v1',
        runner_kind: 'generated',
        projection_only: true,
        side_effects: false,
        fixture_ids: [fixtureId],
        expected_output_hash: row.acceptedDigest,
      }),
      contractEvent({
        kind: 'contract.fixture.v1',
        event_id: `evt_hqacc_fx_${suffix}`,
        fixture_id: fixtureId,
        target_query_id: queryId,
        polarity: 'positive',
        payload_hash: row.acceptedDigest,
      }),
    ];
  });
}

export function hqAdmissionToCueAppendPacket(queueJsonl) {
  const admission = runAdmissionGateJsonl(queueJsonl);
  const baseLedger = hqAcceptedContractBaseLedger();
  const appendedEvents = contractEventsForAcceptedRows(admission.acceptedRows);
  const candidateLedger = [...baseLedger, ...appendedEvents];
  const packet = {
    kind: 'hq.cueAppendContract.packet.v1',
    evidenceOnly: true,
    nonAuthority: true,
    admission: {
      ok: admission.ok,
      records: admission.records,
      admitted: admission.admitted,
      rejected: admission.rejected,
      ledgerDigest: admission.ledgerDigest,
    },
    baseLedger,
    candidateLedger,
    appendedEvents,
    baseLedgerDigest: sha256Digest(baseLedger),
    candidateLedgerDigest: sha256Digest(candidateLedger),
    acceptedRowsDigest: sha256Digest(admission.acceptedRows),
  };
  return {
    ...packet,
    packetDigest: sha256Digest(packet),
  };
}

export function cueAppendReceipt({ packet, validateResult = null, appendOnlyResult = null, rewriteResult = null }) {
  const receipt = {
    kind: 'hq.cueAppendContract.receipt.v1',
    evidenceOnly: true,
    nonAuthority: true,
    packetDigest: packet.packetDigest,
    admissionLedgerDigest: packet.admission.ledgerDigest,
    baseLedgerDigest: packet.baseLedgerDigest,
    candidateLedgerDigest: packet.candidateLedgerDigest,
    acceptedRowsDigest: packet.acceptedRowsDigest,
    validateStatus: validateResult?.status ?? null,
    appendOnlyStatus: appendOnlyResult?.status ?? null,
    rewriteRejectStatus: rewriteResult?.status ?? null,
  };
  return {
    ...receipt,
    receiptDigest: sha256Digest(receipt),
  };
}

export function rowsToJsonl(rows) {
  return `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
}
