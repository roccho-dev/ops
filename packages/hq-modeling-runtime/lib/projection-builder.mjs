import { sha256Digest } from './digest.mjs';
import { runLocalWorkerWithReceiptsJsonl } from './receipt-writer.mjs';

function ensureNode(nodes, id, kind = 'package') {
  if (!nodes.has(id)) {
    nodes.set(id, { id, kind, label: id, evidenceOnly: true });
  }
  return nodes.get(id);
}

function edgeFromOperation(operation) {
  if (operation.op !== 'addEdge') return null;
  const { from, to, type } = operation.payload ?? {};
  if (typeof from !== 'string' || typeof to !== 'string') return null;
  return {
    id: `edge:${from}->${to}:${type ?? 'related'}`,
    from,
    to,
    type: type ?? 'related',
    sourceQueueId: operation.queueId,
    evidenceOnly: true,
  };
}

export function buildRepoMapProjection(workerReceiptResult) {
  const nodes = new Map();
  const edges = [];

  for (const operation of workerReceiptResult.worker.state.modelOperations) {
    if (operation.targetRef?.id) {
      ensureNode(nodes, operation.targetRef.id, operation.targetRef.kind ?? 'target');
    }

    const edge = edgeFromOperation(operation);
    if (edge) {
      ensureNode(nodes, edge.from);
      ensureNode(nodes, edge.to);
      edges.push(edge);
    }
  }

  const projection = {
    kind: 'repoMap.projection.v1',
    projectionId: 'repoMap.localShadow.v1',
    generatedBy: 'hq-modeling-runtime',
    evidenceOnly: true,
    nonAuthority: true,
    source: {
      records: workerReceiptResult.records,
      receiptDigest: workerReceiptResult.receiptDigest,
      stateDigest: sha256Digest(workerReceiptResult.worker.state),
    },
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: edges.sort((a, b) => a.id.localeCompare(b.id)),
    pendingAgentTasks: workerReceiptResult.worker.state.agentTasks.map((task) => ({
      queueId: task.queueId,
      targetRef: task.targetRef,
      goal: task.goal,
      status: task.status,
      evidenceOnly: true,
    })),
    receipts: workerReceiptResult.receiptRows.map((receipt) => ({
      id: receipt.id,
      queueId: receipt.queueId,
      status: receipt.status,
      queueDigest: receipt.queueDigest,
    })),
    errors: workerReceiptResult.worker.errors,
  };

  return {
    ok: workerReceiptResult.ok,
    projection: {
      ...projection,
      projectionDigest: sha256Digest(projection),
    },
  };
}

export function buildRepoMapProjectionFromQueueJsonl(text) {
  return buildRepoMapProjection(runLocalWorkerWithReceiptsJsonl(text));
}
