import { sha256Digest } from './digest.mjs';
import { buildRepoMapProjectionFromQueueJsonl } from './projection-builder.mjs';

export function projectionPreviewArtifact(projection) {
  return {
    kind: 'ui.previewArtifact.v1',
    evidenceOnly: true,
    nonAuthority: true,
    inputKind: projection.kind,
    projectionId: projection.projectionId,
    projectionDigest: projection.projectionDigest,
    nodeCount: projection.nodes.length,
    edgeCount: projection.edges.length,
    pendingAgentTaskCount: projection.pendingAgentTasks.length,
    previewModel: {
      nodes: projection.nodes.map((node) => ({ id: node.id, label: node.label, kind: node.kind })),
      edges: projection.edges.map((edge) => ({ id: edge.id, from: edge.from, to: edge.to, type: edge.type })),
    },
  };
}

export function proveProjectionToUiPreview(queueJsonl) {
  const projectionResult = buildRepoMapProjectionFromQueueJsonl(queueJsonl);
  const preview = projectionPreviewArtifact(projectionResult.projection);
  const proof = {
    kind: 'crossRepo.opsProjectionUiPreviewProof.v1',
    evidenceOnly: true,
    nonAuthority: true,
    projectionDigest: projectionResult.projection.projectionDigest,
    previewDigest: sha256Digest(preview),
    projectionKind: projectionResult.projection.kind,
    previewKind: preview.kind,
    ok: projectionResult.ok,
    preview,
    errors: projectionResult.projection.errors,
  };

  return {
    ok: projectionResult.ok,
    proof: {
      ...proof,
      proofDigest: sha256Digest(proof),
    },
  };
}
