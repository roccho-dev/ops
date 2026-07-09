import { runLocalWorkerJsonl } from './local-worker.mjs';
import { sha256Digest } from './digest.mjs';

function receiptStatusFromWorkerStatus(status) {
  if (status === 'processed') return 'processed';
  if (status === 'pending') return 'pending';
  if (status === 'ignored') return 'processed';
  return 'failed';
}

function safeQueueId(result) {
  if (typeof result.id === 'string' && result.id.trim().length > 0) {
    return result.id;
  }
  return `line:${result.line}`;
}

function messageFor(result) {
  if (result.status === 'processed') return 'local worker processed model queue intent';
  if (result.status === 'pending') return 'local worker recorded pending agent task intent';
  if (result.status === 'ignored') return result.reason ?? 'local worker ignored evidence-only row';
  return `local worker failed: ${(result.errorCodes ?? []).join(',')}`;
}

export function receiptsFromWorkerResult(workerResult) {
  const stateDigest = sha256Digest(workerResult.state);
  return workerResult.results.map((result) => {
    const queueId = safeQueueId(result);
    const receipt = {
      kind: 'hq.receipt.v1',
      id: `receipt:${queueId}:${result.line}`,
      queueId,
      status: receiptStatusFromWorkerStatus(result.status),
      line: result.line,
      workerStatus: result.status,
      evidenceOnly: true,
      queueDigest: sha256Digest({
        line: result.line,
        queueId,
        kind: result.kind,
        status: result.status,
        outputKind: result.outputKind ?? null,
      }),
      stateDigest,
      outputKind: result.outputKind ?? null,
      message: messageFor(result),
    };

    if (result.kind) receipt.queueKind = result.kind;
    if (Array.isArray(result.errorCodes) && result.errorCodes.length > 0) {
      receipt.errorCodes = result.errorCodes;
    }

    return receipt;
  });
}

export function runLocalWorkerWithReceiptsJsonl(text) {
  const worker = runLocalWorkerJsonl(text);
  const receipts = receiptsFromWorkerResult(worker);
  return {
    ok: worker.ok,
    records: worker.records,
    receipts: receipts.length,
    worker,
    receiptRows: receipts,
    receiptDigest: sha256Digest(receipts),
  };
}

export function receiptsToJsonl(receipts) {
  return `${receipts.map((receipt) => JSON.stringify(receipt)).join('\n')}\n`;
}
