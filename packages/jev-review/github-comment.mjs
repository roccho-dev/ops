import { createHash } from 'node:crypto';
import { ENTRY_LIMITS, preparePlan, entryLimits, digest, exact, snapshotJson } from './semlint-entry.mjs';
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
// Semlint result editions the comment composer binds exactly (v1 and the v14 bundle); all others are refused at admission.
const COMPOSABLE_RESULTS = Object.freeze(['ops.semlint.result.v1', 'ops.semlint.result.v14']);
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
  const parsed = await prepareIssueRequest(body, limits);
  if (parsed.cause) return reject(parsed.cause);
  return finishRequest(parsed.prepared, identityOf);
}

async function prepareIssueRequest(body, limits, validatePayload = null) {
  if (!body.startsWith(REQUEST_PREFIX)) return { cause: 'NOT_A_REQUEST' };
  if (Buffer.byteLength(body, 'utf8') > limits.maxInputBytes) return { cause: 'REQUEST_TOO_LARGE' };
  let prepared;
  try {
    const payload = JSON.parse(body.slice(REQUEST_PREFIX.length));
    if (!exact(payload, ['schema', 'cases']) || payload.schema !== 'ops.jev.issue-request.v1') return { cause: 'INVALID_REQUEST' };
    if (validatePayload !== null && !validatePayload(payload)) return { cause: 'INVALID_PROVIDED_REQUEST' };
    prepared = await preparePlan({ schema: 'ops.semlint.real-input.v1', cases: payload.cases }, limits);
  } catch { return { cause: 'INVALID_REQUEST_OR_ADMISSION' }; }
  return { prepared };
}

// Shared result-size admission and registration of an admitted request, for every admission path.
function finishRequest(prepared, identityOf) {
  // Only result editions this composer binds exactly may be admitted; anything else is refused before any paid call.
  if (prepared.expected.some((x) => !COMPOSABLE_RESULTS.includes(x.resultSchema))) return reject('RESULT_EDITION_NOT_COMPOSABLE');
  // A comment carries no audited translation: any v14 English auxiliary needs the frozen owner route.
  // Checked on the Core-admitted snapshot, before identity, claim, owner, provider or comment.
  if (prepared.plan.cases.some(({ input }) => input.schema === 'ops.semlint.input.v14'
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

// Trusted Actions settings (reviewed source). Requester allowlist is never read from Issue data.
// Org Secret projection/target is outside this source; no executable, argv or program selector.
export const ACTIONS_CONFIG_KEYS = ['trustedCallers', 'allowedChecks', 'context', 'subjectScope', 'limits', 'runRanges', 'targets', 'provider'];
const RANGE_KEYS = ['repository', 'workflowId', 'path', 'first', 'last', 'reservedCallsPerRun'];
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const REPO_PATH = /^(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const WORKFLOW_PATH = /^\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml$/;
const freezeDeep = (x) => { if (x && typeof x === 'object') { Object.values(x).forEach(freezeDeep); Object.freeze(x); } return x; };
const databaseId = (x) => typeof x === 'string' && /^[1-9][0-9]*$/.test(x);
function providerValid(value) {
  if (value === null) return true;
  if (!exact(value, ['repository', 'revision', 'path', 'receipt']) || !REPOSITORY.test(value.repository) || !sha(value.revision)
    || value.path !== 'handoffs/dev-jev-api.github-actions.json') return false;
  const r = value.receipt, t = r?.target;
  return exact(r, ['kind', 'source', 'binding', 'controller', 'created_at', 'operation', 'target', 'readback', 'provider_use'])
    && r.kind === 'envs.orgSecretProjectionReceipt.v1' && sha(r.source) && r.binding === 'jev-api.github-actions'
    && typeof r.controller === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(r.controller)
    && typeof r.created_at === 'string' && r.created_at.endsWith('Z') && Number.isFinite(Date.parse(r.created_at))
    && r.operation === 'github_org_secret_put' && r.readback === 'SECRET_NAME_AND_SELECTED_REPOSITORY_IDS' && r.provider_use === 'NOT_RUN'
    && exact(t, ['provider', 'organization', 'organization_id', 'secret_name', 'repositories', 'repository_ids'])
    && t.provider === 'github-org-secret' && typeof t.organization === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(t.organization)
    && value.repository === `${t.organization}/envs` && databaseId(t.organization_id)
    && t.secret_name === ['JEV', 'API', 'KEY'].join('_')
    && Array.isArray(t.repositories) && t.repositories.length > 0 && t.repositories.length <= 100
    && t.repositories.every((repo) => REPOSITORY.test(repo) && repo.startsWith(`${t.organization}/`))
    && new Set(t.repositories).size === t.repositories.length && Array.isArray(t.repository_ids)
    && t.repository_ids.length === t.repositories.length && t.repository_ids.every(databaseId)
    && new Set(t.repository_ids).size === t.repository_ids.length;
}
export function validateActionsConfig(value) {
  let config;
  try { config = snapshotJson(value); entryLimits(config.limits); } catch { throw new Error('INVALID_ACTIONS_CONFIG'); }
  const ranges = config.runRanges;
  if (!exact(config, [...ACTIONS_CONFIG_KEYS, ...(Object.hasOwn(config, 'providedRequestTargets') ? ['providedRequestTargets'] : [])]) || !text(config.subjectScope)
    || !Array.isArray(config.trustedCallers) || !config.trustedCallers.every((x) => typeof x === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(x))
    || new Set(config.trustedCallers).size !== config.trustedCallers.length
    || !Array.isArray(config.allowedChecks) || !config.allowedChecks.length || !config.allowedChecks.every(text)
    || new Set(config.allowedChecks).size !== config.allowedChecks.length
    || !Array.isArray(config.context) || !config.context.every((c) => exact(c, ['role', 'path']) && text(c.role) && REPO_PATH.test(c.path))
    || new Set(config.context.map((c) => JSON.stringify([c.role, c.path]))).size !== config.context.length
    || !providerValid(config.provider)
    || !Array.isArray(config.targets) || !config.targets.every((target) =>
      (exact(target, ['repository', 'repositoryId', 'issue']) && positive(target.issue)
        || exact(target, ['repository', 'repositoryId', 'pullRequest']) && positive(target.pullRequest))
      && REPOSITORY.test(target.repository) && databaseId(target.repositoryId))
    || new Set(config.targets.map((target) => JSON.stringify(Object.hasOwn(target, 'pullRequest')
      ? [target.repository, 'pull-request', target.pullRequest] : [target.repository, 'issue']))).size !== config.targets.length
    || config.targets.filter((target) => Object.hasOwn(target, 'pullRequest')).length > 2
    || !Array.isArray(ranges) || !ranges.every((r) => exact(r, RANGE_KEYS) && REPOSITORY.test(r.repository) && positive(r.workflowId)
      && WORKFLOW_PATH.test(r.path) && positive(r.first) && positive(r.last) && r.first <= r.last
      && positive(r.reservedCallsPerRun) && r.reservedCallsPerRun <= ENTRY_LIMITS.maxCalls)) throw new Error('INVALID_ACTIONS_CONFIG');
  for (const target of config.targets) {
    if (Object.hasOwn(target, 'pullRequest') && (target.repository.split('/')[1] !== 'ops'
      || config.targets.some((candidate) => Object.hasOwn(candidate, 'pullRequest')
        && (candidate.repository !== target.repository || candidate.repositoryId !== target.repositoryId)))) {
      throw new Error('INVALID_ACTIONS_CONFIG');
    }
    if (Object.hasOwn(target, 'pullRequest') && !config.targets.some((candidate) => candidate.repository === target.repository
      && candidate.repositoryId === target.repositoryId && Object.hasOwn(candidate, 'issue'))) throw new Error('INVALID_ACTIONS_CONFIG');
    if (config.targets.some((candidate) => (candidate.repository === target.repository) !== (candidate.repositoryId === target.repositoryId))) {
      throw new Error('INVALID_ACTIONS_CONFIG');
    }
  }
  if (Object.hasOwn(config, 'providedRequestTargets') && (!Array.isArray(config.providedRequestTargets)
    || config.providedRequestTargets.length > 1 || !config.providedRequestTargets.every((grant) =>
      exact(grant, ['repository', 'repositoryId', 'pullRequest']) && positive(grant.pullRequest)
      && ![511, 520].includes(grant.pullRequest)
      && config.targets.some((target) => Object.hasOwn(target, 'pullRequest')
        && target.repository === grant.repository && target.repositoryId === grant.repositoryId
        && target.pullRequest === grant.pullRequest)))) throw new Error('INVALID_ACTIONS_CONFIG');
  // Reservations never overlap for one native workflow identity, so a run number is admitted by at most one.
  for (const a of ranges) for (const b of ranges) {
    if (a !== b && a.repository === b.repository && a.workflowId === b.workflowId && a.first <= b.last && b.first <= a.last) throw new Error('INVALID_ACTIONS_CONFIG');
  }
  if (config.provider !== null && config.targets.some((t) => {
    const target = config.provider.receipt.target;
    const i = target.repositories.indexOf(t.repository);
    return i < 0 || target.repository_ids[i] !== t.repositoryId;
  })) throw new Error('INVALID_ACTIONS_CONFIG');
  return freezeDeep(config);
}

export function selectActionsTarget(config, repository, number, targetKind = 'issue') {
  if (!['issue', 'pull-request'].includes(targetKind)) return undefined;
  const field = targetKind === 'pull-request' ? 'pullRequest' : 'issue';
  return config.targets.find((target) => target.repository === repository && target[field] === number);
}

// Hard aggregate bound on attempted consumer provider calls: a provider call is planned only for a
// first-attempt run whose native repository/workflow id/path/run number fall in one reviewed range, and
// each run is capped at min(range.reservedCallsPerRun, limits.maxCalls). Total <= sum(width x reserved).
export function selectRunRange(config, run) {
  if (!exact(run, ['repository', 'workflowId', 'path', 'number', 'attempt', 'id'])
    || !positive(run.workflowId) || !positive(run.number) || !positive(run.attempt) || !positive(run.id)) return { cause: 'RUN_UNKNOWN' };
  if (run.attempt !== 1) return { cause: 'RERUN_NOT_PAID' };
  const hits = config.runRanges.filter((r) => r.repository === run.repository && r.workflowId === run.workflowId
    && r.path === run.path && r.first <= run.number && run.number <= r.last);
  if (hits.length !== 1) return { cause: 'NO_RANGE' };
  return { range: hits[0], callsPerRun: Math.min(hits[0].reservedCallsPerRun, config.limits.maxCalls) };
}

// Subject revision from the exact full body and the provider's body-edit signals; generic updatedAt is not
// used, so unrelated activity is not a revision change. Not a claim of complete or immutable edit history.
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const time = (x) => text(x) && Number.isFinite(Date.parse(x));
const editSignals = (x) => (x.lastEditedAt === null || time(x.lastEditedAt)) && typeof x.includesCreatedEdit === 'boolean'
  && Number.isSafeInteger(x.userContentEditsTotal) && x.userContentEditsTotal >= 0;
export const ISSUE_KEYS = ['number', 'nodeId', 'body', 'lastEditedAt', 'includesCreatedEdit', 'userContentEditsTotal'];
export const COMMAND_KEYS = ['databaseId', 'nodeId', 'author', 'body', 'lastEditedAt', 'includesCreatedEdit', 'userContentEditsTotal'];
export function subjectRevision(issue) {
  return [issue.nodeId, 'sha256:' + sha256(issue.body), issue.lastEditedAt ?? 'unedited',
    String(issue.userContentEditsTotal), String(issue.includesCreatedEdit)].join('|');
}

// Trusted literal-command admission. The guard matched Org/body/Issue at the event; this re-checks the
// observed command against the event, builds the existing semlint input (log-entry subject = exact full Issue
// body; context = declared repository files at the run's source SHA) and plans with the run's call ceiling.
export const COMMAND_OBSERVATION = 'ACTIONS_TRUSTED_LITERAL_COMMAND';
export const PROVIDED_COMMAND_OBSERVATION = 'ACTIONS_TRUSTED_PROVIDED_REQUEST';

function providedPayloadMatches(payload, input, revision) {
  if (!Array.isArray(payload.cases) || payload.cases.length !== 1) return false;
  const value = payload.cases[0]?.input, subject = value?.subject;
  return value?.schema === 'ops.semlint.input.v14' && subject?.kind === 'log-entry'
    && subject.ref === `https://github.com/${input.repository}/pull/${input.issue.number}`
    && subject.revision === revision && subject.scope === 'entire body of the approved pull request at the observed revision'
    && subject.content === input.issue.body && subject.sha256 === sha256(input.issue.body)
    && subject.evaluationSpan?.startByte === 0 && subject.evaluationSpan.endByte === Buffer.byteLength(input.issue.body, 'utf8')
    && subject.englishAuxiliary === null && Array.isArray(value.context)
    && value.context.every((row) => row?.englishAuxiliary === null)
    && Array.isArray(value.checks) && value.checks.length > 0 && value.checks.length <= 6
    && !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(JSON.stringify(value));
}

export async function admitIssueCommand(inputValue, configValue) {
  let config, input;
  try { config = validateActionsConfig(configValue); } catch (error) { return reject(error.message); }
  try {
    input = snapshotJson(inputValue);
    if (!exact(input, ['repository', 'owner', 'sha', 'eventBody', 'run', 'issue', 'command', 'context',
      ...(Object.hasOwn(input, 'targetKind') ? ['targetKind'] : [])])
      || (Object.hasOwn(input, 'targetKind') && input.targetKind !== 'pull-request')
      || !REPOSITORY.test(input.repository) || !text(input.owner) || !sha(input.sha) || !text(input.eventBody)
      || !exact(input.issue, ISSUE_KEYS) || !positive(input.issue.number) || !text(input.issue.nodeId)
      || typeof input.issue.body !== 'string' || !editSignals(input.issue)
      || !exact(input.command, COMMAND_KEYS) || !positive(input.command.databaseId) || !text(input.command.nodeId)
      || !text(input.command.author) || typeof input.command.body !== 'string' || !editSignals(input.command)
      || !Array.isArray(input.context) || input.context.length !== config.context.length
      || !input.context.every((c, i) => exact(c, ['role', 'path', 'content']) && c.role === config.context[i].role
        && c.path === config.context[i].path && typeof c.content === 'string')) return reject('INPUT_UNKNOWN');
  } catch { return reject('INPUT_UNKNOWN'); }
  const { issue, command } = input;
  const targetKind = input.targetKind ?? 'issue';
  const pullRequest = targetKind === 'pull-request';
  if (!selectActionsTarget(config, input.repository, issue.number, targetKind)) return reject('TARGET_NOT_AUTHORIZED');
  if (!config.trustedCallers.includes(command.author)) return reject('COMMAND_NOT_AUTHORIZED');
  const provided = input.eventBody.startsWith(REQUEST_PREFIX);
  if (input.eventBody !== '/jev-evaluate' && !provided) return reject('NOT_A_REQUEST');
  if (provided && (!pullRequest || !config.providedRequestTargets?.some((grant) =>
    grant.repository === input.repository && grant.pullRequest === issue.number))) return reject('PROVIDED_REQUEST_NOT_AUTHORIZED');
  if (command.body !== input.eventBody) return reject('COMMAND_DRIFT');
  if (command.lastEditedAt !== null || command.includesCreatedEdit || command.userContentEditsTotal !== 0) return reject('EDITED');
  const selected = selectRunRange(config, { ...input.run, repository: input.repository });
  if (!selected.range) return reject(selected.cause);
  const revision = subjectRevision(issue);
  const semlintInput = { schema: 'ops.semlint.input.v1',
    subject: { kind: 'log-entry', ref: `https://github.com/${input.repository}/${pullRequest ? 'pull' : 'issues'}/${issue.number}`, revision,
      scope: pullRequest ? 'entire body of the approved pull request at the observed revision' : config.subjectScope,
      content: issue.body, sha256: sha256(issue.body) },
    context: input.context.map((c) => ({ role: c.role, ref: `${c.path}@${input.sha}`, revision: input.sha, content: c.content, sha256: sha256(c.content) })),
    checks: [...config.allowedChecks] };
  let prepared;
  if (provided) {
    const parsed = await prepareIssueRequest(command.body, { ...config.limits, maxCases: 1, maxCalls: Math.min(1, selected.callsPerRun) },
      (payload) => providedPayloadMatches(payload, input, revision));
    if (parsed.cause) return reject(parsed.cause);
    prepared = parsed.prepared;
    if (prepared.expected[0].sendable !== prepared.plan.cases[0].input.checks.length) return reject('PROVIDED_CONTEXT_INCOMPLETE');
  } else try {
    prepared = await preparePlan({ schema: 'ops.semlint.real-input.v1', cases: [{ id: targetKind, input: semlintInput }] },
      { ...config.limits, maxCalls: selected.callsPerRun });
  } catch { return reject('INVALID_REQUEST_OR_ADMISSION'); }
  return finishRequest(prepared, (planDigest) => ({
    repository: input.repository, issue: issue.number, issueNodeId: issue.nodeId, subjectRevision: revision,
    ...(pullRequest ? { targetKind } : {}),
    commentId: command.databaseId, nodeId: command.nodeId, author: command.author, bodyDigest: digest(command.body),
    observation: provided ? PROVIDED_COMMAND_OBSERVATION : COMMAND_OBSERVATION, executionSource: input.sha, configDigest: digest(config),
    run: { id: input.run.id, number: input.run.number, attempt: input.run.attempt, workflowId: input.run.workflowId },
    planDigest }));
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
