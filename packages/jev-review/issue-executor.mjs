import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateActionsConfig, admitIssueCommand, selectRunRange, deriveIssuePrior, nextIssueEffect,
  composeResultComment, verifyResultReadback } from './github-comment.mjs';

// GitHub-hosted Actions adapter for one trusted literal command (ops#483). `plan` and `post` run without the Jev
// key; between them the workflow's single key-bearing step runs only the fixed semlint-entry.mjs on plan.json.
// GitHub is reached only with the run's own GITHUB_TOKEN. No host executable, dispatch, retry loop or ledger.
export const EXECUTOR_LOGIN = 'github-actions[bot]';
export const CLAIM = Object.freeze({ rest: 'eyes', graphql: 'EYES' });
const PRE_PROVIDER_CAUSES = ['INVALID_ENTRY_ARGS', 'ENTRY_INPUT_TOO_LARGE', 'INVALID_ENTRY_JSON', 'INVALID_ENTRY_PLAN',
  'INVALID_ENTRY_LIMITS', 'INVALID_ENTRY_CASE', 'INVALID_ENTRY_SEMLINT', 'ENTRY_PREFLIGHT_FAILED', 'ENTRY_CALL_BUDGET_EXCEEDED'];
// Subject: body plus body-edit signals only (no generic updatedAt).
export const ISSUE_QUERY = 'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name)'
  + '{issue(number:$number){id number body lastEditedAt includesCreatedEdit userContentEdits{totalCount}}}}';
// IssueComment.databaseId is Int (signed 32-bit) and cannot represent real REST comment IDs; fullDatabaseId is
// BigInt, whose wire encoding is a string. Only fullDatabaseId is requested.
export const COMMENT_QUERY = 'query($id:ID!){node(id:$id){... on IssueComment{id fullDatabaseId author{login} body '
  + `lastEditedAt includesCreatedEdit userContentEdits{totalCount} reactions(content:${CLAIM.graphql},first:100){totalCount nodes{content user{login}}}}}}`;

const json = (s) => { try { return JSON.parse(s); } catch { return undefined; } };
// One JSON line on stdout; anything else is not a parseable result.
const oneLine = (s) => (typeof s === 'string' && s.endsWith('\n') && s.indexOf('\n') === s.length - 1 ? json(s) : undefined);
const positive = (x) => Number.isSafeInteger(x) && x > 0;
const call = async (deps, method, route, body) => { try { return await deps.github(method, route, body); } catch { return null; } };

// BigInt wire string -> exact positive safe integer, or null. No rounding, opaque node-id decoding or fallback.
export function decodeFullDatabaseId(value) {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && String(n) === value ? n : null;
}
const keysAre = (x, keys) => Boolean(x) && typeof x === 'object' && !Array.isArray(x)
  && JSON.stringify(Object.keys(x).sort()) === JSON.stringify([...keys].sort());
const editsTotal = (x) => (keysAre(x.userContentEdits, ['totalCount']) ? x.userContentEdits.totalCount : null);

// Observe the exact Issue subject and the command comment (with its claim reactions). Any error, missing or
// unrequested field, or an identity that differs from the event is undefined: the caller holds, no guessing.
async function observe(deps, repository, issueNumber, commentNodeId, commentId) {
  const [owner, name] = repository.split('/');
  let iv, cv;
  try {
    iv = await deps.graphql(ISSUE_QUERY, { owner, name, number: issueNumber });
    cv = await deps.graphql(COMMENT_QUERY, { id: commentNodeId });
  } catch { return undefined; }
  const i = iv?.data?.repository?.issue, c = cv?.data?.node;
  if (!iv || iv.errors !== undefined || !cv || cv.errors !== undefined
    || !keysAre(i, ['id', 'number', 'body', 'lastEditedAt', 'includesCreatedEdit', 'userContentEdits'])
    || !keysAre(c, ['id', 'fullDatabaseId', 'author', 'body', 'lastEditedAt', 'includesCreatedEdit', 'userContentEdits', 'reactions'])
    || i.number !== issueNumber || c.id !== commentNodeId || decodeFullDatabaseId(c.fullDatabaseId) !== commentId) return undefined;
  const r = c.reactions;
  const complete = keysAre(r, ['totalCount', 'nodes']) && Array.isArray(r.nodes) && r.totalCount === r.nodes.length
    && r.nodes.every((x) => x && x.content === CLAIM.graphql);
  return {
    issue: { number: i.number, nodeId: i.id, body: i.body, lastEditedAt: i.lastEditedAt,
      includesCreatedEdit: i.includesCreatedEdit, userContentEditsTotal: editsTotal(i) },
    command: { databaseId: commentId, nodeId: c.id, author: c.author?.login ?? null, body: c.body, lastEditedAt: c.lastEditedAt,
      includesCreatedEdit: c.includesCreatedEdit, userContentEditsTotal: editsTotal(c) },
    claims: complete ? r.nodes.map((x) => x.user?.login ?? null) : null,
  };
}

// Native workflow state (GET actions/workflows/{id}); disabling stops new runs and, at the next observed
// checkpoint, running ones. An unreadable state is treated as not active.
async function workflowState(deps, repository, workflowId) {
  const res = await call(deps, 'GET', `repos/${repository}/actions/workflows/${workflowId}`);
  return res?.status === 200 && res.json?.id === workflowId && typeof res.json.state === 'string' ? res.json.state : null;
}

// Owner stdout is one JSON line. Only an exact closed pre-provider entry-error is a refusal; anything else
// that is not a v2 or v3 result (including ENTRY_FAILED, empty or malformed output) is UNKNOWN.
// The closed shape of either receipt is validated later by composeResultComment.
export function classifyOwnerOutput(out) {
  const value = oneLine(out?.stdout);
  if (out?.status === 1 && value && Object.keys(value).length === 4 && value.schema === 'ops.semlint.entry-error.v1'
    && value.status === 'REJECTED' && value.authority === false && PRE_PROVIDER_CAUSES.includes(value.cause)) return { kind: 'REFUSED', cause: value.cause };
  if (out?.status === 0 && ['ops.semlint.real-result.v2', 'ops.semlint.real-result.v3'].includes(value?.schema)) return { kind: 'RESULT', value };
  return { kind: 'UNKNOWN' };
}
export { PRE_PROVIDER_CAUSES };

const RECEIPT = 'ops.jev.issue-actions-receipt.v1';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Plan one event (no key). Order: settings -> native run identity and reservation -> active workflow ->
// exact snapshot -> admission -> prior -> raw-201 claim -> re-read -> active. Outcomes: PLANNED, NONE
// (no provider call), UNKNOWN (claim effect not known). Only PLANNED yields a plan for the fixed entry.
export async function planIssueCommand(ctx, configValue, deps) {
  const receipt = { schema: RECEIPT, stage: 'plan', outcome: null, cause: null, claimed: false, providerCalls: 0, authority: false };
  const end = (outcome, cause, extra = {}) => { Object.assign(receipt, { outcome, cause }, extra); return { receipt, state: { ...receipt } }; };
  let config;
  try { config = validateActionsConfig(configValue); } catch { return end('NONE', 'INVALID_ACTIONS_CONFIG'); }
  const e = ctx?.event;
  if (!e?.comment || !positive(e.comment.id) || typeof e.comment.node_id !== 'string' || typeof e.comment.body !== 'string'
    || !positive(e.issue?.number) || e.repository?.full_name !== ctx.repository || typeof e.repository?.owner?.login !== 'string') return end('NONE', 'EVENT_UNKNOWN');
  if (e.issue.pull_request !== undefined && e.issue.pull_request !== null) return end('NONE', 'NOT_AN_ISSUE');
  if (e.repository.owner.type !== 'Organization') return end('NONE', 'ORG_REQUIRED');
  if (config.provider === null || config.targets.length === 0) return end('NONE', 'PROVIDER_NOT_CONFIGURED');
  const target = config.targets.find((t) => t.repository === ctx.repository && t.issue === e.issue.number);
  if (!target || String(e.repository.id) !== target.repositoryId
    || e.repository.owner.login !== config.provider.receipt.target.organization
    || String(e.repository.owner.id) !== config.provider.receipt.target.organization_id) return end('NONE', 'TARGET_NOT_AUTHORIZED');
  if (typeof ctx.executionSource !== 'string' || !/^[0-9a-f]{40}$/.test(ctx.executionSource)) return end('NONE', 'EXECUTION_SOURCE_UNKNOWN');
  receipt.commentId = e.comment.id;

  const rr = await call(deps, 'GET', `repos/${ctx.repository}/actions/runs/${ctx.runId}`);
  const rv = rr?.status === 200 ? rr.json : null;
  if (!rv) return end('NONE', 'RUN_UNKNOWN');
  const run = { repository: rv.repository?.full_name, workflowId: rv.workflow_id, path: rv.path, number: rv.run_number, attempt: rv.run_attempt, id: rv.id };
  if (run.id !== ctx.runId || run.attempt !== ctx.runAttempt || rv.head_sha !== ctx.sha || run.repository !== ctx.repository) return end('NONE', 'RUN_IDENTITY_MISMATCH');
  receipt.run = { id: run.id, number: run.number, attempt: run.attempt, workflowId: run.workflowId };
  const selected = selectRunRange(config, run);
  if (!selected.range) return end('NONE', selected.cause);
  if (await workflowState(deps, ctx.repository, run.workflowId) !== 'active') return end('NONE', 'WORKFLOW_NOT_ACTIVE');

  const seen = await observe(deps, ctx.repository, e.issue.number, e.comment.node_id, e.comment.id);
  if (!seen) return end('NONE', 'SNAPSHOT_UNKNOWN');
  let context;
  try { context = config.context.map((c) => ({ role: c.role, path: c.path, content: deps.readFile(c.path) })); }
  catch { return end('NONE', 'CONTEXT_UNKNOWN'); }
  const admission = { repository: ctx.repository, owner: e.repository.owner.login, sha: ctx.executionSource, eventBody: e.comment.body,
    run: { id: run.id, number: run.number, attempt: run.attempt, workflowId: run.workflowId, path: run.path },
    issue: seen.issue, command: seen.command, context };
  const request = await admitIssueCommand(admission, config);
  if (request.status !== 'ADMITTED') return end('NONE', request.cause);
  if (seen.claims === null) return end('NONE', 'CLAIMS_INCOMPLETE');
  // Only EXECUTOR_LOGIN's reaction is a claim; known other logins are ignored, unattributable ones held.
  const prior = deriveIssuePrior(request, { claims: seen.claims, results: [] }, EXECUTOR_LOGIN);
  const next = nextIssueEffect(request, prior);
  if (next.effect !== 'EVALUATE') return end('NONE', prior?.state ?? next.cause);

  // Only a raw 201 for this principal and kind proceeds; 200 means another run already claimed this command.
  const claim = await call(deps, 'POST', `repos/${ctx.repository}/issues/comments/${e.comment.id}/reactions`, { content: CLAIM.rest });
  if (claim?.status === 200) return end('NONE', 'ALREADY_CLAIMED');
  if (!claim || claim.status !== 201 || claim.json?.user?.login !== EXECUTOR_LOGIN || claim.json?.content !== CLAIM.rest) {
    return end('UNKNOWN', claim ? 'CLAIM_NOT_OURS' : 'CLAIM_UNKNOWN', { claimed: 'UNKNOWN' });
  }
  receipt.claimed = true;
  // Checkpoint before any paid call: same subject, same command, exactly our claim, workflow still active.
  const again = await observe(deps, ctx.repository, e.issue.number, e.comment.node_id, e.comment.id);
  if (!again) return end('NONE', 'REREAD_UNKNOWN');
  if (!same(again.issue, seen.issue) || !same(again.command, seen.command) || again.claims === null || again.claims.includes(null)
    || again.claims.filter((x) => x === EXECUTOR_LOGIN).length !== 1) return end('NONE', 'DRIFT_BEFORE_CALL');
  if (await workflowState(deps, ctx.repository, run.workflowId) !== 'active') return end('NONE', 'WORKFLOW_NOT_ACTIVE');
  const out = end('PLANNED', 'EVALUATE', { providerCalls: null, callsPerRun: selected.callsPerRun, requestDigest: request.requestDigest });
  return { receipt: out.receipt, state: { ...out.state, admission }, plan: request.prepared.plan };
}

// Post one planned result (no key). The request is re-admitted from the run-local state (pure) and must have
// the same digest. Entry output: exact closed pre-provider refusal -> NONE; v2 result that composes for this
// request -> post; anything else -> UNKNOWN, never posted or retried. Before posting, workflow must be active
// and subject/command unchanged; otherwise the paid result is WITHHELD with its real accounting.
export async function postIssueCommand(stateValue, entryOut, configValue, deps) {
  const receipt = { schema: RECEIPT, stage: 'post', outcome: null, cause: null, authority: false };
  const end = (outcome, cause, extra = {}) => ({ receipt: Object.assign(receipt, { outcome, cause }, extra) });
  if (!stateValue || typeof stateValue !== 'object' || typeof stateValue.outcome !== 'string') return end('UNKNOWN', 'STATE_UNKNOWN');
  if (stateValue.outcome !== 'PLANNED') { const { admission, ...rest } = stateValue; return { receipt: { ...rest, stage: 'post' } }; }
  Object.assign(receipt, { commentId: stateValue.commentId, run: stateValue.run, claimed: true, requestDigest: stateValue.requestDigest });
  const adm = stateValue.admission;
  const request = await admitIssueCommand(adm, configValue);
  if (request.status !== 'ADMITTED' || request.requestDigest !== stateValue.requestDigest) return end('UNKNOWN', 'STATE_MISMATCH');
  const owner = classifyOwnerOutput(entryOut);
  if (owner.kind === 'REFUSED') return end('NONE', 'REFUSED_BEFORE_PROVIDER', { entryCause: owner.cause, providerCalls: 0 });
  if (owner.kind !== 'RESULT') return end('UNKNOWN', 'LAUNCH_UNKNOWN', { providerCalls: null });
  let body;
  try { body = composeResultComment(request, owner.value); } catch { return end('UNKNOWN', 'RESULT_UNVERIFIED', { providerCalls: null }); }
  const a = owner.value.accounting;
  receipt.accounting = { providerHttpCalls: a.providerHttpCalls, completedHttpCalls: a.completedHttpCalls,
    validatedResponses: a.validatedResponses, unknownHttpCalls: a.unknownHttpCalls };
  receipt.providerCalls = a.providerHttpCalls;
  // Honest closed record: not-selected/incomplete/failed items are posted but never counted as complete success.
  receipt.complete = a.unknownHttpCalls === 0 && a.validatedResponses === request.prepared.plannedCalls
    && owner.value.cases.every((x) => x.result.records.every((r) => ['OBSERVED', 'NOT_SELECTED'].includes(r.status)));

  if (await workflowState(deps, adm.repository, adm.run.workflowId) !== 'active') return end('WITHHELD', 'WORKFLOW_NOT_ACTIVE');
  const now = await observe(deps, adm.repository, adm.issue.number, adm.command.nodeId, adm.command.databaseId);
  if (!now) return end('WITHHELD', 'REREAD_UNKNOWN');
  if (!same(now.issue, adm.issue) || !same(now.command, adm.command)) return end('WITHHELD', 'DRIFT_AFTER_CALL');
  const post = await call(deps, 'POST', `repos/${adm.repository}/issues/${adm.issue.number}/comments`, { body });
  const resultId = post?.json?.id;
  if (!post || post.status !== 201 || !positive(resultId)) return end('UNKNOWN', 'APPEND_UNKNOWN');
  receipt.resultId = resultId;
  const read = await call(deps, 'GET', `repos/${adm.repository}/issues/comments/${resultId}`);
  const where = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)$/.exec(read?.json?.issue_url ?? '');
  if (read?.status !== 200 || !where) return end('UNKNOWN', 'READBACK_UNKNOWN');
  const observed = { repository: where[1], issue: Number(where[2]), id: read.json.id, author: read.json.user?.login, body: read.json.body };
  if (!verifyResultReadback(request, body, observed, EXECUTOR_LOGIN, resultId)) return end('MISMATCH', 'READBACK_MISMATCH');
  return end('APPENDED', 'READBACK_EXACT');
}

// Production GitHub access: the run's GITHUB_TOKEN only, bounded time, redirects refused, no retry.
export function githubDeps({ token, apiUrl, graphqlUrl, root }) {
  const headers = (body) => ({ authorization: `Bearer ${token}`, accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28', ...(body === undefined ? {} : { 'content-type': 'application/json' }) });
  const request = async (url, method, body) => {
    const res = await fetch(url, { method, headers: headers(body), redirect: 'error', signal: AbortSignal.timeout(30000),
      body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, json: text ? json(text) : null };
  };
  const base = path.resolve(root);
  return {
    github: (method, route, body) => request(`${apiUrl}/${route}`, method, body),
    graphql: async (query, variables) => {
      const res = await request(graphqlUrl, 'POST', { query, variables });
      if (res.status !== 200) throw new Error('GRAPHQL_HTTP');
      return res.json;
    },
    readFile: (rel) => {
      const abs = path.resolve(base, rel);
      if (!abs.startsWith(base + path.sep)) throw new Error('CONTEXT_OUTSIDE_SOURCE');
      return fs.readFileSync(abs, 'utf8');
    },
  };
}

// CLI: `node issue-executor.mjs plan|post <absolute run-local dir>`. Settings are the reviewed issue-actions.json
// beside this file; context files are read from the checked-out exact source (cwd).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, dir, ...rest] = process.argv.slice(2);
  const print = (receipt) => process.stdout.write(JSON.stringify(receipt) + '\n');
  if (rest.length || !['plan', 'post'].includes(mode) || !dir || !path.isAbsolute(dir)) {
    print({ schema: RECEIPT, outcome: 'NONE', cause: 'INVALID_EXECUTOR_ARGS', authority: false });
    process.exitCode = 2;
  } else {
    const config = json(fs.readFileSync(new URL('./issue-actions.json', import.meta.url), 'utf8'));
    const deps = githubDeps({ token: process.env.GITHUB_TOKEN, apiUrl: process.env.GITHUB_API_URL,
      graphqlUrl: process.env.GITHUB_GRAPHQL_URL, root: process.cwd() });
    const file = (name) => path.join(dir, name);
    if (mode === 'plan') {
      const ctx = { repository: process.env.GITHUB_REPOSITORY, sha: process.env.GITHUB_SHA, executionSource: process.env.JEV_EXECUTION_SOURCE,
        runId: Number(process.env.GITHUB_RUN_ID), runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
        event: json(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')) };
      const result = await planIssueCommand(ctx, config, deps);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file('state.json'), JSON.stringify(result.state), { flag: 'wx' });
      if (result.plan) fs.writeFileSync(file('plan.json'), JSON.stringify(result.plan), { flag: 'wx' });
      print(result.receipt);
      process.exitCode = result.receipt.outcome === 'UNKNOWN' ? 1 : 0;
    } else {
      const read = (name) => { try { return fs.readFileSync(file(name), 'utf8'); } catch { return null; } };
      const status = read('entry.status');
      const entryOut = status === null ? null : { status: Number(status.trim()), stdout: read('entry.out') ?? '' };
      const result = await postIssueCommand(json(read('state.json') ?? ''), entryOut, config, deps);
      print(result.receipt);
      process.exitCode = ['APPENDED', 'NONE'].includes(result.receipt.outcome) ? 0 : 1;
    }
  }
}
