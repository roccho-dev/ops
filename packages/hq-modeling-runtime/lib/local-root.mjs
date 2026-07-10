import { sha256Digest } from './digest.mjs';

export const localRootKind = 'hq.localRoot.catalog.v1';

export const localRootCatalog = Object.freeze([
  Object.freeze({ area: 'queues', path: 'queues/hq.model-commit.queue.jsonl', role: 'model commit queue intent', authority: false }),
  Object.freeze({ area: 'queues', path: 'queues/hq.agent-task.queue.jsonl', role: 'agent task queue intent', authority: false }),
  Object.freeze({ area: 'queues', path: 'queues/hq.host-command.queue.jsonl', role: 'confirmed local host command intent', authority: false }),
  Object.freeze({ area: 'state', path: 'state/shadow-model.v1.jsonl', role: 'recoverable local shadow state', authority: false }),
  Object.freeze({ area: 'state', path: 'state/agent-task-state.v1.jsonl', role: 'recoverable pending agent task state', authority: false }),
  Object.freeze({ area: 'proposals', path: 'proposals/modeling.proposal.v1.jsonl', role: 'proposal evidence', authority: false }),
  Object.freeze({ area: 'ledgers', path: 'ledgers/staged.accepted.model-commit.v1.jsonl', role: 'local staged accepted output', authority: false }),
  Object.freeze({ area: 'projections', path: 'projections/repoMap.projection.v1.json', role: 'generated read model', authority: false }),
  Object.freeze({ area: 'projections', path: 'projections/repoMap.projection.v1.jsonl', role: 'generated read model rows', authority: false }),
  Object.freeze({ area: 'receipts', path: 'receipts/hq.receipt.v1.jsonl', role: 'worker evidence receipt', authority: false }),
  Object.freeze({ area: 'receipts', path: 'receipts/hq.host-command.receipt.jsonl', role: 'host command launch evidence', authority: false }),
  Object.freeze({ area: 'receipts', path: 'receipts/admission.receipt.v1.jsonl', role: 'local admission evidence receipt', authority: false }),
  Object.freeze({ area: 'receipts', path: 'receipts/cross-repo.editor-to-ui.receipt.v1.jsonl', role: 'cross-repo evidence receipt', authority: false }),
  Object.freeze({ area: 'previews', path: 'previews/repo-map/index.html', role: 'localhost preview artifact', authority: false }),
  Object.freeze({ area: 'previews', path: 'previews/repo-map/manifest.json', role: 'localhost preview manifest', authority: false }),
  Object.freeze({ area: 'cache', path: 'cache/github-readback/', role: 'GitHub readback cache', authority: false }),
  Object.freeze({ area: 'cache', path: 'cache/ssot-mirror/', role: 'remote SSOT mirror cache', authority: false }),
]);

export const localOnlyHosts = Object.freeze(['127.0.0.1', '::1', 'localhost']);

export function catalogSummary() {
  return {
    kind: localRootKind,
    authority: false,
    canonicalAuthority: 'remote bare repo after accepted promotion and readback',
    localRootIsSsot: false,
    entries: localRootCatalog.map((entry) => ({ ...entry })),
  };
}

export function normalizeRelativePath(path) {
  if (typeof path !== 'string') {
    return '';
  }
  return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/g, '');
}

export function classifyLocalRootPath(path) {
  const normalized = normalizeRelativePath(path);
  for (const entry of localRootCatalog) {
    const isDirectoryEntry = typeof entry.path === 'string' && entry.path.endsWith('/');
    const catalogPath = normalizeRelativePath(entry.path);
    if (isDirectoryEntry) {
      if (normalized === catalogPath || normalized.startsWith(`${catalogPath}/`)) {
        return { ok: true, normalizedPath: normalized, entry: { ...entry }, authority: false };
      }
    } else if (normalized === catalogPath) {
      return { ok: true, normalizedPath: normalized, entry: { ...entry }, authority: false };
    }
  }
  return {
    ok: false,
    normalizedPath: normalized,
    authority: false,
    error: 'unknown-local-root-path',
  };
}

export function validateLocalEndpoint({ host, socketPath } = {}) {
  if (typeof socketPath === 'string' && socketPath.trim().length > 0) {
    return { ok: true, transport: 'unix-socket', socketPath, authority: false };
  }
  const requestedHost = host || '127.0.0.1';
  if (!localOnlyHosts.includes(requestedHost)) {
    return {
      ok: false,
      transport: 'tcp',
      host: requestedHost,
      authority: false,
      error: 'non-local-endpoint-rejected',
    };
  }
  return { ok: true, transport: 'tcp', host: requestedHost, authority: false };
}

export function isGeneratedLocalRuntimePath(repoPath) {
  const normalized = normalizeRelativePath(repoPath);
  return normalized.startsWith('.local/hq/') || normalized.startsWith('.hq/local/') || normalized === '.local/hq' || normalized === '.hq/local';
}

export function buildServeLocalPlan({ root = '$HQ_LOCAL_ROOT', host = '127.0.0.1', port = 0, socketPath } = {}) {
  const endpoint = validateLocalEndpoint({ host, socketPath });
  const plan = {
    kind: 'hq.serveLocal.plan.v1',
    mode: 'local',
    root,
    endpoint,
    catalogDigest: sha256Digest(localRootCatalog),
    authority: false,
    localRootIsSsot: false,
    remoteServerIntroduced: false,
    message: endpoint.ok ? 'local serve plan accepted' : 'local serve plan rejected',
  };
  if (endpoint.ok && endpoint.transport === 'tcp') {
    plan.endpoint.port = port;
  }
  return { ok: endpoint.ok, plan, errors: endpoint.ok ? [] : [endpoint.error] };
}

function countNonEmptyJsonlRows(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return 0;
  }
  return text.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

export function buildLocalStatus({ root = '$HQ_LOCAL_ROOT', files = {}, endpoint = { host: '127.0.0.1' } } = {}) {
  const serve = buildServeLocalPlan({ root, ...endpoint });
  const queueText = files['queues/hq.model-commit.queue.jsonl'] || '';
  const agentText = files['queues/hq.agent-task.queue.jsonl'] || '';
  const hostCommandText = files['queues/hq.host-command.queue.jsonl'] || '';
  const receiptText = files['receipts/hq.receipt.v1.jsonl'] || '';
  const hostReceiptText = files['receipts/hq.host-command.receipt.jsonl'] || '';
  const projectionText = files['projections/repoMap.projection.v1.json'] || files['projections/repoMap.projection.v1.jsonl'] || '';
  const previewText = files['previews/repo-map/index.html'] || '';
  return {
    kind: 'hq.localStatus.v1',
    ok: serve.ok,
    root,
    authority: false,
    localRootIsSsot: false,
    serve: serve.plan,
    counts: {
      modelQueueRows: countNonEmptyJsonlRows(queueText),
      agentTaskRows: countNonEmptyJsonlRows(agentText),
      hostCommandRows: countNonEmptyJsonlRows(hostCommandText),
      receiptRows: countNonEmptyJsonlRows(receiptText),
      hostCommandReceiptRows: countNonEmptyJsonlRows(hostReceiptText),
    },
    digests: {
      queueDigest: sha256Digest({ model: queueText, agent: agentText, hostCommand: hostCommandText }),
      receiptDigest: sha256Digest({ runtime: receiptText, hostCommand: hostReceiptText }),
      projectionDigest: sha256Digest(projectionText),
      previewDigest: sha256Digest(previewText),
    },
    staleState: false,
  };
}
