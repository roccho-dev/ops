import { preparePlan, entryLimits, digest, exact, snapshotJson } from './semlint-entry.mjs';
import { JEV_MODEL } from './core.mjs';

export const REQUEST_PREFIX = '/jev-evaluate\n';
export const RESULT_PREFIX = '<!-- ops-jev-result-v1 -->\n';
const RESULT_BYTE_CAP = 32768;
const sha = (x) => typeof x === 'string' && /^[a-f0-9]{40}$/.test(x);
const positive = (x) => Number.isSafeInteger(x) && x > 0;
const text = (x) => typeof x === 'string' && x.trim().length > 0;
const reject = (cause) => ({ status: 'NOT_ADMITTED', cause, authority: false });
const requests = new WeakSet();
const nonnegative = (x) => Number.isFinite(x) && x >= 0;
// Semlint result editions the comment composer binds exactly (v1 and the v10 bundle); all others are refused at admission.
const COMPOSABLE_RESULTS = Object.freeze(['ops.semlint.result.v1', 'ops.semlint.result.v10']);
// Exactly two closed receipt shapes: v2 (unchanged) and v3 (adds one per-case outer clock).
const RESULT_ROW_KEYS = Object.freeze({
  'ops.semlint.real-result.v2': ['id', 'result', 'provider'],
  'ops.semlint.real-result.v3': ['id', 'result', 'provider', 'elapsedMs'],
});
const validUsage = (x) => x === null || (x && !Array.isArray(x)
  && Object.entries(x).every(([k, v]) => ['input_tokens', 'output_tokens', 'total_tokens'].includes(k) && nonnegative(v)));
function validAccounting(a) {
  return exact(a, ['callbackAttempts', 'validatedCalls', 'usage', 'elapsedMs', 'providerHttpCalls', 'cost'])
    && [0, 1].includes(a.callbackAttempts) && [0, 1].includes(a.validatedCalls) && a.validatedCalls <= a.callbackAttempts
    && nonnegative(a.elapsedMs) && a.providerHttpCalls === null && a.cost === null
    && validUsage(a.usage);
}

function validProvider(p, result) {
  if (!exact(p, ['attemptedHttpCalls', 'completedHttpCalls', 'validatedResponses', 'statusClass',
    'validatedModel', 'usage', 'elapsedMs', 'responseDigest'])
    || ![0, 1].includes(p.attemptedHttpCalls) || ![0, 1].includes(p.completedHttpCalls) || ![0, 1].includes(p.validatedResponses)
    || p.completedHttpCalls > p.attemptedHttpCalls || p.validatedResponses > p.completedHttpCalls
    || p.attemptedHttpCalls > result.accounting.callbackAttempts || p.validatedResponses !== result.accounting.validatedCalls
    || !nonnegative(p.elapsedMs) || !validUsage(p.usage)
    || (p.responseDigest !== null && (typeof p.responseDigest !== 'string' || !/^[a-f0-9]{64}$/.test(p.responseDigest)))) return false;
  if (p.attemptedHttpCalls === 0 && (p.statusClass !== 'NOT_RUN' || p.responseDigest !== null)) return false;
  if (p.attemptedHttpCalls === 1 && p.completedHttpCalls === 0 && (p.statusClass !== 'REQUEST_ERROR' || p.responseDigest !== null)) return false;
  if (p.completedHttpCalls === 1 && !['HTTP_1XX', 'HTTP_2XX', 'HTTP_3XX', 'HTTP_4XX', 'HTTP_5XX', 'VALIDATED_RESPONSE'].includes(p.statusClass)) return false;
  if (p.validatedResponses === 0) return p.statusClass !== 'VALIDATED_RESPONSE' && p.validatedModel === null && p.usage === null;
  return p.statusClass === 'VALIDATED_RESPONSE' && p.validatedModel === JEV_MODEL && p.responseDigest !== null
    && JSON.stringify(p.usage) === JSON.stringify(result.accounting.usage);
}

const baseConfigValid = (config, keys) => exact(config, keys)
  && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.repository) && positive(config.issue)
  && Array.isArray(config.requesters) && config.requesters.length > 0 && config.requesters.every(text)
  && new Set(config.requesters).size === config.requesters.length && sha(config.executionSource);

// Config is an independently supplied trusted grant, never merged with comment JSON.
export async function admitIssueComment(eventValue, configValue) {
  let event, config, limits;
  try {
    event = snapshotJson(eventValue); config = snapshotJson(configValue);
    if (!baseConfigValid(config, ['repository', 'issue', 'requesters', 'executionSource', 'limits'])) return reject('INVALID_TRUSTED_CONFIG');
    limits = entryLimits(config.limits);
    if (!exact(event, ['repository', 'issue', 'action', 'comment'])
      || !exact(event.comment, ['id', 'author', 'revision', 'body']) || !positive(event.comment.id)
      || !text(event.comment.author) || !text(event.comment.revision) || typeof event.comment.body !== 'string') return reject('INVALID_EVENT');
  } catch { return reject('INVALID_EVENT_OR_CONFIG'); }
  if (event.repository !== config.repository || event.issue !== config.issue) return reject('TARGET_NOT_AUTHORIZED');
  if (event.action !== 'created') return reject('ACTION_NOT_AUTHORIZED');
  return admitBody(config, limits, event.comment.author, event.comment.body, (planDigest) => ({
    repository: event.repository, issue: event.issue, commentId: event.comment.id,
    author: event.comment.author, revision: event.comment.revision, bodyDigest: digest(event.comment.body),
    executionSource: config.executionSource, configDigest: digest(config), planDigest }));
}

// Shared requester/body/plan/size admission for webhook events and API snapshots.
async function admitBody(config, limits, author, body, identityOf) {
  if (!config.requesters.includes(author)) return reject('REQUESTER_NOT_AUTHORIZED');
  if (!body.startsWith(REQUEST_PREFIX)) return reject('NOT_A_REQUEST');
  if (Buffer.byteLength(body, 'utf8') > limits.maxInputBytes) return reject('REQUEST_TOO_LARGE');
  let prepared;
  try {
    const payload = JSON.parse(body.slice(REQUEST_PREFIX.length));
    if (!exact(payload, ['schema', 'cases']) || payload.schema !== 'ops.jev.issue-request.v1') return reject('INVALID_REQUEST');
    prepared = await preparePlan({ schema: 'ops.semlint.real-input.v1', cases: payload.cases }, limits);
  } catch { return reject('INVALID_REQUEST_OR_ADMISSION'); }
  // Only result editions this composer binds exactly may be admitted; anything else is refused before any paid call.
  if (prepared.expected.some((x) => !COMPOSABLE_RESULTS.includes(x.resultSchema))) return reject('RESULT_EDITION_NOT_COMPOSABLE');
  // A comment carries no audited translation: any v10 English auxiliary needs the frozen owner route.
  // Checked on the Core-admitted snapshot, before identity, claim, owner, provider or comment.
  if (prepared.plan.cases.some(({ input }) => input.schema === 'ops.semlint.input.v10'
    && [input.subject, ...input.context].some((row) => row.englishAuxiliary !== null))) return reject('AUDITED_AUXILIARY_REQUIRES_OWNER_ROUTE');
  const identity = Object.freeze(identityOf(prepared.planDigest));
  const request = Object.freeze({ status: 'ADMITTED', identity, requestDigest: digest(identity), prepared, authority: false });
  // Known repeated record/identity strings plus a conservative scalar/accounting reserve per case.
  // This is size admission only, not a synthetic result or execution receipt.
  const projection = { schema: 'ops.jev.issue-result.v1', requestDigest: request.requestDigest, identity,
    authority: false, result: { schema: 'ops.semlint.real-result.v3', model: JEV_MODEL, planDigest: prepared.planDigest,
      cases: prepared.expected.map((x) => ({ id: x.id, result: { schema: x.resultSchema,
        inputDigest: x.inputDigest, questionDigest: x.questionDigest, records: x.records.map((r) => ({ ...r, noul: null })),
        counts: {}, accounting: {}, claimCeiling: 'BOUNDED_EVIDENCE_NOT_SEMANTIC_TRUTH_OR_AUTHORITY',
        ...(x.projection ? { projection: x.projection } : {}) }, provider: {},
        elapsedMs: Number.MAX_VALUE })), // longest finite clock rendering; size only, not a measurement
      accounting: {}, claimCeiling: 'BOUNDED_EVIDENCE_NOT_SEMANTIC_TRUTH_OR_AUTHORITY' } };
  // 3072 bytes covers canonical scalar/accounting plus the closed native receipt's enums,
  // SHA256 and counters (including up to three finite usage counters); 1024 covers totals.
  // No response body, arbitrary model string or answers are repeated in the receipt.
  const maxOutputBytes = Buffer.byteLength(RESULT_PREFIX + JSON.stringify(projection) + '\n', 'utf8') + 1024 + 3072 * prepared.plan.cases.length;
  if (maxOutputBytes > RESULT_BYTE_CAP) return reject('RESULT_WOULD_EXCEED_COMMENT_CAP');
  requests.add(request);
  return request;
}

// Trusted executor config: the base grant plus a fixed principal, owner SHA values and a finite exact-ID grant.
// No executable path, argv, program or cwd is accepted; those are source constants of the executor.
export const EXECUTOR_CONFIG_KEYS = ['repository', 'issue', 'requesters', 'executionSource', 'limits', 'executorLogin', 'owner', 'grant'];
const GRANT_KEYS = ['version', 'commentIds', 'totalCalls', 'totalPosts', 'totalClaims', 'expiresAt', 'postIncomplete'];
export function validateExecutorConfig(value, nowMs) {
  let config, limits;
  try {
    config = snapshotJson(value);
    limits = baseConfigValid(config, EXECUTOR_CONFIG_KEYS) && entryLimits(config.limits);
  } catch { limits = null; }
  const grant = config?.grant, ids = grant?.commentIds;
  if (!limits || !text(config.executorLogin) || !exact(config.owner, ['envsSha', 'opsSha'])
    || !sha(config.owner.envsSha) || !sha(config.owner.opsSha) || config.owner.opsSha !== config.executionSource
    || !exact(grant, GRANT_KEYS) || !text(grant.version) || typeof grant.postIncomplete !== 'boolean'
    || !Array.isArray(ids) || !ids.length || !ids.every(positive) || new Set(ids).size !== ids.length
    || !['totalCalls', 'totalPosts', 'totalClaims'].every((k) => positive(grant[k]))
    || typeof grant.expiresAt !== 'string' || !Number.isFinite(Date.parse(grant.expiresAt))) throw new Error('INVALID_EXECUTOR_CONFIG');
  // Worst-case static bound: one raw-201 claim per exact ID, one owner run per claim, one post per ID.
  if (ids.length * limits.maxCalls > grant.totalCalls || ids.length > grant.totalPosts || ids.length > grant.totalClaims) throw new Error('GRANT_BOUNDS_EXCEEDED');
  if (!Number.isFinite(nowMs) || nowMs >= Date.parse(grant.expiresAt)) throw new Error('GRANT_EXPIRED');
  return freezeDeep(config);
}
const freezeDeep = (x) => { if (x && typeof x === 'object') { Object.values(x).forEach(freezeDeep); Object.freeze(x); } return x; };

// Authenticated API observation, distinct from a created webhook event: no action is fabricated.
// The edit signals are a conservative refusal filter, not proof that provider history was never edited.
export const SNAPSHOT_OBSERVATION = 'API_SNAPSHOT_NO_EDIT_SIGNAL';
export const SNAPSHOT_COMMENT_KEYS = ['id', 'databaseId', 'author', 'body', 'createdAt', 'updatedAt', 'lastEditedAt', 'includesCreatedEdit', 'userContentEditsTotal'];
const time = (x) => text(x) && Number.isFinite(Date.parse(x));
export async function admitIssueSnapshot(snapshotValue, configValue, nowMs) {
  let config, snap;
  try { config = validateExecutorConfig(configValue, nowMs); } catch (error) { return reject(error.message); }
  try {
    snap = snapshotJson(snapshotValue);
    const c = snap.comment;
    if (!exact(snap, ['repository', 'issue', 'comment']) || !exact(c, SNAPSHOT_COMMENT_KEYS) || !text(c.id) || !positive(c.databaseId)
      || !text(c.author) || typeof c.body !== 'string' || !time(c.createdAt) || !time(c.updatedAt)
      || !(c.lastEditedAt === null || time(c.lastEditedAt)) || typeof c.includesCreatedEdit !== 'boolean'
      || !Number.isSafeInteger(c.userContentEditsTotal) || c.userContentEditsTotal < 0) return reject('SNAPSHOT_UNKNOWN');
  } catch { return reject('SNAPSHOT_UNKNOWN'); }
  const c = snap.comment;
  if (snap.repository !== config.repository || snap.issue !== config.issue) return reject('TARGET_NOT_AUTHORIZED');
  if (!config.grant.commentIds.includes(c.databaseId)) return reject('NOT_IN_GRANT');
  if (c.lastEditedAt !== null || c.includesCreatedEdit || c.userContentEditsTotal !== 0) return reject('EDITED');
  return admitBody(config, config.limits, c.author, c.body, (planDigest) => ({
    repository: snap.repository, issue: snap.issue, commentId: c.databaseId, nodeId: c.id, author: c.author,
    revision: c.updatedAt, bodyDigest: digest(c.body), observation: SNAPSHOT_OBSERVATION,
    executionSource: config.executionSource, configDigest: digest(config), planDigest }));
}

// Pure prior derivation from provider-native state only: claim reactions of the source-constant kind on the
// request comment, and result comments on the Issue. No persistence; observed counts are never a budget.
export function deriveIssuePrior(request, observationValue, executorLogin) {
  const unrecognized = { requestDigest: request?.requestDigest ?? '', state: 'UNRECOGNIZED' };
  if (!requests.has(request) || !text(executorLogin)) return unrecognized;
  let obs;
  try { obs = snapshotJson(observationValue); } catch { return unrecognized; }
  if (!exact(obs, ['claims', 'results']) || !Array.isArray(obs.claims) || !Array.isArray(obs.results)) return unrecognized;
  const ours = obs.claims.filter((x) => x === executorLogin).length;
  // Only executorLogin's reaction is a claim. A known other login is not a claim and grants no principal
  // migration, so it is ignored; an unattributable reaction (null/deleted user) or a duplicate is held.
  if (ours > 1 || obs.claims.some((x) => !text(x))) return unrecognized;
  // Only results authored by executorLogin can deliver; anyone else's copies are ignored.
  const matching = obs.results.filter((r) => {
    if (r?.author !== executorLogin) return false;
    try { return JSON.parse(r.body.slice(RESULT_PREFIX.length)).requestDigest === request.requestDigest; } catch { return false; }
  });
  if (!matching.length) return ours ? { requestDigest: request.requestDigest, state: 'STARTED' } : null;
  const [r] = matching;
  if (matching.length === 1 && ours === 1 && verifyResultReadback(request, r.body, { repository: request.identity.repository,
    issue: request.identity.issue, id: r.databaseId, author: r.author, body: r.body }, executorLogin, r.databaseId)) {
    return { requestDigest: request.requestDigest, state: 'APPENDED' };
  }
  return unrecognized;
}

// Prior state must come from a serialized real executor. This decision has no persistence or effects.
// A failed/unknown paid call is never converted to a free retry; existing result delivery is separate.
export function nextIssueEffect(request, prior = null) {
  if (!requests.has(request)) return { effect: 'NONE', cause: 'REQUEST_NOT_ADMITTED' };
  if (prior === null) return { effect: 'EVALUATE', cause: 'NO_PRIOR_ATTEMPT' };
  if (!exact(prior, ['requestDigest', 'state']) || prior.requestDigest !== request.requestDigest) return { effect: 'NONE', cause: 'STATE_IDENTITY_MISMATCH' };
  if (prior.state === 'EVALUATED') return { effect: 'APPEND_EXISTING_RESULT', cause: 'NO_PROVIDER_RECALL' };
  if (prior.state === 'APPENDED') return { effect: 'READBACK_ONLY', cause: 'NO_DUPLICATE_APPEND' };
  return { effect: 'NONE', cause: 'ATTEMPT_REQUIRES_RECONCILIATION' };
}

export function composeResultComment(request, resultValue) {
  if (!requests.has(request)) throw new Error('REQUEST_NOT_ADMITTED');
  const output = snapshotJson(resultValue);
  if (!exact(output, ['schema', 'model', 'planDigest', 'cases', 'accounting', 'claimCeiling'])
    || !Object.hasOwn(RESULT_ROW_KEYS, output.schema) || output.model !== JEV_MODEL
    || output.planDigest !== request.prepared.planDigest
    || output.claimCeiling !== 'BOUNDED_EVIDENCE_NOT_SEMANTIC_TRUTH_OR_AUTHORITY'
    || !Array.isArray(output.cases) || output.cases.length !== request.prepared.expected.length) throw new Error('RESULT_IDENTITY_MISMATCH');
  for (let i = 0; i < output.cases.length; i++) {
    const row = output.cases[i], expected = request.prepared.expected[i], result = row?.result;
    if (!exact(row, RESULT_ROW_KEYS[output.schema]) || (Object.hasOwn(row, 'elapsedMs') && !nonnegative(row.elapsedMs))
      || row.id !== expected.id || !COMPOSABLE_RESULTS.includes(result?.schema) || result.schema !== expected.resultSchema
      || !exact(result, ['schema', 'inputDigest', 'questionDigest', 'records', 'counts', 'accounting', 'claimCeiling', ...(expected.projection ? ['projection'] : [])])
      || (expected.projection && JSON.stringify(result.projection) !== JSON.stringify(expected.projection))
      || result.inputDigest !== expected.inputDigest || result.questionDigest !== expected.questionDigest
      || result.claimCeiling !== output.claimCeiling || !validAccounting(result.accounting)
      || !Array.isArray(result.records) || result.records.length !== expected.records.length) throw new Error('RESULT_IDENTITY_MISMATCH');
    for (let j = 0; j < result.records.length; j++) {
      const record = result.records[j], binding = expected.records[j];
      if (!exact(record, [...Object.keys(binding), 'noul'])
        || ['question', 'rule', 'subject', 'contextRefs', 'missingRoles', 'crossLinks'].some((k) => JSON.stringify(record[k]) !== JSON.stringify(binding[k]))
        || !['OBSERVED', 'NOT_SELECTED', 'INCOMPLETE', 'EXECUTION_ERROR', 'EVIDENCE_INVALID'].includes(record.status)
        || (binding.status !== 'OBSERVED' && (record.status !== binding.status || record.cause !== binding.cause))
        || (binding.status === 'OBSERVED' && !['OBSERVED', 'EXECUTION_ERROR', 'EVIDENCE_INVALID'].includes(record.status))
        || (record.status === 'EXECUTION_ERROR' && !['EVALUATION_PREFLIGHT_FAILED', 'EVALUATION_FAILED'].includes(record.cause))
        || (record.status === 'EVIDENCE_INVALID' && !['JEV_MODEL_MISMATCH', 'INVALID_JEV_ANSWERS', 'INVALID_JEV_JSON'].includes(record.cause))
        || (record.status === 'OBSERVED' ? !Number.isFinite(record.noul) || record.noul < 0 || record.noul > 1 || record.cause !== null : record.noul !== null)) throw new Error('INVALID_RESULT_RECORD');
    }
    const counts = { selected: request.prepared.plan.cases[i].input.checks.length, sendable: expected.sendable,
      evaluated: result.records.filter((x) => x.status === 'OBSERVED').length,
      missing: result.records.filter((x) => x.status === 'INCOMPLETE').length };
    if (!exact(result.counts, Object.keys(counts)) || Object.keys(counts).some((k) => result.counts[k] !== counts[k])
      || ![0, expected.sendable].includes(counts.evaluated)
      || result.accounting.validatedCalls !== (counts.evaluated > 0 ? 1 : 0)
      || (result.accounting.validatedCalls === 0 && result.accounting.usage !== null)) throw new Error('INVALID_RESULT_ACCOUNTING');
    const sent = result.records.filter((_, j) => expected.records[j].status === 'OBSERVED');
    if (new Set(sent.map((x) => JSON.stringify([x.status, x.cause]))).size > 1) throw new Error('INVALID_RESULT_BATCH');
    const expectedCallbacks = sent.length && sent[0].cause !== 'EVALUATION_PREFLIGHT_FAILED' ? 1 : 0;
    if (result.accounting.callbackAttempts !== expectedCallbacks) throw new Error('INVALID_RESULT_ACCOUNTING');
    if (row.provider !== null && !validProvider(row.provider, result)) throw new Error('INVALID_PROVIDER_ACCOUNTING');
  }
  const accounting = output.accounting;
  if (!exact(accounting, ['callbackAttempts', 'validatedCalls', 'providerHttpCalls', 'completedHttpCalls', 'validatedResponses', 'unknownHttpCalls', 'cost'])
    || !Number.isSafeInteger(accounting.callbackAttempts) || accounting.callbackAttempts < 0 || accounting.callbackAttempts > request.prepared.plannedCalls
    || accounting.validatedCalls !== output.cases.reduce((n, x) => n + x.result.accounting.validatedCalls, 0)
    || accounting.callbackAttempts > output.cases.reduce((n, x) => n + x.result.accounting.callbackAttempts, 0)
    || accounting.validatedCalls > accounting.callbackAttempts || accounting.cost !== null) throw new Error('INVALID_RESULT_ACCOUNTING');
  const native = output.cases.filter((x) => x.provider !== null);
  if (native.length === 0) {
    if (['providerHttpCalls', 'completedHttpCalls', 'validatedResponses', 'unknownHttpCalls'].some((k) => accounting[k] !== null)) throw new Error('INVALID_PROVIDER_ACCOUNTING');
  } else {
    if (native.length !== output.cases.length
      || accounting.providerHttpCalls !== native.reduce((n, x) => n + x.provider.attemptedHttpCalls, 0)
      || accounting.completedHttpCalls !== native.reduce((n, x) => n + x.provider.completedHttpCalls, 0)
      || accounting.validatedResponses !== native.reduce((n, x) => n + x.provider.validatedResponses, 0)
      || accounting.unknownHttpCalls !== accounting.providerHttpCalls - accounting.completedHttpCalls
      || accounting.providerHttpCalls > accounting.callbackAttempts) throw new Error('INVALID_PROVIDER_ACCOUNTING');
  }
  const body = RESULT_PREFIX + JSON.stringify({ schema: 'ops.jev.issue-result.v1', requestDigest: request.requestDigest,
    identity: request.identity, authority: false, result: output }) + '\n';
  if (Buffer.byteLength(body, 'utf8') > RESULT_BYTE_CAP) throw new Error('RESULT_COMMENT_TOO_LARGE');
  return body;
}

// Compare exact append evidence, not merely HTTP success or a comment URL.
export function verifyResultReadback(request, expectedBody, observedValue, trustedResultAuthor, expectedCommentId) {
  if (!requests.has(request) || typeof expectedBody !== 'string' || !expectedBody.startsWith(RESULT_PREFIX)) return false;
  let observed;
  try {
    observed = snapshotJson(observedValue);
    const envelope = JSON.parse(expectedBody.slice(RESULT_PREFIX.length));
    if (!exact(envelope, ['schema', 'requestDigest', 'identity', 'authority', 'result'])
      || envelope.schema !== 'ops.jev.issue-result.v1' || envelope.requestDigest !== request.requestDigest
      || envelope.authority !== false || JSON.stringify(envelope.identity) !== JSON.stringify(request.identity)
      || composeResultComment(request, envelope.result) !== expectedBody) return false;
  } catch { return false; }
  return exact(observed, ['repository', 'issue', 'id', 'author', 'body']) && positive(expectedCommentId) && observed.id === expectedCommentId
    && observed.repository === request.identity.repository && observed.issue === request.identity.issue
    && text(trustedResultAuthor) && observed.author === trustedResultAuthor && observed.body === expectedBody;
}
