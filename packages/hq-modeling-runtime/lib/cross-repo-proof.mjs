import { sha256Digest } from './digest.mjs';
import { runLocalWorkerWithReceiptsJsonl } from './receipt-writer.mjs';
import { validateRecord } from './queue-validator.mjs';

export function proveTargetRefQueueWorker({ targetRef, queueRow }) {
  const errors = [];
  const targetRefDigest = sha256Digest(targetRef);
  const queueDigest = sha256Digest(queueRow);

  if (JSON.stringify(queueRow.targetRef) !== JSON.stringify(targetRef)) {
    errors.push({
      code: 'targetRef-mismatch',
      message: 'queue row targetRef does not match ui targetRef fixture',
      targetRefDigest,
      queueDigest,
    });
  }

  const validationErrors = validateRecord(queueRow);
  errors.push(...validationErrors);

  const worker = validationErrors.length === 0
    ? runLocalWorkerWithReceiptsJsonl(JSON.stringify(queueRow))
    : null;

  const receipt = worker?.receiptRows?.[0] ?? null;
  if (worker && !receipt) {
    errors.push({ code: 'worker-receipt-missing', message: 'worker did not emit receipt' });
  }

  const proof = {
    kind: 'crossRepo.targetRefQueueWorkerProof.v1',
    evidenceOnly: true,
    nonAuthority: true,
    targetRefDigest,
    queueDigest,
    workerReceiptDigest: receipt ? sha256Digest(receipt) : null,
    workerStatus: receipt?.status ?? null,
    queueId: queueRow?.id ?? null,
    targetRef,
    errors,
  };

  return {
    ok: errors.length === 0,
    proof: {
      ...proof,
      proofDigest: sha256Digest(proof),
    },
  };
}
