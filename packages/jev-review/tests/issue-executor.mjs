import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JEV_MODEL, validateJevBudget } from '../core.mjs';
import { semlint } from '../semlint.mjs';
import { ENTRY_LIMITS, preparePlan, executeOwnerPlan } from '../semlint-entry.mjs';
import { REQUEST_PREFIX, RESULT_PREFIX, PROVIDED_COMMAND_OBSERVATION, validateActionsConfig, selectRunRange, subjectRevision, admitIssueCommand } from '../github-comment.mjs';
import { EXECUTOR_LOGIN, CLAIM, ISSUE_QUERY, PULL_REQUEST_QUERY, COMMENT_QUERY, PRE_PROVIDER_CAUSES, planIssueCommand, postIssueCommand,
  classifyOwnerOutput, decodeFullDatabaseId, claimResponseDiagnostics, githubDeps } from '../issue-executor.mjs';

// Repository policy is an explicit producer input, never an ambient checkout fallback in a provided runtime.
const sourceArgs = process.argv.slice(2);
assert.ok(sourceArgs.length === 0 || (sourceArgs.length === 2 && sourceArgs[0] === '--source-contract'
  && path.isAbsolute(sourceArgs[1])), 'INVALID_SOURCE_CONTRACT_ARGS');
const sourceRoot = sourceArgs.length ? sourceArgs[1] : null;

// Secret-free fixtures only: an in-memory GitHub (REST + GraphQL) and the real fixed entry functions in process
// with a counting fetch stand in for one Actions run. Nothing here is real-provider, reaction, posting or
// Actions-runtime evidence. Invariants of the replaced OCI scan adapter are carried over, not dropped: raw-201
// claim and 200, fullDatabaseId decode, forged results, foreign/unattributable reactions, drift before/after the
// paid call, UNKNOWN never retried, exact entry classification and the static key boundary.
const hash = (x) => createHash('sha256').update(x).digest('hex');
const REPO = 'roccho-dev/ops', OWNER = 'roccho-dev', TRUSTED = 'fixture-member', SHA = 'c'.repeat(40), WF = 900001;
const WF_PATH = '.github/workflows/jev-issue-comment.yml';
const CHECKS = ['aligned.authority-grant', 'closed.feedback-completion', 'unique.canonical-responsibility',
  'minimal.necessary-layer', 'measurable.attempt-accounting', 'improving.comparable-evidence'];
const ROLES = ['authorityContract', 'completionContract', 'responsibilityContract', 'requiredContracts',
  'dependencyDescription', 'accountingContract', 'registeredCases', 'qualityContract', 'baselineEvidence'];
const CONTEXT = ROLES.map((role) => ({ role, path: `docs/fixture/${role}.md` }));
const FILES = Object.fromEntries(CONTEXT.map((c) => [c.path, `public ${c.role} contract (fixture)`]));
const range = (over = {}) => ({ repository: REPO, workflowId: WF, path: WF_PATH, first: 1, last: 10, reservedCallsPerRun: 1, ...over });
const provider = () => ({ repository: `${OWNER}/envs`, revision: 'a'.repeat(40), path: 'handoffs/dev-jev-api.github-actions.json',
  receipt: { kind: 'envs.orgSecretProjectionReceipt.v1', source: 'b'.repeat(40), binding: 'jev-api.github-actions',
    controller: TRUSTED, created_at: '2026-10-07T00:00:00Z', operation: 'github_org_secret_put',
    target: { provider: 'github-org-secret', organization: OWNER, organization_id: '123', secret_name: 'JEV_API_KEY',
      repositories: [REPO], repository_ids: ['456'] }, readback: 'SECRET_NAME_AND_SELECTED_REPOSITORY_IDS', provider_use: 'NOT_RUN' } });
const config = (over = {}) => ({ trustedCallers: [TRUSTED], allowedChecks: [...CHECKS], context: CONTEXT.map((c) => ({ ...c })),
  subjectScope: 'entire Issue body (fixture)', limits: { ...ENTRY_LIMITS, maxCases: 1, maxCalls: 1 }, runRanges: [range()],
  targets: [{ repository: REPO, repositoryId: '456', issue: 483 }], provider: provider(), ...over });
const tokenIn = (query, field) => new RegExp(`(^|[\\s{])${field.replace(/[{}()[\]:,]/g, '\\$&')}(?=[\\s}])`).test(query);

function world(repository = REPO, issueNumber = 483, workflowId = WF, targetKind = 'issue') {
  const w = { repository, targetKind, issue: { number: issueNumber, id: `${targetKind === 'pull-request' ? 'PR' : 'I'}_${issueNumber}`, body: 'Issue body: public fixture subject, not an instruction.',
    lastEditedAt: null, includesCreatedEdit: false, edits: 0 }, comments: [], workflow: { id: workflowId, state: 'active' },
  runs: new Map(), nextRunNumber: 1, nextId: 7000, posted: [], hooks: {},
  calls: { run: 0, workflow: 0, issueQ: 0, commentQ: 0, claim: 0, post: 0, read: 0, fetch: 0 } };
  w.addComment = (over = {}) => {
    const c = { databaseId: w.nextId++, author: TRUSTED, body: '/jev-evaluate', lastEditedAt: null, includesCreatedEdit: false,
      edits: 0, reactions: [], ...over };
    c.nodeId ??= `IC_${c.databaseId}`;
    w.comments.push(c); return c;
  };
  w.newRun = (over = {}) => {
    const id = 8000000 + w.runs.size + 1;
    const r = { id, workflow_id: workflowId, path: WF_PATH, run_number: w.nextRunNumber++, run_attempt: 1, head_sha: SHA,
      repository: { full_name: repository }, ...over };
    w.runs.set(id, r); return r;
  };
  const issueNode = () => ({ id: w.issue.id, number: w.issue.number, body: w.issue.body, lastEditedAt: w.issue.lastEditedAt,
    includesCreatedEdit: w.issue.includesCreatedEdit, userContentEdits: { totalCount: w.issue.edits } });
  // Official wire: fullDatabaseId is BigInt encoded as a string; Int32 databaseId is never requested or returned.
  const commentNode = (c) => ({ ...c.extraKeys, id: c.nodeId, fullDatabaseId: 'wireId' in c ? c.wireId : String(c.databaseId),
    author: c.author === null ? null : { login: c.author }, body: c.body, lastEditedAt: c.lastEditedAt,
    includesCreatedEdit: c.includesCreatedEdit, userContentEdits: { totalCount: c.edits },
    reactions: { totalCount: c.reactions.length + (c.hiddenReactions ?? 0),
      nodes: c.reactions.map((r) => ({ content: CLAIM.graphql, user: r.user === null ? null : { login: r.user } })) } });
  const graphql = async (query, vars) => {
    // Independent of the exported constants: no Int32 databaseId and no generic updatedAt are ever requested.
    assert.equal(/\bdatabaseId\b/.test(query), false); assert.equal(/\bupdatedAt\b/.test(query), false);
    if (query === ISSUE_QUERY || query === PULL_REQUEST_QUERY) {
      for (const f of ['id', 'number', 'body', 'lastEditedAt', 'includesCreatedEdit', 'userContentEdits{totalCount}']) assert.ok(tokenIn(query, f), f);
      assert.deepEqual(vars, { owner: repository.split('/')[0], name: repository.split('/')[1], number: issueNumber });
      w.calls.issueQ++;
      const r = w.hooks.issueQuery?.(w, issueNode()); if (r !== undefined) return r;
      const field = query === PULL_REQUEST_QUERY ? 'pullRequest' : 'issue';
      return { data: { repository: { [field]: (field === 'pullRequest') === (targetKind === 'pull-request') ? issueNode() : null } } };
    }
    assert.equal(query, COMMENT_QUERY);
    for (const f of ['id', 'fullDatabaseId', 'author{login}', 'body', 'lastEditedAt', 'includesCreatedEdit', 'userContentEdits{totalCount}',
      'reactions(content:EYES,first:100){totalCount nodes{content user{login}}}']) assert.ok(tokenIn(query, f), f);
    w.calls.commentQ++;
    const c = w.comments.find((x) => x.nodeId === vars.id);
    const r = w.hooks.commentQuery?.(w, c ? commentNode(c) : null); if (r !== undefined) return r;
    return { data: { node: c ? commentNode(c) : null } };
  };
  const github = async (method, route, body) => {
    let m;
    assert.ok(route.startsWith(`repos/${repository}/`));
    const local = route.slice(`repos/${repository}/`.length);
    if (method === 'GET' && (m = /^actions\/runs\/(\d+)$/.exec(local))) {
      w.calls.run++; const r = w.runs.get(Number(m[1]));
      return r ? { status: 200, json: r } : { status: 404, json: {} };
    }
    if (method === 'GET' && (m = /^actions\/workflows\/(\d+)$/.exec(local))) {
      w.calls.workflow++;
      return Number(m[1]) === w.workflow.id ? { status: 200, json: { id: w.workflow.id, state: w.workflow.state } } : { status: 404, json: {} };
    }
    if (method === 'POST' && (m = /^issues\/comments\/(\d+)\/reactions$/.exec(local))) {
      assert.deepEqual(body, { content: 'eyes' }); w.calls.claim++;
      await w.hooks.beforeClaim?.(w);
      const c = w.comments.find((x) => x.databaseId === Number(m[1]));
      let reply = c.reactions.some((r) => r.user === EXECUTOR_LOGIN) ? { status: 200, json: { user: { login: EXECUTOR_LOGIN }, content: 'eyes' } }
        : (c.reactions.push({ user: EXECUTOR_LOGIN }), { status: 201, json: { user: { login: w.hooks.claimUser ?? EXECUTOR_LOGIN }, content: 'eyes' } });
      if (w.hooks.afterClaim) reply = w.hooks.afterClaim(w, c, reply);
      if (reply instanceof Error) throw reply;
      return reply;
    }
    if (method === 'POST' && local === `issues/${issueNumber}/comments`) {
      w.calls.post++;
      const r = w.hooks.post?.(w, body); if (r instanceof Error) throw r; if (r !== undefined) return r;
      const c = w.addComment({ author: EXECUTOR_LOGIN, body: body.body }); w.posted.push(c);
      return { status: 201, json: { id: c.databaseId, user: { login: EXECUTOR_LOGIN }, body: c.body } };
    }
    if (method === 'GET' && (m = /^issues\/comments\/(\d+)$/.exec(local))) {
      w.calls.read++; const c = w.comments.find((x) => x.databaseId === Number(m[1]));
      return c ? { status: 200, json: { id: c.databaseId, user: { login: c.author }, body: w.hooks.readBody ?? c.body,
        issue_url: `https://api.github.com/repos/${repository}/issues/${issueNumber}` } } : { status: 404, json: {} };
    }
    throw new Error(`unexpected GitHub call ${method} ${route}`);
  };
  w.deps = { github, graphql, readFile: (p) => { if (!Object.hasOwn(FILES, p)) throw new Error('missing'); return FILES[p]; } };
  // The workflow's single key-bearing step: only the fixed entry runs on plan.json; exit status and stdout kept.
  w.entry = async (plan) => {
    const hooked = await w.hooks.entry?.(w, plan); if (hooked) return hooked;
    let prepared;
    try { prepared = await preparePlan(plan); }
    catch (error) { return { status: 1, stdout: JSON.stringify({ schema: 'ops.semlint.entry-error.v1', status: 'REJECTED', cause: error.message, authority: false }) + '\n' }; }
    const result = await executeOwnerPlan(prepared, 'synthetic-fixture-key', async (url, init) => {
      w.calls.fetch++;
      if (w.hooks.fetch) return w.hooks.fetch(url, init);
      return new Response(JSON.stringify({ model: JEV_MODEL,
        answers: Object.fromEntries(Object.keys(JSON.parse(init.body).questions).map((k) => [k, { type: 'noul', noul: 0.4 }])) }), { status: 200 });
    });
    return { status: 0, stdout: JSON.stringify(result) + '\n' };
  };
  return w;
}
// Event payload as GitHub delivers it at comment creation (copied, so later drift is observable).
const ctxFor = (w, c, run) => ({ repository: w.repository, sha: SHA, executionSource: SHA, runId: run.id, runAttempt: run.run_attempt,
  event: { comment: { id: c.databaseId, node_id: c.nodeId, body: c.body, user: { login: c.author } },
    issue: { number: w.issue.number, ...(w.targetKind === 'pull-request' ? { pull_request: { url: `https://api.github.com/repos/${w.repository}/pulls/${w.issue.number}` } } : {}) },
    repository: { id: w.repository.endsWith('/ops') ? 456 : 789, full_name: w.repository,
      owner: { id: 123, login: OWNER, type: 'Organization' } } } });
// One Actions run: plan step -> run-local JSON files -> key-bearing step (fixed entry only) -> post step.
async function fullRun(w, c, { run = w.newRun(), cfg = config(), ctx, afterEntry } = {}) {
  const p = await planIssueCommand(ctx ?? ctxFor(w, c, run), cfg, w.deps);
  const state = JSON.parse(JSON.stringify(p.state));
  let out = null;
  if (p.plan) { out = await w.entry(JSON.parse(JSON.stringify(p.plan))); await afterEntry?.(w); }
  const q = await postIssueCommand(state, out, cfg, w.deps);
  return { plan: p.receipt, post: q.receipt, run, planBody: p.plan };
}
const effects = (w) => ({ claim: w.calls.claim, fetch: w.calls.fetch, post: w.calls.post });
const zero = { claim: 0, fetch: 0, post: 0 };
const outcome = (r) => [r.post.outcome, r.post.cause];
let scenarios = 0;
const check = async (name, fn) => { await fn(); scenarios++; };

await check('claim-response-allowlist', async () => {
  const empty = { httpStatus: null, requestId: null, acceptedPermissions: null, errorCode: null,
    reactionId: null, reactionLogin: null, reactionContent: null };
  assert.deepEqual(claimResponseDiagnostics(null), empty);
  const secret = 'SYNTHETIC_PRIVATE_SENTINEL_DO_NOT_EMIT';
  for (const malformed of [secret, 'x'.repeat(1000), '\n', {}, [], 42, null]) {
    const evidence = claimResponseDiagnostics({ status: malformed, metadata: { requestId: malformed,
      acceptedPermissions: malformed, authorization: secret }, json: { message: malformed, body: secret,
      token: secret, id: malformed, user: { login: malformed }, content: malformed } });
    assert.deepEqual(evidence, { ...empty,
      reactionId: malformed === 42 ? 42 : null });
    assert.equal(JSON.stringify(evidence).includes(secret), false);
  }
  for (const invalid of ['issues=admin', 'contents=write', 'issues=write; authorization=write',
    'issues=write\n', 'issues=write;pull_requests=write;'.repeat(10)]) {
    assert.equal(claimResponseDiagnostics({ metadata: { acceptedPermissions: invalid } }).acceptedPermissions, null);
  }
  for (const invalid of ['ABCD:1:2', 'ABCD:1:2:3\n', 'abcd:1:2:3', 'ABCD:' + 'F'.repeat(97)]) {
    assert.equal(claimResponseDiagnostics({ metadata: { requestId: invalid } }).requestId, null);
  }
  assert.equal(claimResponseDiagnostics({ json: { message: '__proto__' } }).errorCode, null);
  assert.equal(claimResponseDiagnostics({ json: { message: 'Not Found: ' + secret } }).errorCode, null);
  for (const invalid of ['github-actions[bot]\n', 'owner/token', 'a'.repeat(45), secret]) {
    assert.equal(claimResponseDiagnostics({ json: { user: { login: invalid } } }).reactionLogin, null);
  }
  for (const invalid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '99']) {
    assert.equal(claimResponseDiagnostics({ json: { id: invalid } }).reactionId, null);
  }
  assert.deepEqual(claimResponseDiagnostics({ status: 403, metadata: { requestId: 'ABCD:1:2345:6789:ABCD',
    acceptedPermissions: 'issues=write;pull_requests=write' }, json: { message: 'Resource not accessible by integration' } }),
  { ...empty, httpStatus: 403, requestId: 'ABCD:1:2345:6789:ABCD', acceptedPermissions: 'issues=write;pull_requests=write',
    errorCode: 'RESOURCE_NOT_ACCESSIBLE_BY_INTEGRATION' });
});

await check('claim-response-receipts-preserve-effects', async () => {
  for (const [reply, expected] of [
    [{ status: 403, json: { message: 'Resource not accessible by integration' } }, ['UNKNOWN', 'CLAIM_NOT_OURS']],
    [{ status: 404, json: { message: 'Not Found' } }, ['UNKNOWN', 'CLAIM_NOT_OURS']],
    [{ status: 422, json: { message: 'Validation Failed' } }, ['UNKNOWN', 'CLAIM_NOT_OURS']],
    [{ status: 201, json: { id: 99, user: { login: 'another-bot[bot]' }, content: 'eyes' } }, ['UNKNOWN', 'CLAIM_NOT_OURS']],
    [{ status: 201, json: { id: 99, user: { login: EXECUTOR_LOGIN }, content: 'heart' } }, ['UNKNOWN', 'CLAIM_NOT_OURS']],
    [{ status: 201, json: null }, ['UNKNOWN', 'CLAIM_NOT_OURS']],
    [{ status: 200, json: { user: { login: EXECUTOR_LOGIN }, content: 'eyes' } }, ['NONE', 'ALREADY_CLAIMED']],
    [new Error('SYNTHETIC_PRIVATE_SENTINEL_DO_NOT_EMIT'), ['UNKNOWN', 'CLAIM_UNKNOWN']],
  ]) {
    const fixture = world();
    fixture.hooks.afterClaim = () => reply;
    const result = await fullRun(fixture, fixture.addComment());
    assert.deepEqual(outcome(result), expected);
    assert.deepEqual(effects(fixture), { claim: 1, fetch: 0, post: 0 });
    assert.equal(result.planBody, undefined);
    assert.deepEqual(result.plan.claimResponse, claimResponseDiagnostics(reply instanceof Error ? null : reply));
    assert.deepEqual(result.post.claimResponse, result.plan.claimResponse);
    assert.equal(JSON.stringify(result).includes('SYNTHETIC_PRIVATE_SENTINEL_DO_NOT_EMIT'), false);
  }
  const fixture = world();
  fixture.hooks.afterClaim = (_fixture, _comment, reply) => ({ ...reply, json: { ...reply.json, id: 99 },
    metadata: { requestId: 'ABCD:1:2345:6789:ABCD', acceptedPermissions: 'issues=write' } });
  const result = await fullRun(fixture, fixture.addComment());
  assert.deepEqual(outcome(result), ['APPENDED', 'READBACK_EXACT']);
  assert.deepEqual(effects(fixture), { claim: 1, fetch: 1, post: 1 });
  assert.equal(result.plan.claimResponse.reactionId, 99);
  assert.equal(result.plan.claimResponse.reactionLogin, EXECUTOR_LOGIN);
  assert.equal(result.plan.claimResponse.reactionContent, 'eyes');
  assert.equal(JSON.stringify(result.planBody).includes('claimResponse'), false);
});

await check('native-claim-response-metadata-without-extra-request', async () => {
  const originalFetch = globalThis.fetch;
  const secret = 'SYNTHETIC_PRIVATE_SENTINEL_DO_NOT_EMIT';
  let requests = 0;
  const deps = githubDeps({ token: secret, apiUrl: 'https://fixture.invalid', graphqlUrl: 'https://fixture.invalid/graphql', root: '/' });
  try {
    for (const [status, body, headers] of [
      [403, JSON.stringify({ message: 'Resource not accessible by integration', secret }),
        { 'x-github-request-id': 'ABCD:1:2345:6789:ABCD', 'x-accepted-github-permissions': 'issues=write, pull_requests=write', authorization: secret }],
      [201, JSON.stringify({ id: 99, user: { login: EXECUTOR_LOGIN }, content: 'eyes', secret }), {}],
      [422, 'not json ' + secret, { 'x-github-request-id': secret, 'x-accepted-github-permissions': secret }],
    ]) {
      globalThis.fetch = async (url, init) => {
        requests++;
        assert.equal(url, 'https://fixture.invalid/repos/fixture/repo/issues/comments/1/reactions');
        assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error');
        assert.equal(init.headers.authorization, 'Bearer ' + secret);
        assert.deepEqual(JSON.parse(init.body), { content: 'eyes' });
        return new Response(body, { status, headers });
      };
      const response = await deps.github('POST', 'repos/fixture/repo/issues/comments/1/reactions', { content: 'eyes' });
      const evidence = claimResponseDiagnostics(response);
      assert.equal(evidence.httpStatus, status);
      assert.equal(JSON.stringify(evidence).includes(secret), false);
      assert.deepEqual(Object.keys(response.metadata).sort(), ['acceptedPermissions', 'requestId']);
      if (status === 403) {
        assert.equal(evidence.errorCode, 'RESOURCE_NOT_ACCESSIBLE_BY_INTEGRATION');
        assert.equal(evidence.acceptedPermissions, 'issues=write, pull_requests=write');
      }
      if (status === 201) assert.equal(evidence.reactionLogin, EXECUTOR_LOGIN);
      if (status === 422) assert.deepEqual(response.metadata, { requestId: null, acceptedPermissions: null });
    }
    assert.equal(requests, 3);
    globalThis.fetch = async () => { requests++; return new Response('{}', { status: 200,
      headers: { 'x-github-request-id': 'ABCD:1:2345:6789:ABCD' } }); };
    const response = await deps.github('GET', 'repos/fixture/repo/issues/comments/1/reactions');
    assert.equal(Object.hasOwn(response, 'metadata'), false);
    assert.equal(requests, 4);
    globalThis.fetch = async () => { requests++; throw new Error(secret); };
    await assert.rejects(deps.github('POST', 'repos/fixture/repo/issues/comments/1/reactions', { content: 'eyes' }));
    assert.equal(requests, 5);
  } finally { globalThis.fetch = originalFetch; }
});

// Normal path: a first command and a later eligible command, with no operator action in between.
await check('normal-first-and-later', async () => {
  const w = world();
  const c1 = w.addComment();
  const r1 = await fullRun(w, c1);
  assert.equal(r1.plan.outcome, 'PLANNED'); assert.equal(r1.plan.callsPerRun, 1); assert.deepEqual(outcome(r1), ['APPENDED', 'READBACK_EXACT']);
  assert.equal(r1.post.complete, true);
  assert.deepEqual(r1.post.accounting, { providerHttpCalls: 1, completedHttpCalls: 1, validatedResponses: 1, unknownHttpCalls: 0 });
  assert.deepEqual(r1.planBody.limits, { ...ENTRY_LIMITS, maxCases: 1, maxCalls: 1 });
  const posted = w.posted[0];
  assert.equal(posted.author, EXECUTOR_LOGIN); assert.ok(posted.body.startsWith(RESULT_PREFIX));
  assert.equal(posted.body.includes('synthetic-fixture-key'), false);
  const { identity } = JSON.parse(posted.body.slice(RESULT_PREFIX.length));
  assert.deepEqual(identity.run, { id: r1.run.id, number: 1, attempt: 1, workflowId: WF });
  assert.equal(identity.commentId, c1.databaseId); assert.equal(identity.executionSource, SHA); assert.equal(identity.author, TRUSTED);
  assert.equal(identity.observation, 'ACTIONS_TRUSTED_LITERAL_COMMAND'); assert.equal('action' in identity, false);
  assert.equal(identity.subjectRevision, subjectRevision({ number: 483, nodeId: 'I_483', body: w.issue.body, lastEditedAt: null,
    includesCreatedEdit: false, userContentEditsTotal: 0 }));
  w.addComment({ author: 'someone', body: 'unrelated discussion' }); // unrelated activity is not a subject revision
  const c2 = w.addComment();
  const r2 = await fullRun(w, c2);
  assert.deepEqual(outcome(r2), ['APPENDED', 'READBACK_EXACT']); assert.equal(r2.run.run_number, 2);
  assert.deepEqual(effects(w), { claim: 2, fetch: 2, post: 2 });
});

// Hard reservation: attempted provider calls <= sum(width x reserved), independent of comment history.
await check('reservation-bound', async () => {
  const w = world();
  const cfg = config({ runRanges: [range({ first: 2, last: 4 })] });
  w.newRun(); // run 1: a skipped or non-trigger run still consumes a native run number (slot waste)
  const cmds = [], results = [];
  for (let i = 0; i < 5; i++) { cmds.push(w.addComment()); results.push(await fullRun(w, cmds[i], { cfg })); }
  assert.deepEqual(results.map((r) => r.post.cause), ['READBACK_EXACT', 'READBACK_EXACT', 'READBACK_EXACT', 'NO_RANGE', 'NO_RANGE']);
  assert.ok(w.calls.fetch <= 3 * 1); assert.deepEqual(effects(w), { claim: 3, fetch: 3, post: 3 });
  // A settings change does not reset a claimed command: its re-delivery (run 7) is not re-evaluated.
  const cfg2 = config({ subjectScope: 'changed scope', runRanges: [range({ first: 2, last: 4 }), range({ first: 7, last: 9 })] });
  assert.deepEqual(outcome(await fullRun(w, cmds[0], { cfg: cfg2 })), ['NONE', 'STARTED']); assert.equal(w.calls.fetch, 3);
  // Effective per-run ceiling is min(reserved, caller cap); the cap only reduces it.
  const run = { repository: REPO, workflowId: WF, path: WF_PATH, number: 1, attempt: 1, id: 1 };
  assert.equal(selectRunRange(config({ limits: { ...ENTRY_LIMITS, maxCalls: 2 } }), run).callsPerRun, 1);
  assert.equal(selectRunRange(config({ limits: { ...ENTRY_LIMITS, maxCalls: 2 }, runRanges: [range({ reservedCallsPerRun: 3 })] }), run).callsPerRun, 2);
  // Explicit unconfigured settings stay a source hold, independent of later authorized adoption.
  const shipped = JSON.parse(fs.readFileSync(new URL('../issue-actions.json', import.meta.url), 'utf8'));
  validateActionsConfig(shipped);
  const held = { ...shipped, trustedCallers: [], context: [], runRanges: [], targets: [], providedRequestTargets: [], provider: null };
  const s = world(); const rs = await fullRun(s, s.addComment(), { cfg: held });
  assert.deepEqual(outcome(rs), ['NONE', 'PROVIDER_NOT_CONFIGURED']); assert.deepEqual(effects(s), zero);
  assert.equal(s.calls.issueQ + s.calls.commentQ + s.calls.workflow, 0);
});

// Public adopted history is retained; this grant adds 200 slots, never resets the first four.
await check('reviewed-budget-addition', async () => {
  const raw = JSON.parse(fs.readFileSync(new URL('../issue-actions.json', import.meta.url), 'utf8'));
  const shipped = validateActionsConfig(raw);
  const old = [
    { repository: 'roccho-org/ops', workflowId: 377399991, path: WF_PATH, first: 1, last: 1, reservedCallsPerRun: 1 },
    { repository: 'roccho-org/ops', workflowId: 377399991, path: WF_PATH, first: 2, last: 2, reservedCallsPerRun: 1 },
    { repository: 'roccho-org/envs', workflowId: 377400122, path: WF_PATH, first: 1, last: 1, reservedCallsPerRun: 1 },
    { repository: 'roccho-org/envs', workflowId: 377400122, path: WF_PATH, first: 2, last: 2, reservedCallsPerRun: 1 },
  ];
  assert.deepEqual(raw.runRanges.slice(0, 4), old);
  const added = shipped.runRanges.slice(4);
  assert.equal(added.length, 2);
  assert.equal(added.reduce((n, r) => n + (r.last - r.first + 1) * r.reservedCallsPerRun, 0), 200);
  assert.equal(shipped.runRanges.reduce((n, r) => n + (r.last - r.first + 1) * r.reservedCallsPerRun, 0), 204);
  assert.equal(shipped.limits.maxCalls, 1);
  for (const r of added) {
    assert.equal(r.last - r.first + 1, 100);
    const run = (number, attempt = 1) => ({ repository: r.repository, workflowId: r.workflowId,
      path: r.path, number, attempt, id: 1 });
    for (const number of [r.first, r.last]) assert.equal(selectRunRange(shipped, run(number)).callsPerRun, 1);
    assert.equal(selectRunRange(shipped, run(r.last + 1)).cause, 'NO_RANGE');
    assert.equal(selectRunRange(shipped, run(r.first, 2)).cause, 'RERUN_NOT_PAID');
    assert.equal(selectRunRange(shipped, { ...run(r.first), workflowId: r.workflowId + 1 }).cause, 'NO_RANGE');
  }
  assert.equal(selectRunRange(shipped, { repository: 'roccho-org/ops', workflowId: 377399991,
    path: WF_PATH, number: 3, attempt: 1, id: 1 }).cause, 'NO_RANGE');
});

// Native run identity is bound before any read or effect; reruns never spend.
await check('run-identity', async () => {
  for (const [runOver, ctxOver, cause] of [
    [{ run_attempt: 2 }, {}, 'RERUN_NOT_PAID'],
    [{ workflow_id: WF + 1 }, {}, 'NO_RANGE'],
    [{ path: '.github/workflows/other.yml' }, {}, 'NO_RANGE'],
    [{ head_sha: 'd'.repeat(40) }, {}, 'RUN_IDENTITY_MISMATCH'],
    [{ repository: { full_name: 'other/ops' } }, {}, 'RUN_IDENTITY_MISMATCH'],
    [{}, { runAttempt: 2 }, 'RUN_IDENTITY_MISMATCH'],
    [{}, { runId: 1 }, 'RUN_UNKNOWN'],
  ]) {
    const w = world(); const c = w.addComment(); const run = w.newRun(runOver);
    const r = await fullRun(w, c, { run, ctx: { ...ctxFor(w, c, run), ...ctxOver } });
    assert.deepEqual(outcome(r), ['NONE', cause]); assert.deepEqual(effects(w), zero);
    assert.equal(w.calls.issueQ + w.calls.commentQ, 0);
  }
});

// Trusted settings: closed shape, catalog subset, safe repository-relative context, non-overlapping reservations.
await check('settings-refusals', async () => {
  for (const bad of [
    { ...config(), extra: 1 }, config({ allowedChecks: [] }), config({ allowedChecks: [CHECKS[0], CHECKS[0]] }),
    config({ context: [{ role: 'authorityContract', path: '/etc/passwd' }] }), config({ context: [{ role: 'authorityContract', path: '../x.md' }] }),
    config({ context: [{ role: 'authorityContract', path: 'a/../b.md' }] }), config({ context: [CONTEXT[0], CONTEXT[0]] }),
    config({ context: [{ ...CONTEXT[0], program: '/bin/sh' }] }),
    config({ runRanges: [range(), range({ first: 10, last: 12 })] }), config({ runRanges: [range({ first: 5, last: 4 })] }),
    config({ runRanges: [range({ reservedCallsPerRun: 0 })] }), config({ runRanges: [range({ reservedCallsPerRun: 25 })] }),
    config({ runRanges: [range({ path: 'workflows/x.yml' })] }), config({ runRanges: [range({ workflowId: 0 })] }),
    config({ runRanges: [range({ argv: ['--x'] })] }), config({ limits: { ...ENTRY_LIMITS, maxCalls: 25 } }),
    config({ subjectScope: ' ' }), config({ trustedCallers: [TRUSTED, TRUSTED] }),
    config({ trustedCallers: ['*'] }), config({ trustedCallers: 'everyone' }),
  ]) {
    assert.throws(() => validateActionsConfig(bad), /INVALID_ACTIONS_CONFIG/);
    const w = world(); const r = await fullRun(w, w.addComment(), { cfg: bad });
    assert.deepEqual(outcome(r), ['NONE', 'INVALID_ACTIONS_CONFIG']); assert.deepEqual(effects(w), zero); assert.equal(w.calls.run, 0);
  }
  // The same numbers under another native workflow id are a different reservation, not an overlap.
  assert.equal(validateActionsConfig(config({ runRanges: [range(), range({ workflowId: WF + 1 })] })).runRanges.length, 2);
  // A check outside the existing catalog is refused at admission, before any claim.
  const w = world(); const r = await fullRun(w, w.addComment(), { cfg: config({ allowedChecks: ['unknown.check'] }) });
  assert.deepEqual(outcome(r), ['NONE', 'INVALID_REQUEST_OR_ADMISSION']); assert.deepEqual(effects(w), zero);
});

// The observed command must still be an explicitly trusted caller's unedited literal; context is required.
await check('command-admission', async () => {
  for (const [setup, mutate, cause] of [
    [(w) => w.addComment({ author: 'someone' }), null, 'COMMAND_NOT_AUTHORIZED'],
    [(w) => w.addComment({ author: OWNER }), null, 'COMMAND_NOT_AUTHORIZED'],
    [(w) => w.addComment(), (w, c, ctx) => { ctx.event.repository.owner.type = 'User'; }, 'ORG_REQUIRED'],
    [(w) => w.addComment(), (w, c, ctx) => { delete ctx.event.repository.owner.type; }, 'ORG_REQUIRED'],
    [(w) => w.addComment(), (w, c) => { c.body = '/jev-evaluate later'; }, 'COMMAND_DRIFT'],
    [(w) => w.addComment({ edits: 1, lastEditedAt: '2026-10-06T00:00:00Z' }), null, 'EDITED'],
    [(w) => w.addComment({ includesCreatedEdit: true }), null, 'EDITED'],
    [(w) => w.addComment(), (w, c, ctx) => { ctx.event.issue.pull_request = { url: 'x' }; }, 'TARGET_NOT_AUTHORIZED'],
    [(w) => w.addComment(), (w, c, ctx) => { ctx.event.repository.full_name = 'other/ops'; }, 'EVENT_UNKNOWN'],
  ]) {
    const w = world(); const c = setup(w); const run = w.newRun(); const ctx = ctxFor(w, c, run);
    mutate?.(w, c, ctx);
    const r = await fullRun(w, c, { run, ctx });
    assert.deepEqual(outcome(r), ['NONE', cause]); assert.deepEqual(effects(w), zero);
  }
  const w = world(); const r = await fullRun(w, w.addComment(), { cfg: config({ context: [{ role: 'authorityContract', path: 'docs/missing.md' }] }) });
  assert.deepEqual(outcome(r), ['NONE', 'CONTEXT_UNKNOWN']); assert.deepEqual(effects(w), zero);
  const closed = world(); const denied = await fullRun(closed, closed.addComment(), { cfg: config({ trustedCallers: [] }) });
  assert.deepEqual(outcome(denied), ['NONE', 'COMMAND_NOT_AUTHORIZED']); assert.deepEqual(effects(closed), zero);
});

// Incomplete, erroneous or mismatched provider observations: hold with no claim.
await check('snapshot-unknown', async () => {
  for (const mutate of [
    (w) => { w.hooks.issueQuery = () => ({ data: null, errors: [{ message: 'x' }] }); },
    (w) => { w.hooks.issueQuery = (_, node) => ({ data: { repository: { issue: { ...node, updatedAt: '2026-10-06T00:00:00Z' } } } }); },
    (w) => { w.hooks.issueQuery = () => ({ data: { repository: { issue: null } } }); },
    (w) => { w.hooks.issueQuery = () => { throw new Error('network'); }; },
    (w) => { w.hooks.commentQuery = (_, node) => ({ data: { node: { ...node, fullDatabaseId: '1' } } }); },
    (w) => { w.hooks.commentQuery = (_, node) => ({ data: { node: { ...node, fullDatabaseId: Number(node.fullDatabaseId) } } }); },
    (w) => { w.hooks.commentQuery = (_, node) => ({ data: { node: { ...node, databaseId: 1 } } }); },
    (w) => { w.hooks.commentQuery = () => ({ data: { node: null } }); },
  ]) {
    const w = world(); mutate(w);
    assert.deepEqual(outcome(await fullRun(w, w.addComment())), ['NONE', 'SNAPSHOT_UNKNOWN']); assert.deepEqual(effects(w), zero);
  }
  const w = world();
  assert.deepEqual(outcome(await fullRun(w, w.addComment({ hiddenReactions: 1 }))), ['NONE', 'CLAIMS_INCOMPLETE']);
  assert.deepEqual(effects(w), zero);
});

// Claims: only EXECUTOR_LOGIN's raw 201 pays; 200, prior claims, UNKNOWN and not-ours never pay or recall.
await check('claims', async () => {
  let w = world(); let c = w.addComment({ reactions: [{ user: EXECUTOR_LOGIN }] });
  assert.deepEqual(outcome(await fullRun(w, c)), ['NONE', 'STARTED']); assert.deepEqual(effects(w), zero);
  // Unattributable reaction is held; a known other login's reaction is not a claim (no principal migration).
  w = world(); c = w.addComment({ reactions: [{ user: null }] });
  assert.deepEqual(outcome(await fullRun(w, c)), ['NONE', 'UNRECOGNIZED']); assert.deepEqual(effects(w), zero);
  w = world(); c = w.addComment({ reactions: [{ user: 'a-human' }] });
  assert.deepEqual(outcome(await fullRun(w, c)), ['APPENDED', 'READBACK_EXACT']);
  // Duplicate delivery of one command: both runs pass admission, only the raw-201 winner pays and posts.
  w = world(); c = w.addComment();
  let arrived = 0, release; const gate = new Promise((r) => { release = r; });
  w.hooks.beforeClaim = async () => { if (++arrived === 2) release(); await gate; };
  const [a, b] = await Promise.all([fullRun(w, c), fullRun(w, c)]);
  assert.deepEqual([a, b].map((x) => x.post.cause).sort(), ['ALREADY_CLAIMED', 'READBACK_EXACT']);
  assert.deepEqual(effects(w), { claim: 2, fetch: 1, post: 1 });
  // Claim UNKNOWN, not ours or refused: no paid call; the post step does nothing.
  for (const hook of [() => new Error('network'), () => ({ status: 201, json: { user: { login: 'impostor' }, content: 'eyes' } }),
    (cc) => { cc.reactions.pop(); return { status: 403, json: {} }; }]) {
    w = world(); c = w.addComment(); w.hooks.afterClaim = (ww, cc) => hook(cc);
    const r = await fullRun(w, c);
    assert.equal(r.plan.outcome, 'UNKNOWN'); assert.equal(r.plan.claimed, 'UNKNOWN'); assert.equal(r.post.outcome, 'UNKNOWN');
    assert.deepEqual(effects(w), { claim: 1, fetch: 0, post: 0 });
  }
  // A claim created but whose response was lost is still a claim: a later delivery never recalls.
  w = world(); c = w.addComment(); w.hooks.afterClaim = () => new Error('lost response');
  await fullRun(w, c); delete w.hooks.afterClaim;
  assert.deepEqual(outcome(await fullRun(w, c)), ['NONE', 'STARTED']); assert.equal(w.calls.fetch, 0);
});

// Checkpoints: drift or stop before the paid call -> HTTP 0; after it -> post withheld with real accounting.
await check('drift-and-stop', async () => {
  const late = '2026-10-06T01:00:00Z';
  for (const change of [(w) => { w.issue.body += ' edited'; w.issue.lastEditedAt = late; w.issue.edits = 1; }, (w) => { w.issue.lastEditedAt = late; }]) {
    const w = world(); const c = w.addComment(); w.hooks.afterClaim = (ww, cc, reply) => { change(ww); return reply; };
    const r = await fullRun(w, c);
    assert.deepEqual(outcome(r), ['NONE', 'DRIFT_BEFORE_CALL']); assert.equal(r.plan.claimed, true);
    assert.deepEqual(effects(w), { claim: 1, fetch: 0, post: 0 });
    assert.deepEqual(outcome(await fullRun(w, c)), ['NONE', 'STARTED']); assert.equal(w.calls.fetch, 0);
  }
  for (const [change, cause] of [[(cc) => { cc.reactions.push({ user: null }); }, 'DRIFT_BEFORE_CALL'],
    [(cc) => { cc.reactions = []; }, 'DRIFT_BEFORE_CALL'], [(cc) => { cc.hiddenReactions = 1; }, 'DRIFT_BEFORE_CALL'],
    [(cc) => { cc.reactions.push({ user: 'a-human' }); }, 'READBACK_EXACT']]) {
    const w = world(); const c = w.addComment(); w.hooks.afterClaim = (ww, cc, reply) => { change(cc); return reply; };
    assert.equal((await fullRun(w, c)).post.cause, cause);
  }
  {
    const w = world(); const c = w.addComment();
    w.hooks.afterClaim = (ww, cc, reply) => { ww.hooks.issueQuery = () => ({ errors: [{ message: 'x' }] }); return reply; };
    assert.deepEqual(outcome(await fullRun(w, c)), ['NONE', 'REREAD_UNKNOWN']); assert.equal(w.calls.fetch, 0);
  }
  {
    const w = world(); w.workflow.state = 'disabled_manually';
    assert.deepEqual(outcome(await fullRun(w, w.addComment())), ['NONE', 'WORKFLOW_NOT_ACTIVE']); assert.deepEqual(effects(w), zero);
  }
  {
    const w = world(); w.hooks.afterClaim = (ww, cc, reply) => { ww.workflow.state = 'disabled_manually'; return reply; };
    assert.deepEqual(outcome(await fullRun(w, w.addComment())), ['NONE', 'WORKFLOW_NOT_ACTIVE']);
    assert.deepEqual(effects(w), { claim: 1, fetch: 0, post: 0 });
  }
  for (const [afterEntry, cause] of [[(w) => { w.workflow.state = 'disabled_manually'; }, 'WORKFLOW_NOT_ACTIVE'],
    [(w) => { w.issue.body += ' edited after the call'; }, 'DRIFT_AFTER_CALL'], [(w) => { w.issue.edits = 2; }, 'DRIFT_AFTER_CALL'],
    [(w) => { w.hooks.commentQuery = () => ({ errors: [{ message: 'x' }] }); }, 'REREAD_UNKNOWN']]) {
    const w = world();
    const r = await fullRun(w, w.addComment(), { afterEntry });
    assert.deepEqual(outcome(r), ['WITHHELD', cause]); assert.equal(r.post.providerCalls, 1);
    assert.deepEqual(r.post.accounting, { providerHttpCalls: 1, completedHttpCalls: 1, validatedResponses: 1, unknownHttpCalls: 0 });
    assert.deepEqual(effects(w), { claim: 1, fetch: 1, post: 0 });
  }
});

// Entry output: only an exact closed pre-provider refusal is a refusal; everything else not composable is UNKNOWN.
await check('entry-classification', async () => {
  const err = (extra) => ({ status: 1, stdout: JSON.stringify({ schema: 'ops.semlint.entry-error.v1', status: 'REJECTED', cause: 'INVALID_ENTRY_PLAN', authority: false, ...extra }) + '\n' });
  {
    const w = world(); w.hooks.entry = () => err({ cause: 'INVALID_ENTRY_LIMITS' });
    const r = await fullRun(w, w.addComment());
    assert.deepEqual(outcome(r), ['NONE', 'REFUSED_BEFORE_PROVIDER']); assert.equal(r.post.providerCalls, 0); assert.equal(w.calls.post, 0);
  }
  for (const out of [{ status: 1, stdout: '' }, err({ cause: 'ENTRY_FAILED' }), err({ authority: true }), err({ extra: 1 }),
    err({ status: 'ACCEPTED' }), { ...err({}), status: 0 }, { status: 1, stdout: err({}).stdout + err({}).stdout },
    { status: 0, stdout: '{}\n' }, { status: 0, stdout: 'not json\n' }, { status: null, stdout: '' }]) {
    const w = world(); w.hooks.entry = () => out;
    assert.deepEqual(outcome(await fullRun(w, w.addComment())), ['UNKNOWN', 'LAUNCH_UNKNOWN']); assert.equal(w.calls.post, 0);
  }
  {
    // A real v2 result for another plan does not compose for this request: paid, but never posted as trusted.
    const w = world(); w.hooks.entry = async (ww, plan) => { ww.hooks.entry = undefined; return ww.entry({ ...plan, cases: [{ ...plan.cases[0], id: 'other' }] }); };
    assert.deepEqual(outcome(await fullRun(w, w.addComment())), ['UNKNOWN', 'RESULT_UNVERIFIED']);
    assert.deepEqual(effects(w), { claim: 1, fetch: 1, post: 0 });
  }
  {
    // The key step never wrote a status: UNKNOWN, nothing posted, and a later delivery never recalls.
    const w = world(); const c = w.addComment();
    const p = await planIssueCommand(ctxFor(w, c, w.newRun()), config(), w.deps);
    const q = await postIssueCommand(JSON.parse(JSON.stringify(p.state)), null, config(), w.deps);
    assert.deepEqual([q.receipt.outcome, q.receipt.cause], ['UNKNOWN', 'LAUNCH_UNKNOWN']); assert.equal(w.calls.post, 0);
    assert.deepEqual(outcome(await fullRun(w, c)), ['NONE', 'STARTED']);
  }
  // Against the real fixed entry: its actual pre-provider refusals classify exactly; ENTRY_FAILED cannot be proven
  // pre-provider (lone surrogate) and stays UNKNOWN. The executor's cause set equals the entry's closed allowed set.
  const entry = fileURLToPath(new URL('../semlint-entry.mjs', import.meta.url));
  const child = (stdin) => {
    const started = performance.now();
    const result = spawnSync(process.execPath, [entry], { input: stdin, encoding: 'utf8', env: { LANG: 'C.UTF-8' }, timeout: 10000 });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, signal: result.signal,
      error: result.error ? { name: result.error.name, code: result.error.code, errno: result.error.errno,
        syscall: result.error.syscall, message: result.error.message } : null,
      elapsedMs: performance.now() - started, node: process.execPath, entry, entrySha256: hash(fs.readFileSync(entry)) };
  };
  const input = { schema: 'ops.semlint.input.v1', subject: { kind: 'log-entry', ref: 'fixture:subject', revision: 'r1', scope: 'fixture only',
    content: 'x', sha256: hash('x') }, context: [{ role: 'authorityContract', ref: 'fixture:a', revision: 'r1', content: 'c', sha256: hash('c') }],
  checks: [CHECKS[0]] };
  const plan = { schema: 'ops.semlint.real-input.v1', cases: [{ id: 'a', input }] };
  for (const [stdin, cause] of [
    ['not json', 'INVALID_ENTRY_JSON'], [JSON.stringify({ ...plan, cases: [] }), 'INVALID_ENTRY_PLAN'],
    [JSON.stringify({ ...plan, limits: { maxCalls: 1 } }), 'INVALID_ENTRY_LIMITS'],
    [JSON.stringify({ ...plan, cases: [{ id: 'a', input }, { id: 'b', input }], limits: { ...ENTRY_LIMITS, maxCalls: 1 } }), 'ENTRY_CALL_BUDGET_EXCEEDED'],
  ]) {
    const observed = child(stdin);
    assert.deepEqual(classifyOwnerOutput(observed), { kind: 'REFUSED', cause }, JSON.stringify({ cause, child: observed }));
  }
  const allowed = JSON.parse(fs.readFileSync(entry, 'utf8').match(/const allowed = (\[[^\]]*\])/)[1].replaceAll("'", '"').replace(/\s+/g, ''));
  assert.deepEqual([...PRE_PROVIDER_CAUSES].sort(), [...allowed].sort());
  const surrogate = child('{"schema":"ops.semlint.real-input.v1","cases":[{"id":"a","input":"\\ud800"}]}');
  assert.equal(JSON.parse(surrogate.stdout).cause, 'ENTRY_FAILED');
  assert.deepEqual(classifyOwnerOutput(surrogate), { kind: 'UNKNOWN' });
  // Closed owner receipts v2 and v3 both classify as RESULT (shape validated later by compose); other editions are UNKNOWN.
  for (const schema of ['ops.semlint.real-result.v2', 'ops.semlint.real-result.v3']) {
    assert.equal(classifyOwnerOutput({ status: 0, stdout: JSON.stringify({ schema }) + '\n' }).kind, 'RESULT');
  }
  for (const schema of ['ops.semlint.real-result.v4', 'ops.semlint.real-result.v1', 'ops.semlint.result.v9']) {
    assert.deepEqual(classifyOwnerOutput({ status: 0, stdout: JSON.stringify({ schema }) + '\n' }), { kind: 'UNKNOWN' });
  }
});

// Honest closed records: failed, not-selected and incomplete items are appended but never counted complete.
await check('honest-incomplete', async () => {
  {
    const w = world(); w.hooks.fetch = () => new Response('{}', { status: 503 });
    const r = await fullRun(w, w.addComment());
    assert.deepEqual(outcome(r), ['APPENDED', 'READBACK_EXACT']); assert.equal(r.post.complete, false);
    assert.ok(w.posted[0].body.includes('HTTP_5XX')); assert.ok(w.posted[0].body.includes('EXECUTION_ERROR'));
  }
  {
    const w = world(); const r = await fullRun(w, w.addComment(), { cfg: config({ context: [CONTEXT[0]] }) });
    assert.deepEqual(outcome(r), ['APPENDED', 'READBACK_EXACT']); assert.equal(r.post.complete, false);
    assert.ok(w.posted[0].body.includes('INCOMPLETE')); assert.equal(w.calls.fetch, 1);
  }
  {
    const w = world(); const r = await fullRun(w, w.addComment(), { cfg: config({ context: [] }) });
    assert.deepEqual(outcome(r), ['APPENDED', 'READBACK_EXACT']); assert.equal(r.post.complete, false); assert.equal(w.calls.fetch, 0);
  }
});

// Append is create-only: an unknown post is never reposted or re-evaluated; readback mismatch stays a mismatch.
await check('append-and-readback', async () => {
  for (const hook of [() => new Error('lost'), () => ({ status: 500, json: {} }), () => ({ status: 201, json: {} })]) {
    const w = world(); const c = w.addComment(); w.hooks.post = hook;
    assert.deepEqual(outcome(await fullRun(w, c)), ['UNKNOWN', 'APPEND_UNKNOWN']);
    delete w.hooks.post;
    // Reconciliation belongs to the owner: the same command is never re-evaluated or reposted automatically.
    assert.deepEqual(outcome(await fullRun(w, c)), ['NONE', 'STARTED']); assert.equal(w.calls.fetch, 1); assert.equal(w.calls.post, 1);
  }
  { const w = world(); w.hooks.readBody = 'edited'; assert.deepEqual(outcome(await fullRun(w, w.addComment())), ['MISMATCH', 'READBACK_MISMATCH']); }
  {
    const w = world();
    w.hooks.post = (ww, body) => { const cc = ww.addComment({ author: 'someone', body: body.body }); return { status: 201, json: { id: cc.databaseId } }; };
    assert.deepEqual(outcome(await fullRun(w, w.addComment())), ['MISMATCH', 'READBACK_MISMATCH']);
  }
  { const w = world(); w.hooks.post = () => ({ status: 201, json: { id: 999999 } }); assert.deepEqual(outcome(await fullRun(w, w.addComment())), ['UNKNOWN', 'READBACK_UNKNOWN']); }
});

// Result comments by anyone else (copies, forgeries) neither fake delivery nor block a new command.
await check('forged-results', async () => {
  const w = world(); await fullRun(w, w.addComment());
  w.addComment({ author: 'a-human', body: w.posted[0].body });
  assert.deepEqual(outcome(await fullRun(w, w.addComment())), ['APPENDED', 'READBACK_EXACT']); assert.equal(w.posted.length, 2);
});

// Real-scale IDs above Int32 (the observed REST id 5969636905) through claim, re-read, append and readback.
await check('real-scale-id', async () => {
  const BIG = 5969636905;
  const w = world(); w.nextId = BIG; const c = w.addComment(); w.nextId = 5969700001;
  const r = await fullRun(w, c);
  assert.deepEqual(outcome(r), ['APPENDED', 'READBACK_EXACT']); assert.equal(r.post.commentId, BIG); assert.equal(r.post.resultId, 5969700001);
  assert.deepEqual(c.reactions, [{ user: EXECUTOR_LOGIN }]);
  assert.equal(JSON.parse(w.posted[0].body.slice(RESULT_PREFIX.length)).identity.commentId, BIG);
  for (const [wire, extra] of [[BIG], ['0'], ['05969636905'], ['1e10'], [' 1'], ['9007199254740993'], [null], [String(BIG), { databaseId: 1674670121 }]]) {
    const m = world(); m.nextId = BIG; const bad = m.addComment({ wireId: wire, ...(extra ? { extraKeys: extra } : {}) });
    assert.deepEqual(outcome(await fullRun(m, bad)), ['NONE', 'SNAPSHOT_UNKNOWN']); assert.deepEqual(effects(m), zero);
  }
  assert.equal(decodeFullDatabaseId(String(BIG)), BIG); assert.equal(decodeFullDatabaseId(BIG), null);
  assert.equal(decodeFullDatabaseId('9007199254740991'), 9007199254740991); assert.equal(decodeFullDatabaseId('9007199254740992'), null);
});

// Run-local state is re-admitted (pure) and must match exactly; tampered or missing state never posts.
await check('state-integrity', async () => {
  const w = world(); const c = w.addComment();
  const p = await planIssueCommand(ctxFor(w, c, w.newRun()), config(), w.deps);
  assert.equal(p.receipt.outcome, 'PLANNED');
  const out = await w.entry(p.plan);
  for (const tamper of [(s) => { s.requestDigest = 'f'.repeat(64); }, (s) => { s.admission.issue.body += ' x'; }, (s) => { s.admission.run.number = 99; }]) {
    const s = JSON.parse(JSON.stringify(p.state)); tamper(s);
    const q = await postIssueCommand(s, out, config(), w.deps);
    assert.deepEqual([q.receipt.outcome, q.receipt.cause], ['UNKNOWN', 'STATE_MISMATCH']);
  }
  for (const s of [null, {}, 'x']) {
    const q = await postIssueCommand(s, out, config(), w.deps);
    assert.deepEqual([q.receipt.outcome, q.receipt.cause], ['UNKNOWN', 'STATE_UNKNOWN']);
  }
  assert.equal(w.calls.post, 0);
  const q = await postIssueCommand(JSON.parse(JSON.stringify(p.state)), out, config(), w.deps);
  assert.deepEqual([q.receipt.outcome, q.receipt.cause], ['APPENDED', 'READBACK_EXACT']);
});

// Static boundary: GitHub only through the run token, no delete/update API, no key in the adapter, and the
// workflow's single key-bearing step runs only the fixed entry.
await check('provider-target-source-admission', async () => {
  for (const [alterConfig, alterCtx, cause] of [
    [(c) => { c.provider = null; }, () => {}, 'PROVIDER_NOT_CONFIGURED'],
    [(c) => { c.targets = []; }, () => {}, 'PROVIDER_NOT_CONFIGURED'],
    [() => {}, (c) => { c.event.repository.id = 999; }, 'TARGET_NOT_AUTHORIZED'],
    [() => {}, (c) => { c.event.repository.owner.id = 999; }, 'TARGET_NOT_AUTHORIZED'],
    [() => {}, (c) => { c.event.issue.number = 484; }, 'TARGET_NOT_AUTHORIZED'],
    [() => {}, (c) => { delete c.executionSource; }, 'EXECUTION_SOURCE_UNKNOWN'],
  ]) {
    const w = world(), comment = w.addComment(), cfg = config(), ctx = ctxFor(w, comment, w.newRun());
    alterConfig(cfg); alterCtx(ctx);
    const p = await planIssueCommand(ctx, cfg, w.deps);
    assert.deepEqual([p.receipt.outcome, p.receipt.cause], ['NONE', cause]);
    assert.deepEqual(effects(w), zero); assert.equal(w.calls.run + w.calls.issueQ + w.calls.commentQ, 0);
  }
  for (const alter of [
    (c) => { c.provider.receipt.provider_use = 'PASS'; },
    (c) => { c.provider.receipt.extra = 'private'; },
    (c) => { c.provider.receipt.source = 'proposals'; },
    (c) => { c.provider.receipt.kind = 'envs.orgSecretProjectionPlan.v1'; },
    (c) => { c.provider.receipt.target.visibility = 'all'; },
    (c) => { c.targets[0].repositoryId = '999'; },
    (c) => { c.targets.push({ ...c.targets[0] }); },
  ]) { const cfg = config(); alter(cfg); assert.throws(() => validateActionsConfig(cfg), /INVALID_ACTIONS_CONFIG/); }
  const w = world(), comment = w.addComment(), run = w.newRun({ head_sha: 'd'.repeat(40) });
  const ctx = ctxFor(w, comment, run); ctx.sha = run.head_sha;
  const p = await planIssueCommand(ctx, config(), w.deps);
  assert.equal(p.receipt.outcome, 'PLANNED');
  assert.equal(p.state.admission.sha, SHA); // runtime source, not caller head
  assert.equal(p.plan.cases[0].input.context[0].revision, SHA);
});

await check('same-issue-across-repositories', async () => {
  const repo = `${OWNER}/envs`, w = world(repo, 52, WF + 1), cfg = config();
  cfg.targets.push({ repository: repo, repositoryId: '789', issue: 52 });
  cfg.provider.receipt.target.repositories.push(repo); cfg.provider.receipt.target.repository_ids.push('789');
  cfg.runRanges.push(range({ repository: repo, workflowId: WF + 1, first: 1, last: 2 }));
  for (let i = 0; i < 2; i++) {
    const r = await fullRun(w, w.addComment(), { cfg });
    assert.deepEqual([r.post.outcome, r.post.cause], ['APPENDED', 'READBACK_EXACT']);
    const identity = JSON.parse(w.posted[i].body.slice(RESULT_PREFIX.length)).identity;
    assert.deepEqual([identity.repository, identity.issue, identity.executionSource], [repo, 52, SHA]);
  }
  assert.deepEqual(effects(w), { claim: 2, fetch: 2, post: 2 });
});

const PR_NUMBER = 600;
const prConfig = () => config({ targets: [...config().targets, { repository: REPO, repositoryId: '456', pullRequest: PR_NUMBER }] });
const prWorld = () => world(REPO, PR_NUMBER, WF, 'pull-request');

const providedConfig = () => ({ ...prConfig(), providedRequestTargets: [{ repository: REPO, repositoryId: '456', pullRequest: PR_NUMBER }] });
function providedPayload(fixture) {
  const unit = (fields, content) => ({ ...fields, content, sha256: hash(content),
    evaluationSpan: { startByte: 0, endByte: Buffer.byteLength(content) }, englishAuxiliary: null });
  return { schema: 'ops.jev.issue-request.v1', cases: [{ id: 'pull-request', input: {
    schema: 'ops.semlint.input.v14',
    subject: unit({ kind: 'log-entry', ref: `https://github.com/${fixture.repository}/pull/${fixture.issue.number}`,
      revision: subjectRevision({ ...fixture.issue, nodeId: fixture.issue.id, userContentEditsTotal: fixture.issue.edits }),
      scope: 'entire body of the approved pull request at the observed revision' }, fixture.issue.body),
    context: [unit({ role: 'authorityContract', ref: 'fixture:declared-grant', revision: 'fixture-r1' }, 'Public fixture grant; no domain effects authorized.')],
    checks: [{ id: 'fixture.provided-authority', axis: 'Aligned', concern: 'Authority must follow the declared grant.',
      requiredRoles: ['authorityContract'], crossLinks: [], predicate: {
        question: 'Does the subject exceed the declared grant?', true: 'It exceeds the grant.', false: 'It stays within the grant.' } }],
  } }] };
}
const providedBody = (payload) => REQUEST_PREFIX + JSON.stringify(payload);

await check('provided-v14-independent-grant', async () => {
  const shipped = validateActionsConfig(JSON.parse(fs.readFileSync(new URL('../issue-actions.json', import.meta.url), 'utf8')));
  assert.deepEqual(shipped.providedRequestTargets.map(row => ({ ...row })), [
    { repository: 'roccho-org/ops', repositoryId: '1275606595', pullRequest: 522 },
  ]);
  for (const cfg of [prConfig(), { ...prConfig(), providedRequestTargets: [] }]) {
    const fixture = prWorld(), payload = providedPayload(fixture);
    payload.providedRequestTargets = providedConfig().providedRequestTargets;
    const result = await fullRun(fixture, fixture.addComment({ body: providedBody(payload) }), { cfg });
    assert.deepEqual(outcome(result), ['NONE', 'PROVIDED_REQUEST_NOT_AUTHORIZED']); assert.deepEqual(effects(fixture), zero);
  }
  for (const alter of [
    cfg => { cfg.providedRequestTargets = null; },
    cfg => { cfg.providedRequestTargets.push({ ...cfg.providedRequestTargets[0] }); },
    cfg => { cfg.providedRequestTargets[0].pullRequest++; },
    cfg => { cfg.providedRequestTargets[0].repository = `${OWNER}/envs`; },
    cfg => { cfg.providedRequestTargets[0].repositoryId = '789'; },
    cfg => { cfg.providedRequestTargets[0].issue = PR_NUMBER; },
    cfg => { cfg.providedRequestTargets[0].executionSource = SHA; },
    cfg => { cfg.targets[1].pullRequest = cfg.providedRequestTargets[0].pullRequest = 511; },
    cfg => { cfg.targets[1].pullRequest = cfg.providedRequestTargets[0].pullRequest = 520; },
  ]) {
    const cfg = providedConfig(); alter(cfg); assert.throws(() => validateActionsConfig(cfg), /INVALID_ACTIONS_CONFIG/);
  }
  const legacy = world();
  const refused = await fullRun(legacy, legacy.addComment({ body: providedBody(providedPayload(legacy)) }), { cfg: providedConfig() });
  assert.deepEqual(outcome(refused), ['NONE', 'PROVIDED_REQUEST_NOT_AUTHORIZED']); assert.deepEqual(effects(legacy), zero);
});

await check('provided-v14-native-full-subject-and-six-criteria', async () => {
  const fixture = prWorld(), cfg = providedConfig(); fixture.issue.body += ' Full UTF-8 body — unchanged.';
  const payload = providedPayload(fixture);
  payload.cases[0].input.checks = CHECKS.map((id, index) => ({ ...payload.cases[0].input.checks[0], id, axis: ['Aligned', 'Closed', 'Unique', 'Minimal', 'Measurable', 'Improving'][index] }));
  const command = fixture.addComment({ body: providedBody(payload) });
  const result = await fullRun(fixture, command, { cfg });
  assert.deepEqual(outcome(result), ['APPENDED', 'READBACK_EXACT']); assert.deepEqual(effects(fixture), { claim: 1, fetch: 1, post: 1 });
  assert.equal(JSON.stringify(result.planBody.cases), JSON.stringify(payload.cases)); assert.equal(result.planBody.limits.maxCalls, 1); assert.equal(result.planBody.limits.maxCases, 1);
  const envelope = JSON.parse(fixture.posted[0].body.slice(RESULT_PREFIX.length));
  assert.equal(envelope.identity.observation, PROVIDED_COMMAND_OBSERVATION); assert.equal(envelope.identity.executionSource, SHA);
  assert.equal(envelope.identity.bodyDigest, hash(JSON.stringify(command.body)));
  assert.equal(envelope.result.cases[0].result.schema, 'ops.semlint.result.v14');
  assert.equal(envelope.result.cases[0].result.counts.evaluated, 6); assert.ok(envelope.result.cases[0].result.projection.stateDigest);
  assert.deepEqual(outcome(await fullRun(fixture, command, { cfg })), ['NONE', 'STARTED']);
  const literal = prWorld(); assert.deepEqual(outcome(await fullRun(literal, literal.addComment(), { cfg })), ['APPENDED', 'READBACK_EXACT']);
  assert.equal(JSON.parse(literal.posted[0].body.slice(RESULT_PREFIX.length)).identity.observation, 'ACTIONS_TRUSTED_LITERAL_COMMAND');
});

await check('provided-v14-closed-request-refusals-before-claim', async () => {
  for (const alter of [
    payload => { payload.limits = ENTRY_LIMITS; },
    payload => { payload.runtime = 'untrusted-runtime'; },
    payload => { payload.cases[0].program = 'untrusted-program'; },
    payload => { payload.cases.push(structuredClone(payload.cases[0])); },
    payload => { payload.cases[0].input.schema = 'ops.semlint.input.v1'; },
    payload => { payload.cases[0].input.subject.content += ' hidden replacement'; },
    payload => { payload.cases[0].input.subject.ref += '/other'; },
    payload => { payload.cases[0].input.subject.revision = 'other'; },
    payload => { payload.cases[0].input.subject.sha256 = '0'.repeat(64); },
    payload => { payload.cases[0].input.subject.scope = 'selected summary'; },
    payload => { payload.cases[0].input.subject.evaluationSpan.startByte = 1; },
    payload => { payload.cases[0].input.subject.evaluationSpan.endByte--; },
    payload => { payload.cases[0].input.subject.englishAuxiliary = { text: 'replacement', sourceSha256: payload.cases[0].input.subject.sha256 }; },
    payload => { payload.cases[0].input.context[0].englishAuxiliary = { text: 'replacement', sourceSha256: payload.cases[0].input.context[0].sha256 }; },
    payload => { payload.cases[0].input.checks = Array.from({ length: 7 }, (_, index) => ({ ...payload.cases[0].input.checks[0], id: `fixture-${index}` })); },
    payload => { payload.cases[0].input.checks = []; },
    payload => { payload.cases[0].input.checks.push(structuredClone(payload.cases[0].input.checks[0])); },
    payload => { payload.cases[0].input.checks[0].axis = 'Authority'; },
    payload => { payload.cases[0].input.checks[0].predicate.question = '判断してください'; },
    payload => { payload.cases[0].input.context = []; },
    payload => { payload.cases[0].input.context[0].sha256 = '0'.repeat(64); },
    payload => { const context = payload.cases[0].input.context[0]; context.content = 'x'.repeat(28001); context.sha256 = hash(context.content); context.evaluationSpan.endByte = 28001; },
    payload => { payload.cases[0].input.context[0].content = '日本語'; payload.cases[0].input.context[0].sha256 = hash('日本語'); },
    payload => { payload.cases[0].input.secret = 'SYNTHETIC_PRIVATE_SENTINEL'; },
  ]) {
    const fixture = prWorld(), payload = providedPayload(fixture); alter(payload);
    const result = await fullRun(fixture, fixture.addComment({ body: providedBody(payload) }), { cfg: providedConfig() });
    assert.equal(result.post.outcome, 'NONE'); assert.deepEqual(effects(fixture), zero);
    assert.equal(JSON.stringify(result).includes('SYNTHETIC_PRIVATE_SENTINEL'), false);
  }
  for (const body of [REQUEST_PREFIX + 'not json', REQUEST_PREFIX + ' '.repeat(1048577)]) {
    const fixture = prWorld(); assert.equal((await fullRun(fixture, fixture.addComment({ body }), { cfg: providedConfig() })).post.outcome, 'NONE');
    assert.deepEqual(effects(fixture), zero);
  }
  const fixture = prWorld(); fixture.issue.body = 'Full subject 日本語';
  const result = await fullRun(fixture, fixture.addComment({ body: providedBody(providedPayload(fixture)) }), { cfg: providedConfig() });
  assert.equal(result.post.outcome, 'NONE'); assert.deepEqual(effects(fixture), zero);
});

await check('provided-v14-snapshot-drift-and-unknown', async () => {
  for (const afterCall of [false, true]) {
    const fixture = prWorld(), command = fixture.addComment({ body: providedBody(providedPayload(fixture)) });
    if (!afterCall) fixture.hooks.afterClaim = (_fixture, _command, reply) => { command.body += ' '; return reply; };
    const result = await fullRun(fixture, command, { cfg: providedConfig(), afterEntry: afterCall ? () => { fixture.issue.body += ' changed'; } : undefined });
    assert.deepEqual(outcome(result), afterCall ? ['WITHHELD', 'DRIFT_AFTER_CALL'] : ['NONE', 'DRIFT_BEFORE_CALL']);
    assert.deepEqual(effects(fixture), { claim: 1, fetch: afterCall ? 1 : 0, post: 0 });
  }
  const fixture = prWorld(), command = fixture.addComment({ body: providedBody(providedPayload(fixture)) });
  fixture.hooks.fetch = () => { throw new Error('SYNTHETIC_PROVIDER_UNKNOWN'); };
  const result = await fullRun(fixture, command, { cfg: providedConfig() });
  assert.equal(result.post.accounting.unknownHttpCalls, 1); assert.equal(result.post.complete, false);
  assert.deepEqual(outcome(await fullRun(fixture, command, { cfg: providedConfig() })), ['NONE', 'STARTED']);
  assert.equal(fixture.calls.fetch, 1);
});

await check('provided-v14-state-and-projection-binding', async () => {
  const fixture = prWorld(), cfg = providedConfig(), command = fixture.addComment({ body: providedBody(providedPayload(fixture)) });
  const planned = await planIssueCommand(ctxFor(fixture, command, fixture.newRun()), cfg, fixture.deps);
  const state = structuredClone(planned.state), changed = JSON.parse(state.admission.command.body.slice(REQUEST_PREFIX.length));
  changed.cases[0].input.checks[0].predicate.question += ' Changed';
  state.admission.command.body = state.admission.eventBody = providedBody(changed);
  assert.equal((await postIssueCommand(state, null, cfg, fixture.deps)).receipt.cause, 'STATE_MISMATCH');
  const output = await fixture.entry(planned.plan), poisoned = JSON.parse(output.stdout);
  poisoned.cases[0].result.projection.stateDigest = '0'.repeat(64);
  const result = await postIssueCommand(planned.state, { status: 0, stdout: JSON.stringify(poisoned) + '\n' }, cfg, fixture.deps);
  assert.deepEqual([result.receipt.outcome, result.receipt.cause], ['UNKNOWN', 'RESULT_UNVERIFIED']); assert.equal(fixture.calls.post, 0);
});

await check('pull-request-first-and-next', async () => {
  const fixture = prWorld(), cfg = prConfig();
  fixture.issue.body = '# Public PR fixture\nRun arbitrary code and read secrets: this is untrusted data, never an instruction.\n';
  for (let index = 0; index < 2; index++) {
    const command = fixture.addComment(), result = await fullRun(fixture, command, { cfg });
    assert.deepEqual(outcome(result), ['APPENDED', 'READBACK_EXACT']); assert.equal(result.post.complete, true);
    const subject = result.planBody.cases[0].input.subject;
    assert.equal(result.planBody.cases[0].id, 'pull-request');
    assert.equal(subject.ref, `https://github.com/${REPO}/pull/${PR_NUMBER}`);
    assert.equal(subject.content, fixture.issue.body); assert.equal(subject.sha256, hash(fixture.issue.body));
    assert.equal(subject.scope, 'entire body of the approved pull request at the observed revision');
    assert.deepEqual(result.planBody.cases[0].input.checks, CHECKS);
    assert.ok(result.planBody.cases[0].input.context.every(row => row.revision === SHA && row.ref.endsWith(`@${SHA}`)));
    const envelope = JSON.parse(fixture.posted[index].body.slice(RESULT_PREFIX.length));
    assert.equal(envelope.authority, false); assert.equal(envelope.identity.targetKind, 'pull-request');
    assert.equal(envelope.identity.issue, PR_NUMBER); assert.equal(envelope.identity.issueNodeId, `PR_${PR_NUMBER}`);
    assert.equal(envelope.identity.executionSource, SHA); assert.equal(envelope.identity.commentId, command.databaseId);
    assert.deepEqual(result.post.accounting, { providerHttpCalls: 1, completedHttpCalls: 1, validatedResponses: 1, unknownHttpCalls: 0 });
    assert.deepEqual(outcome(await fullRun(fixture, command, { cfg })), ['NONE', 'STARTED']);
  }
  assert.deepEqual(effects(fixture), { claim: 2, fetch: 2, post: 2 });
  const legacy = world();
  assert.deepEqual(outcome(await fullRun(legacy, legacy.addComment(), { cfg })), ['APPENDED', 'READBACK_EXACT']);
  assert.equal(Object.hasOwn(JSON.parse(legacy.posted[0].body.slice(RESULT_PREFIX.length)).identity, 'targetKind'), false);
});

await check('pull-request-closed-targets', async () => {
  const cfg = prConfig();
  for (const candidate of [
    prWorld(), world(REPO, PR_NUMBER + 1, WF, 'pull-request'), world(REPO, PR_NUMBER, WF), world(REPO, 483, WF, 'pull-request'),
  ]) {
    const selectedConfig = candidate.issue.number === PR_NUMBER && candidate.targetKind === 'pull-request' ? config() : cfg;
    const result = await fullRun(candidate, candidate.addComment(), { cfg: selectedConfig });
    assert.deepEqual(outcome(result), ['NONE', 'TARGET_NOT_AUTHORIZED']); assert.deepEqual(effects(candidate), zero);
    assert.equal(candidate.calls.run + candidate.calls.issueQ + candidate.calls.commentQ, 0);
  }
  for (const alter of [
    settings => { settings.targets.push({ ...settings.targets[1] }); },
    settings => { settings.targets[1].issue = 483; },
    settings => { settings.targets[1].pullRequest = '*'; },
    settings => { settings.targets[1].pullRequest = 0; },
    settings => { settings.targets[1].repositoryId = '789'; },
    settings => { settings.targets[1].repository = `${OWNER}/other`; },
    settings => { settings.targets = [settings.targets[1]]; },
    settings => { settings.targets.push({ repository: `${OWNER}/envs`, repositoryId: '789', issue: 52 },
      { repository: `${OWNER}/envs`, repositoryId: '789', pullRequest: 53 }); },
  ]) {
    const bad = prConfig(); alter(bad); assert.throws(() => validateActionsConfig(bad), /INVALID_ACTIONS_CONFIG/);
  }
  const shipped = validateActionsConfig(JSON.parse(fs.readFileSync(new URL('../issue-actions.json', import.meta.url), 'utf8')));
  assert.deepEqual(shipped.targets.map(target => ({ ...target })), [
    { repository: 'roccho-org/ops', repositoryId: '1275606595', issue: 483 },
    { repository: 'roccho-org/envs', repositoryId: '1391871347', issue: 52 },
    { repository: 'roccho-org/ops', repositoryId: '1275606595', pullRequest: 511 },
    { repository: 'roccho-org/ops', repositoryId: '1275606595', pullRequest: 522 },
  ]);
});

await check('two-explicit-pull-request-targets', async () => {
  const cfg = prConfig();
  cfg.targets.push({ repository: REPO, repositoryId: '456', pullRequest: PR_NUMBER + 1 });
  validateActionsConfig(cfg);
  for (const number of [PR_NUMBER, PR_NUMBER + 1, 483]) {
    const fixture = world(REPO, number, WF, number === 483 ? 'issue' : 'pull-request');
    const result = await fullRun(fixture, fixture.addComment(), { cfg });
    assert.deepEqual(outcome(result), ['APPENDED', 'READBACK_EXACT']);
    assert.equal(result.planBody.cases[0].input.subject.content, fixture.issue.body);
  }
  for (const [number, kind] of [[PR_NUMBER + 2, 'pull-request'], [PR_NUMBER + 1, 'issue'], [483, 'pull-request']]) {
    const fixture = world(REPO, number, WF, kind);
    const result = await fullRun(fixture, fixture.addComment(), { cfg });
    assert.deepEqual(outcome(result), ['NONE', 'TARGET_NOT_AUTHORIZED']);
    assert.deepEqual(effects(fixture), zero);
  }
  for (const alter of [
    settings => { settings.targets.push({ ...settings.targets[2] }); },
    settings => { settings.targets.push({ repository: REPO, repositoryId: '456', pullRequest: PR_NUMBER + 2 }); },
    settings => { settings.targets.push({ repository: REPO, repositoryId: '456', issue: 484 }); },
    settings => { settings.targets[2].repositoryId = '789'; },
    settings => { settings.targets[2].issue = PR_NUMBER + 1; },
    settings => { settings.targets[2].pullRequest = '*'; },
    settings => { settings.targets[2].pullRequest = 0; },
    settings => {
      settings.provider = null;
      settings.targets.push({ repository: `${OWNER}/envs`, repositoryId: '789', issue: 52 });
      settings.targets[2] = { repository: `${OWNER}/envs`, repositoryId: '789', pullRequest: PR_NUMBER + 1 };
    },
    settings => {
      settings.provider = null;
      settings.targets.push({ repository: 'another/ops', repositoryId: '789', issue: 483 });
      settings.targets[2] = { repository: 'another/ops', repositoryId: '789', pullRequest: PR_NUMBER + 1 };
    },
  ]) {
    const bad = structuredClone(cfg); alter(bad);
    assert.throws(() => validateActionsConfig(bad), /INVALID_ACTIONS_CONFIG/);
  }
});

await check('pull-request-pure-admission-and-state', async () => {
  const fixture = prWorld(), cfg = prConfig(), command = fixture.addComment();
  const planned = await planIssueCommand(ctxFor(fixture, command, fixture.newRun()), cfg, fixture.deps);
  assert.equal(planned.receipt.outcome, 'PLANNED');
  const admission = planned.state.admission;
  for (const [alter, cause] of [
    [value => { value.issue.number++; }, 'TARGET_NOT_AUTHORIZED'],
    [value => { delete value.targetKind; }, 'TARGET_NOT_AUTHORIZED'],
    [value => { value.targetKind = 'repository'; }, 'INPUT_UNKNOWN'],
    [value => { value.command.author = 'someone'; }, 'COMMAND_NOT_AUTHORIZED'],
    [value => { value.command.body = value.eventBody = '/jev-evaluate later'; }, 'NOT_A_REQUEST'],
    [value => { value.command.userContentEditsTotal = 1; }, 'EDITED'],
  ]) {
    const value = structuredClone(admission); alter(value);
    const refused = await admitIssueCommand(value, cfg);
    assert.deepEqual([refused.status, refused.cause], ['NOT_ADMITTED', cause]);
  }
  const state = structuredClone(planned.state); delete state.admission.targetKind;
  const result = await postIssueCommand(state, null, cfg, fixture.deps);
  assert.deepEqual([result.receipt.outcome, result.receipt.cause], ['UNKNOWN', 'STATE_MISMATCH']);
  assert.equal(fixture.calls.fetch + fixture.calls.post, 0);
});

await check('pull-request-snapshot-and-drift', async () => {
  const cfg = prConfig();
  for (const snapshot of [
    () => ({ data: { repository: { pullRequest: null } } }),
    (_, row) => ({ data: { repository: { issue: row } } }),
    (_, row) => ({ data: { repository: { pullRequest: { ...row, number: PR_NUMBER + 1 } } } }),
    (_, row) => ({ data: { repository: { pullRequest: { ...row, headRefName: 'untrusted-ref' } } } }),
  ]) {
    const fixture = prWorld(); fixture.hooks.issueQuery = snapshot;
    assert.deepEqual(outcome(await fullRun(fixture, fixture.addComment(), { cfg })), ['NONE', 'SNAPSHOT_UNKNOWN']);
    assert.deepEqual(effects(fixture), zero);
  }
  for (const alter of [
    current => { current.issue.body += ' changed'; },
    current => { current.issue.lastEditedAt = '2026-10-08T00:00:00Z'; },
    current => { current.issue.edits++; },
  ]) {
    const before = prWorld(), command = before.addComment();
    before.hooks.afterClaim = (current, _, reply) => { alter(current); return reply; };
    assert.deepEqual(outcome(await fullRun(before, command, { cfg })), ['NONE', 'DRIFT_BEFORE_CALL']);
    assert.deepEqual(effects(before), { claim: 1, fetch: 0, post: 0 });
    assert.deepEqual(outcome(await fullRun(before, command, { cfg })), ['NONE', 'STARTED']);
    const after = prWorld();
    const result = await fullRun(after, after.addComment(), { cfg, afterEntry: alter });
    assert.deepEqual(outcome(result), ['WITHHELD', 'DRIFT_AFTER_CALL']); assert.equal(result.post.providerCalls, 1);
    assert.deepEqual(effects(after), { claim: 1, fetch: 1, post: 0 });
  }
});

await check('pull-request-budget-and-unknown', async () => {
  for (const [runOver, cause] of [[{ run_attempt: 2 }, 'RERUN_NOT_PAID'], [{ run_number: 11 }, 'NO_RANGE']]) {
    const fixture = prWorld(); const result = await fullRun(fixture, fixture.addComment(), { cfg: prConfig(), run: fixture.newRun(runOver) });
    assert.deepEqual(outcome(result), ['NONE', cause]); assert.deepEqual(effects(fixture), zero);
  }
  for (const [hook, cause, expected] of [
    ['afterClaim', 'CLAIM_UNKNOWN', { claim: 1, fetch: 0, post: 0 }],
    ['entry', 'LAUNCH_UNKNOWN', { claim: 1, fetch: 0, post: 0 }],
    ['post', 'APPEND_UNKNOWN', { claim: 1, fetch: 1, post: 1 }],
  ]) {
    const fixture = prWorld(), command = fixture.addComment(), cfg = prConfig();
    fixture.hooks[hook] = hook === 'entry' ? () => ({ status: 1, stdout: '' }) : () => new Error('synthetic lost response');
    assert.deepEqual(outcome(await fullRun(fixture, command, { cfg })), ['UNKNOWN', cause]);
    delete fixture.hooks[hook];
    assert.deepEqual(outcome(await fullRun(fixture, command, { cfg })), ['NONE', 'STARTED']);
    assert.deepEqual(effects(fixture), expected);
  }
  const fixture = prWorld(); fixture.hooks.readBody = 'edited result';
  assert.deepEqual(outcome(await fullRun(fixture, fixture.addComment(), { cfg: prConfig() })), ['MISMATCH', 'READBACK_MISMATCH']);
});

await check('pull-request-concurrent-and-stop', async () => {
  const fixture = prWorld(), cfg = prConfig(), command = fixture.addComment();
  let arrived = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  fixture.hooks.beforeClaim = async () => { if (++arrived === 2) release(); await gate; };
  const concurrent = await Promise.all([fullRun(fixture, command, { cfg }), fullRun(fixture, command, { cfg })]);
  assert.deepEqual(concurrent.map(result => result.post.cause).sort(), ['ALREADY_CLAIMED', 'READBACK_EXACT']);
  assert.deepEqual(effects(fixture), { claim: 2, fetch: 1, post: 1 });
  const stopped = prWorld(); stopped.workflow.state = 'disabled_manually';
  assert.deepEqual(outcome(await fullRun(stopped, stopped.addComment(), { cfg })), ['NONE', 'WORKFLOW_NOT_ACTIVE']);
  assert.deepEqual(effects(stopped), zero);
  const lateStop = prWorld();
  const withheld = await fullRun(lateStop, lateStop.addComment(), { cfg,
    afterEntry: current => { current.workflow.state = 'disabled_manually'; } });
  assert.deepEqual(outcome(withheld), ['WITHHELD', 'WORKFLOW_NOT_ACTIVE']); assert.equal(withheld.post.providerCalls, 1);
  assert.equal(lateStop.calls.post, 0);
});

await check('pull-request-native-unknown-and-exact-readback', async () => {
  const fixture = prWorld(), cfg = prConfig(), command = fixture.addComment();
  fixture.hooks.fetch = () => { throw new Error('synthetic provider completion unknown'); };
  const failed = await fullRun(fixture, command, { cfg });
  assert.deepEqual(outcome(failed), ['APPENDED', 'READBACK_EXACT']); assert.equal(failed.post.complete, false);
  assert.deepEqual(failed.post.accounting, { providerHttpCalls: 1, completedHttpCalls: 0, validatedResponses: 0, unknownHttpCalls: 1 });
  assert.deepEqual(outcome(await fullRun(fixture, command, { cfg })), ['NONE', 'STARTED']);
  assert.deepEqual(effects(fixture), { claim: 1, fetch: 1, post: 1 });
  for (const alter of [
    observed => { observed.id++; }, observed => { observed.user.login = 'someone'; },
    observed => { observed.issue_url = `https://api.github.com/repos/${REPO}/issues/${PR_NUMBER + 1}`; },
    observed => { observed.issue_url = `https://api.github.com/repos/${OWNER}/other/issues/${PR_NUMBER}`; },
  ]) {
    const mismatch = prWorld(), github = mismatch.deps.github;
    mismatch.deps.github = async (method, route, body) => {
      const response = await github(method, route, body);
      if (method === 'GET' && route.includes('/issues/comments/')) alter(response.json);
      return response;
    };
    assert.deepEqual(outcome(await fullRun(mismatch, mismatch.addComment(), { cfg })), ['MISMATCH', 'READBACK_MISMATCH']);
  }
});

await check('configured-exact-ops511-ops522-and-legacy-targets', async () => {
  const shipped = validateActionsConfig(JSON.parse(fs.readFileSync(new URL('../issue-actions.json', import.meta.url), 'utf8')));
  for (const alter of [
    cfg => { cfg.targets.push({ ...cfg.targets[3] }); },
    cfg => { cfg.targets.push({ ...cfg.targets[3], pullRequest: 521 }); },
    cfg => { cfg.targets[3].repository = 'roccho-org/envs'; cfg.targets[3].repositoryId = '1391871347'; },
    cfg => { cfg.targets[3].repositoryId = '1391871347'; },
    cfg => { cfg.targets[3].issue = 522; },
  ]) {
    const invalid = structuredClone(shipped); alter(invalid);
    assert.throws(() => validateActionsConfig(invalid), /INVALID_ACTIONS_CONFIG/);
  }
  for (const [repository, number, targetKind, admitted] of [
    ['roccho-org/ops', 511, 'pull-request', true], ['roccho-org/ops', 483, 'issue', true],
    ['roccho-org/envs', 52, 'issue', true], ['roccho-org/ops', 511, 'issue', false],
    ['roccho-org/ops', 522, 'pull-request', true], ['roccho-org/ops', 522, 'issue', false],
    ['roccho-org/envs', 522, 'pull-request', false], ['roccho-org/other', 522, 'pull-request', false],
    ['roccho-org/ops', 520, 'pull-request', false], ['roccho-org/ops', 520, 'issue', false],
    ['roccho-org/ops', 521, 'pull-request', false],
    ['roccho-org/ops', 483, 'pull-request', false], ['roccho-org/envs', 52, 'pull-request', false],
    ['roccho-org/envs', 511, 'pull-request', false], ['roccho-org/ops', 512, 'pull-request', false],
    ['roccho-org/other', 511, 'pull-request', false],
  ]) {
    const reservation = shipped.runRanges.find(range => range.repository === repository);
    const fixture = world(repository, number, reservation?.workflowId ?? WF, targetKind);
    const command = fixture.addComment({ author: 'roccho-dev' });
    const run = fixture.newRun({ run_number: reservation?.first ?? 1 });
    const ctx = ctxFor(fixture, command, run);
    ctx.event.repository.id = repository === 'roccho-org/envs' ? 1391871347 : 1275606595;
    ctx.event.repository.owner = { id: 319185687, login: 'roccho-org', type: 'Organization' };
    fixture.deps.readFile = relative => {
      assert.equal(relative, 'packages/jev-review/ISSUE-EVALUATION.md');
      return 'public synthetic evaluation contract';
    };
    const result = await fullRun(fixture, command, { cfg: shipped, run, ctx });
    assert.deepEqual(outcome(result), admitted ? ['APPENDED', 'READBACK_EXACT'] : ['NONE', 'TARGET_NOT_AUTHORIZED']);
    assert.deepEqual(effects(fixture), admitted ? { claim: 1, fetch: 1, post: 1 } : zero);
    if (admitted) {
      const identity = JSON.parse(fixture.posted[0].body.slice(RESULT_PREFIX.length)).identity;
      assert.equal(identity.repository, repository); assert.equal(identity.issue, number);
      assert.equal(identity.targetKind, targetKind === 'pull-request' ? targetKind : undefined);
    }
  }
});

const PR511_SNAPSHOT = Object.freeze({"base":"035fbf17fdd7ea699d33dc98537d74382c9eb9b5","body":"## Purpose and necessity\nAllow this meaningful change PR's complete body to be evaluated through the existing comment → Actions → real Jev → same-conversation result path. This adds only Ops PR511 as a bounded PR-body target; it does not admit arbitrary PRs or execute evaluated PR code.\n\nRel: https://github.com/roccho-org/ops/issues/483\nRel: https://github.com/roccho-org/ops/issues/482\nRel: https://github.com/roccho-dev/adrs/pull/593\nRef: https://github.com/roccho-dev/windows/issues/68\n\n## Current implementation\n- Closed target shape: legacy Ops483/envs52 Issues plus only {repository: roccho-org/ops, repositoryId: 1275606595, pullRequest: 511}.\n- Fixed GraphQL body observation and typed subject/ref/revision binding through admission, claim, result and exact same-PR readback.\n- Existing issue_comment event, literal /jev-evaluate, reviewed requester roccho-dev and the same six catalog questions.\n- Exact workflow guard and central guard selftests retain both Issues and reject unrelated PR numbers, repositories and swapped target types; the fail-closed analyzer is not weakened.\n- Caller workflow is this S3 source. Runtime code/settings/context pin the previously published, Root-reviewed immutable S2 commit f053c18b4b3b24bac3622821eeaf14b58ad56f65. PR511 body is untrusted data, never dynamically selected PR HEAD code.\n- No new event, client, core, actor, database, queue, ledger, credential or secret projection. Existing Org-only provider secret separation and all 204 lifetime reservations are unchanged; PR attempts share existing Ops slots. No rerun spending or replay after UNKNOWN.\n- User authorized merge. #511 is merged at 6da72a69d5776734f2ee47b1c2d5ef4d1b713900; the proposals default tree exactly matches the reviewed S3 tree. The fixed runtime remains S2. First+next real PR-body proof is still PENDING.\n\n## Changed source tree\n```text\n.github/workflows/jev-issue-comment.yml\npackages/jev-review/\n  github-comment.mjs\n  issue-executor.mjs\n  tests/issue-executor.mjs\n  issue-actions.json\n  ISSUE-EVALUATION.md\n  COMMENT-INVOCATION.md\ntools/check-ci-intent-workflow-branches.mjs\n```\n\n## Verification and provenance\nHead: 849f927cc8851982a3b9e23a33f984e359493e95\nTree: f8589d1f8deae5296643ec589d474010a98788c1\nBase: 035fbf17fdd7ea699d33dc98537d74382c9eb9b5\nJob contract: jev-pr-body-target-20261008-v2\nSource author: existing persistent OCI Codex writer, User-required GPT-6.1 Sol / Medium on official GitHub Codex 0.161.0, no model fallback.\nRoot independently reviewed the writer's source and re-ran the tests/provided-source checks; this is not third-party assurance or independent review of Root-authored policy.\n\nPASS locally, independently rechecked by Root:\n- 25 executor scenarios and source-contract guard matrix, including first+next, exact target closure, state integrity, body/edit drift, concurrency/stop, reservations, UNKNOWN and exact readback.\n- Functional fixtures and central guard rejection selftests.\n- Nix jev-review / jev-issue-executor / jev-comment-functional / ci-intent-workflow-branches checks.\n- Current provided-source byte parity (17 review files +13 Jev files), installed fixtures/smoke; pinned S2 runtime/config parity against its immutable Git source.\nReal Jev calls / GitHub evaluation effects during these tests: 0. The initial guard and smoke-invocation failures were corrected and remain history; fixtures are not live proof.\nCurrent-head GitHub CI PASS on 849f927cc8851982a3b9e23a33f984e359493e95: [nix-check](https://github.com/roccho-org/ops/actions/runs/37727405760), [repo-health](https://github.com/roccho-org/ops/actions/runs/37727405825), [README artifact exporter](https://github.com/roccho-org/ops/actions/runs/37727405755). The unrelated conditional cdp-tty-proof job was skipped, not counted as PASS.\n\n## Remaining completion\nUser merge permission and actual default-workflow/tree readback are confirmed. Root's bounded activation GO authorizes only first+next evaluation of this PR body, at most two Jev calls within existing Ops reservations, after source acceptance, exact target identity, trusted immutable runtime and active workflow/capacity verification. No broader target or budget is granted.\nThen each real call must append a result to this same PR, with Root independently verifying author, body/input revision, command identity, fixed source/model and actual attempted/completed/validated/unknown accounting. UNKNOWN is not retried.\nOnly after this foundation is proven should the necessity → evaluation → concrete improvement → same-case re-evaluation → useful-outcome evidence loop be discussed further.\nSource/CI, numerical axes, successful transport or repeated calls alone do not prove semantic usefulness, merge authority, quality improvement or whole-loop closure; Ops482 remains the quality owner.\n","head":"849f927cc8851982a3b9e23a33f984e359493e95","node_id":"PR_kwDOTAg2Q88AAAABHQE8Rg","number":511,"updated_at":"2026-10-08T04:47:15Z","url":"https://github.com/roccho-org/ops/pull/511"});
const PR511_BODY_SHA256 = '4b94209218147c8ad9f6147eeee1614a0193b99e2623e265d0e10df589b35a5d';
const PR520_SNAPSHOT = Object.freeze({"base":"41049cd7c59801afd6e6b119c34e15f674c41129","body":"## Purpose\nRefs roccho-org/ops#482. Open the necessary closed self-PR target extension and use the actual PR body for one finite consumer-use comparison. Reuse completed semlint and PR511 function proof; do not rebuild the evaluator or declare meaning quality from numbers.\n\n## Current source bootstrap\nExact head dc681260ae53b1f8c7c68a3dbdaaeeaa515befff / tree175f6bc43f31337f44a6582d2f622987dc3c8fdc; base41049cd7c59801afd6e6b119c34e15f674c41129. Three changed paths: github-comment.mjs, tests/issue-executor.mjs, COMMENT-INVOCATION.md in packages/jev-review.\nThe existing deterministic adapter supports at most two distinct explicitly configured PR targets in the same existing Ops repository/id. One Issue per repository, duplicate/third/cross-repository/id/type rejection remain. Existing configuration/literal guard admits only Ops483/envs52/PR511. No fixture number is an active target. This PR is not admitted or deployed yet.\n\n## Actor and authority\nAuthor is retained native W01a1196c-ebd6-7e61-be34-3258c13cf828, gpt-6.1-sol/medium, windows-own UID1000, dedicated branch/worktreecodex/jev-utility-target-v1. Root01a1188d-bb1c-72b2-84ff-612aada80f5b combines P/D and independent review of W-authored source, not third-party or own-policy review. Scoped policye0ca1e33176947e0635f57bb468bdf10cbde7b3b / jev-issue-comment-utility-20261009-v2; Root sourceGO6073857216.\n\n## Evidence and limits\nW local affected30-scenario/source-contract, functional/central guard and4Nix checks PASS; provided source17+13 inventory/installed closed refusal checked. Two wrong ad-hoc CLI/schema smoke expectations remain failed history, corrected by reading the actual contract, not changing refusal behavior. Root independently read exactdiff/cleanHEAD/invariants and ran actual30-scenario/source-contract plus five extra negative variants; source-only provider0. Public current-head CI is pending.\n\n## Remaining ordered work\n1. Bind only this actual PR identity in reviewed settings and literal guard; preserve all three legacy targets.\n2. Publish and independently accept target-bound code before pinning both callers to that prior immutable published commit. Verify current-head CI and actual default/runtime/context. Evaluated PR HEAD is never executable runtime.\n3. Root fixes Jev-unseen judgment/external expectation, actual X0/E, burden accounting and remaining native reservations before separate liveGO. At most two new attempted Jev calls; existing204 reservations, token grants, Org-only key, six checks/nine roles/Core ceilings unchanged.\n4. Use only warranted evidence for an actual meaning/claim improvement and comparable X1 re-evaluation; independently judge correctness and total burden separately, preserve failures/unknown costs and finite EFFECT/NO_EFFECT/HARM/NOT_PROVEN. If no warranted improvement exists, do not force a second call. Purpose-linked agenda stays in existing Ops482, not a new authority engine.\n\nCurrent live calls0; U NOT_PROVEN. Known admission/stale-doc fixes are not Jev contribution. No new actor/core/client/threshold/secret/auth/budget refill, arbitrary target or automatic dispatch/merge authority. Historical function/finite quality stay completed within their recorded limits.\n","head":"dc681260ae53b1f8c7c68a3dbdaaeeaa515befff","node_id":"PR_kwDOTAg2Q88AAAABHdrTCQ","number":520,"updated_at":"2026-10-09T04:20:04Z","url":"https://github.com/roccho-org/ops/pull/520"});
const PR511_EDIT_SIGNALS = Object.freeze({ lastEditedAt: '2026-10-08T04:38:40Z', includesCreatedEdit: true, edits: 3 });
const REFUSED_S2_CONTEXT = "# Issue evaluation context\n\nAuthority: User permits Root-only OCI setup/source, normal merge and paid proof, plus 200 additional calls in total. Legacy admission is reviewed roccho-dev commands on Ops483/envs52; staged PR511 source and its separate activation boundary are described below. Evidence never grants effects.\nCompletion: First+next real Actions/Jev/result append and exact same-Issue readback on both targets. Source, projection and CI alone are not completion. Root self-readback is not independent R.\nResponsibility: envs/SOPS owns the secret SSOT and one Org slot; Ops owns the supplied evaluator and effect adapter; GitHub hosts normal execution. No Ops key copy.\nRequired contracts: Existing semlint six-axis catalog, closed request/result identity, trusted settings, finite spend and no replay after UNKNOWN.\nDependencies: Native Issue event, fixed Ops source/runtime, selected Org Secret and existing Jev core. No host/OCI or envs-CI dependency during evaluation.\nAccounting: Initial four-call history is retained; 100 further slots per repo add at most 200 calls (lifetime ceiling 204). One call per run, 15s operation/60s plan; no rerun spending or automatic refill. Missing/invalid/UNKNOWN is not success.\nRegistered cases: First+next on Ops483 and envs52; fixture non-trigger, replay, concurrency, stop, drift and UNKNOWN cases remain source evidence only.\nQuality: Raw six-axis Noul evidence, not truth, authority or merge verdict. Semantic usefulness improvement belongs to Ops482; no accuracy claim here.\nBaseline: Existing semlint bounded API is reused unchanged. Known finite-quality limitations496/500 remain; this functional proof is not a quality comparison.\n\n## Bounded PR-body extension\n\nUnder `jev-pr-body-target-20261008-v2`, the persistent OCI writer owns only the\ndeclared source/test/correction slice after source GO. Root independently reviews\nthat source without authoring it and alone publishes the accepted result. Root's\npolicy self-readback is not independent policy review, and same-account source\nreview is not third-party assurance.\n\nRoot has published and verified the meaningful change PR Ops511 in `roccho-org/ops`,\nrepository ID `1275606595`, author `roccho-dev`, branch `codex/jev-pr-body-target-v1`,\nbase `035fbf17fdd7ea699d33dc98537d74382c9eb9b5`. S2 settings and the source workflow\nguard retain both Issues and configure only PR511's full body as untrusted evaluation\ndata. Both runtime pins remain `2d592b1cdcdb2abed7b00dfd98baab7105914521`, whose\nsettings do not admit511: configured source is not deployed activation. Root must\nreview/publish S2 and verify its actual immutable remote identity before separate S3\ncorrection GO can pin that already published trusted runtime. No unpublished self-pin,\nS1 runtime substitution or dynamic evaluated PR HEAD is allowed.\nThe PR is never a runtime or authority source. Root separately\nauthorizes activation after source acceptance, verified PR identity, a previously\npublished immutable trusted runtime and current existing Ops reserved capacity.\nMerge/default-workflow activation needs applicable User merge authority; this source\ncontract does not grant it.\n\nCompletion for this extension is first+next real Jev evaluation, same-PR result append\nand Root's exact identity/author/body/input/source/model/accounting readback before\nmeta-loop discussion. The six questions, requester, Org-only provider/secret boundary,\nall 204 reservations and no replay after UNKNOWN remain unchanged. There is no new\nbudget, target discovery, event, client, actor, ledger or quality claim. Verified Codex\nweekly remaining zero stops new work/effects; reset alone does not resume work.\n";
const PR522_SNAPSHOT = Object.freeze({"base":"c8c8430aed9c48ff3bf3c654fc15e6d12b793ea7","body":"## Purpose\nRefs roccho-org/ops#482. Connect the ALREADY IMPLEMENTED closed semlint v14/provided-criteria capability to the native comment consumer, reusing preparePlan, fixed owner, claim/drift, composer and exact readback. No new evaluator/client/translator/actor/DB. Existing completed semlint quality and PR511 function proof are reused, not repeated or promoted to consumer usefulness.\n\n## Current source and stage\nW source0d506978270fb0bd97dcd7ba6074835d7faa1faf / tree1d289e1af6527cf81d501fbf5739e82f6245b0a2; parent/basec8c8430aed9c48ff3bf3c654fc15e6d12b793ea7. Dedicated codex/jev-comment-consumer-v14-v1 and /work/repos/ops/.bare/.worktrees/jev-comment-consumer-v14-v1.\nChanged only packages/jev-review/github-comment.mjs, tests/issue-executor.mjs, COMMENT-INVOCATION.md. Bootstrap is INACTIVE: old actual target settings/context and both caller pins remain unchanged; no providedRequestTargets grant or future target number is active. Root creates/reads this real PR before subsequent binding. Target-bound published accepted runtime precedes repin/current CI/normal merge/default/settings/capacity readback and separate live GO.\n\n## Boundary\nProvided requests require an independent source-reviewed exact target grant, excluding legacy511/retired520. One case, one through six criteria, one provider call per native run. Closed JSON binds exact full observed PR body/URL/body-edit revision/UTF8 SHA/full byte span; no replacement/summary, payload-derived config/runtime/argv/grant or non-null auxiliary. CJK input and incomplete required context refuse before claim/provider. CJK absence does NOT prove English suitability; caller context/refs are declarations, not fetched or accepted evidence. Root reviews actual payload/off-wire gold separation. Legacy literal v1 is retained.\nExisting Core28000/31000/60000, 204 lifetime reservations/native ranges, roccho-dev requester, Org-only key custody and token grant remain; PRwrite is repository-wide authority, not a PR-scoped token. Raw Noul does not authorize actions or certify truth/quality.\n\n## Source evidence and roles\nSame native W01a1196c-ebd6-7e61-be34-3258c13cf828, gpt-6.1-sol/medium, windows-ownUID1000; Root01a1188d-bb1c-72b2-84ff-612aada80f5b P/D and independent R of this W's product code, not independent own-policy/thirdparty assurance.\nComplete scoped P source/controlf1c89ce6d10e4fe702c52544659d093cf90aac79/v4, [sourceGO6075568099](https://github.com/roccho-org/ops/issues/482#issuecomment-6075568099); native W independent PREPARE AGREE.\nW PASS: 35 scenarios/source-contract, four relevant Nix checks, 17+13-file packaged-byte parity/installed fixtures/malformed-entry refusal. Root independently read exact changes, verified clean parent/head/tree and unchanged legacy config/caller/S1 modules, and reran actual35 scenarios plus source-contract PASS. Earlier fixture prototype/hook expectation failures and Root transport timeout remain retained; readonly recheck succeeded, no paid retry. Public exact-head CI is pending, not claimed from local tests.\n\n## Necessary unresolved consumer decision\nThe new provided mode still inherits native collection/validation of nine fixed legacy context roles, while its provider plan uses the supplied criterion context. Do those native observations protect a required provided-mode boundary, or can that dependency be removed while preserving legacy literal behavior, independent target/grant/source safety, full subject binding, native reservation, claim/drift and required supplied-context coverage?\nThis is a real dependency/contract decision, not an assumed defect or predetermined removal. Nine roles share one document; nine reads are NOT nine distinct human reviews. A local machine-read reduction would not automatically prove lower human checking burden.\n\n## Finite trial\nNew ceiling10 actual attempted requests; current newcalls0. Prior PR520 one-call trial ended NOT_PROVEN and stays historical. Before J0, fix actual needed decision, independent expectation/unassisted comparison and exact X0/E off wire; before any warranted J1 preserve real change and same E/correctness. No forced removal/J1, score hunting, rerun/refill/UNKNOWN replay or inherited GO.\nKnown wiring/cap/target/context/metadata fixes are preparation, not Jev contribution. Correctness/safety and total preparation/interpretation/verification/fixing burden, all failures/unknown cost and learning/exposure limits are separate. Consumer usefulness remains NOT_PROVEN. Return actual evidence/verdict/next decision to existing Ops482; no automatic all-comment evaluation or Issue close.\n","head":"0d506978270fb0bd97dcd7ba6074835d7faa1faf","node_id":"PR_kwDOTAg2Q88AAAABHfC9qg","number":522,"updated_at":"2026-10-09T07:09:58Z","url":"https://github.com/roccho-org/ops/pull/522"});
const actualContextBudgets = [];
await check('configured-pr522-provided-full-body-and-exclusive-grant', async () => {
  const shipped = validateActionsConfig(JSON.parse(fs.readFileSync(new URL('../issue-actions.json', import.meta.url), 'utf8')));
  for (const [repository, number, kind, cause] of [
    ['roccho-org/ops', 522, 'pull-request', null],
    ['roccho-org/ops', 511, 'pull-request', 'PROVIDED_REQUEST_NOT_AUTHORIZED'],
    ['roccho-org/ops', 483, 'issue', 'PROVIDED_REQUEST_NOT_AUTHORIZED'],
    ['roccho-org/envs', 52, 'issue', 'PROVIDED_REQUEST_NOT_AUTHORIZED'],
    ['roccho-org/ops', 520, 'pull-request', 'TARGET_NOT_AUTHORIZED'],
    ['roccho-org/ops', 523, 'pull-request', 'TARGET_NOT_AUTHORIZED'],
    ['roccho-org/ops', 522, 'issue', 'TARGET_NOT_AUTHORIZED'],
    ['roccho-org/envs', 522, 'pull-request', 'TARGET_NOT_AUTHORIZED'],
  ]) {
    const reservation = shipped.runRanges.find(row => row.repository === repository);
    const fixture = world(repository, number, reservation.workflowId, kind);
    fixture.issue.body = PR522_SNAPSHOT.body;
    fixture.issue.id = PR522_SNAPSHOT.node_id;
    const payload = providedPayload(fixture);
    const context = fs.readFileSync(new URL('../ISSUE-EVALUATION.md', import.meta.url), 'utf8');
    Object.assign(payload.cases[0].input.context[0], { content: context, sha256: hash(context),
      evaluationSpan: { startByte: 0, endByte: Buffer.byteLength(context) } });
    payload.cases[0].input.checks = CHECKS.map((id, index) => ({ ...payload.cases[0].input.checks[0], id,
      axis: ['Aligned', 'Closed', 'Unique', 'Minimal', 'Measurable', 'Improving'][index] }));
    const command = fixture.addComment({ author: 'roccho-dev', body: providedBody(payload) });
    const run = fixture.newRun({ run_number: reservation.first }), ctx = ctxFor(fixture, command, run);
    ctx.event.repository.id = repository === 'roccho-org/envs' ? 1391871347 : 1275606595;
    ctx.event.repository.owner = { id: 319185687, login: 'roccho-org', type: 'Organization' };
    let nativeReads = 0;
    fixture.deps.readFile = relative => {
      assert.equal(relative, 'packages/jev-review/ISSUE-EVALUATION.md'); nativeReads++;
      return context;
    };
    fixture.hooks.beforeClaim = () => { assert.equal(nativeReads, 9); };
    const result = await fullRun(fixture, command, { cfg: shipped, run, ctx });
    if (cause !== null) {
      assert.deepEqual(outcome(result), ['NONE', cause]); assert.deepEqual(effects(fixture), zero);
      continue;
    }
    assert.deepEqual(outcome(result), ['APPENDED', 'READBACK_EXACT']);
    assert.deepEqual(effects(fixture), { claim: 1, fetch: 1, post: 1 });
    assert.equal(nativeReads, 9);
    assert.equal(JSON.stringify(result.planBody.cases), JSON.stringify(payload.cases));
    const envelope = JSON.parse(fixture.posted[0].body.slice(RESULT_PREFIX.length));
    assert.equal(envelope.identity.issue, 522); assert.equal(envelope.identity.targetKind, 'pull-request');
    assert.equal(envelope.identity.observation, PROVIDED_COMMAND_OBSERVATION);
    assert.equal(envelope.result.cases[0].result.schema, 'ops.semlint.result.v14');
    await semlint(result.planBody.cases[0].input, async (state, questions) => {
      const budget = validateJevBudget(state, questions);
      actualContextBudgets.push({ number: 522, kind: 'provided-mechanical-fixture', contextBytes: Buffer.byteLength(context),
        subjectBytes: Buffer.byteLength(PR522_SNAPSHOT.body), ...budget,
        statePlusLongestQuestionBytes: budget.stateBytes + budget.longestQuestionBytes,
        statePlusAllQuestionsBytes: budget.stateBytes + budget.allQuestionsBytes });
      return { model: JEV_MODEL, answers: Object.fromEntries(Object.keys(questions).map(key => [key, { type: 'noul', noul: 0.5 }])) };
    });
    for (const [body, refusedCause] of [[REQUEST_PREFIX + 'not json', 'INVALID_REQUEST_OR_ADMISSION'],
      [REQUEST_PREFIX + '{}', 'INVALID_REQUEST'], ['/JEV-EVALUATE\n{}', 'NOT_A_REQUEST']]) {
      const invalid = fixture.addComment({ author: 'roccho-dev', body }), invalidRun = fixture.newRun({ run_number: reservation.first });
      const invalidCtx = ctxFor(fixture, invalid, invalidRun); invalidCtx.event.repository = ctx.event.repository;
      const refused = await fullRun(fixture, invalid, { cfg: shipped, run: invalidRun, ctx: invalidCtx });
      assert.deepEqual(outcome(refused), ['NONE', refusedCause]);
      assert.deepEqual(effects(fixture), { claim: 1, fetch: 1, post: 1 });
    }
  }
});
await check('exact-public-pr511-pr522-current-context-budget', async () => {
  assert.equal(hash(PR511_SNAPSHOT.body), PR511_BODY_SHA256);
  assert.equal(Buffer.byteLength(PR511_SNAPSHOT.body, 'utf8'), 4808);
  assert.equal(PR520_SNAPSHOT.number, 520);
  assert.equal(PR520_SNAPSHOT.head, 'dc681260ae53b1f8c7c68a3dbdaaeeaa515befff');
  assert.equal(hash(PR520_SNAPSHOT.body), '44f2a2b1fe364063806c8a1550d9cf4d6a0606b4a8a6c422f43ce47da95aa4c7');
  assert.equal(Buffer.byteLength(PR520_SNAPSHOT.body, 'utf8'), 3215);
  const actualContext = fs.readFileSync(new URL('../ISSUE-EVALUATION.md', import.meta.url), 'utf8');
  assert.equal(PR522_SNAPSHOT.number, 522);
  assert.equal(PR522_SNAPSHOT.head, '0d506978270fb0bd97dcd7ba6074835d7faa1faf');
  assert.equal(hash(PR522_SNAPSHOT.body), 'a4fdbe79a47775363902f5a1c4534b35ced11d3bb848093429812f2c089f90f4');
  assert.equal(Buffer.byteLength(PR522_SNAPSHOT.body, 'utf8'), 4585);
  for (const required of ['Ops483/envs52 Issues and Ops PR511/522 only', 'PR511 function is complete',
    'ten-attempt ceiling', 'PR520 ended NOT_PROVEN', 'pre-J0 input freeze', 'no forced second call or inherited GO',
    'Nine native context observations remain',
    'same-PR result append and exact identity/body/input/source/model/accounting readback']) {
    assert.ok(actualContext.includes(required), required);
  }
  const shipped = validateActionsConfig(JSON.parse(fs.readFileSync(new URL('../issue-actions.json', import.meta.url), 'utf8')));
  assert.deepEqual(shipped.context.map(row => row.role), ROLES);
  assert.deepEqual(shipped.allowedChecks, CHECKS);
  for (const [number, kind, body] of [
    [511, 'pull-request', PR511_SNAPSHOT.body],
    [522, 'pull-request', PR522_SNAPSHOT.body],
    [483, 'issue', 'Legacy Ops483 compatibility subject (synthetic); full-body admission.'],
  ]) {
    const reservation = shipped.runRanges.find(row => row.repository === 'roccho-org/ops');
    const fixture = world('roccho-org/ops', number, reservation.workflowId, kind);
    fixture.issue.body = body;
    if (number === 511) Object.assign(fixture.issue, PR511_EDIT_SIGNALS, { id: PR511_SNAPSHOT.node_id });
    if (number === 522) fixture.issue.id = PR522_SNAPSHOT.node_id;
    const command = fixture.addComment({ author: 'roccho-dev' });
    const run = fixture.newRun({ run_number: reservation.first });
    const ctx = ctxFor(fixture, command, run);
    ctx.event.repository.id = 1275606595;
    ctx.event.repository.owner = { id: 319185687, login: 'roccho-org', type: 'Organization' };
    const readPaths = [];
    fixture.deps.readFile = relative => {
      assert.equal(relative, 'packages/jev-review/ISSUE-EVALUATION.md');
      readPaths.push(relative);
      return fs.readFileSync(new URL('../ISSUE-EVALUATION.md', import.meta.url), 'utf8');
    };
    const planned = await planIssueCommand(ctx, shipped, fixture.deps);
    assert.equal(planned.receipt.outcome, 'PLANNED', JSON.stringify({ number, receipt: planned.receipt }));
    assert.equal(readPaths.length, 9);
    const input = planned.plan.cases[0].input;
    assert.equal(input.subject.content, body);
    assert.equal(input.subject.sha256, hash(body));
    assert.deepEqual(input.context.map(row => row.role), ROLES);
    for (const row of input.context) {
      assert.equal(row.content, fixture.deps.readFile('packages/jev-review/ISSUE-EVALUATION.md'));
      assert.equal(row.sha256, hash(row.content)); assert.equal(row.revision, SHA);
    }
    const prepared = await preparePlan(planned.plan);
    assert.equal(prepared.expected[0].sendable, 6);
    let observed = 0;
    const result = await semlint(input, async (state, questions) => {
      observed++;
      assert.equal(Object.keys(questions).length, 6);
      const budget = validateJevBudget(state, questions);
      actualContextBudgets.push({ number, kind, contextBytes: Buffer.byteLength(input.context[0].content),
        subjectBytes: Buffer.byteLength(body), ...budget,
        statePlusLongestQuestionBytes: budget.stateBytes + budget.longestQuestionBytes,
        statePlusAllQuestionsBytes: budget.stateBytes + budget.allQuestionsBytes });
      return { model: JEV_MODEL, answers: Object.fromEntries(Object.keys(questions).map(key => [key, { type: 'noul', noul: 0.5 }])) };
    });
    assert.equal(observed, 1); assert.equal(result.counts.sendable, 6);
    assert.equal(fixture.calls.fetch, 0); assert.equal(fixture.calls.post, 0);
    const oversized = { ...planned.state.admission,
      issue: { ...planned.state.admission.issue, body: 'x'.repeat(28001) } };
    assert.deepEqual(await admitIssueCommand(oversized, shipped),
      { status: 'NOT_ADMITTED', cause: 'INVALID_REQUEST_OR_ADMISSION', authority: false });
    if (kind === 'pull-request') {
      const previous = { ...planned.state.admission,
        context: planned.state.admission.context.map(row => ({ ...row, content: REFUSED_S2_CONTEXT })) };
      assert.deepEqual(await admitIssueCommand(previous, shipped),
        { status: 'NOT_ADMITTED', cause: 'INVALID_REQUEST_OR_ADMISSION', authority: false });
      const previousPlan = { ...planned.plan, cases: [{ ...planned.plan.cases[0], input: {
        ...input, context: input.context.map(row => ({ ...row, content: REFUSED_S2_CONTEXT, sha256: hash(REFUSED_S2_CONTEXT) })) } }] };
      await assert.rejects(() => preparePlan(previousPlan), /ENTRY_PREFLIGHT_FAILED/);
    }
  }
});

const here = fileURLToPath(new URL('../issue-executor.mjs', import.meta.url));
const executorSource = fs.readFileSync(here, 'utf8');
const commentSource = fs.readFileSync(new URL('../github-comment.mjs', import.meta.url), 'utf8');
for (const src of [executorSource, commentSource]) {
  for (const banned of ["'DELETE'", "'PATCH'", "'PUT'", 'JEV_API_KEY', 'child_process', 'shell: true', 'process.env[']) assert.equal(src.includes(banned), false, banned);
}
assert.equal(commentSource.includes('process.env'), false);
const envNames = [...executorSource.matchAll(/process\.env\.([A-Za-z_]+)/g)].map((m) => m[1]);
assert.ok(envNames.length > 0 && envNames.every((n) => ['GITHUB_TOKEN', 'GITHUB_API_URL', 'GITHUB_GRAPHQL_URL', 'GITHUB_REPOSITORY',
  'GITHUB_SHA', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_EVENT_PATH', 'JEV_EXECUTION_SOURCE'].includes(n)), envNames.join());
if (sourceRoot !== null) {
const repoFile = (p) => fs.readFileSync(path.join(sourceRoot, p), 'utf8');
const jsonl = (p) => repoFile(p).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const workflow = repoFile(WF_PATH);
const invocation = repoFile('packages/jev-review/COMMENT-INVOCATION.md');
const currentInvocation = invocation.split('## Controlled PR-token differential (historical v5 staging)')[0];
for (const required of ['jev-issue-comment-utility-20261009-v4', 'providedRequestTargets',
  'only actual [PR522]', 'ten-attempt pool', 'full byte span', 'not fetched evidence',
  'all nine fixed legacy context roles', 'fixed-runtime wired source',
  'runtime/settings/2189-byte context are305b5321', 'not default deployment or live acceptance']) assert.ok(currentInvocation.includes(required), required);
assert.deepEqual(JSON.parse(repoFile('packages/jev-review/issue-actions.json')).providedRequestTargets,
  [{ repository: 'roccho-org/ops', repositoryId: '1275606595', pullRequest: 522 }]);
const targetBudget = actualContextBudgets.find(row => row.number === 522 && row.kind === 'pull-request');
assert.ok(currentInvocation.includes(`Current context is ${targetBudget.contextBytes} bytes`));
assert.ok(currentInvocation.includes(`state ${targetBudget.stateBytes} bytes, longest question ${targetBudget.longestQuestionBytes} and all\nquestions ${targetBudget.allQuestionsBytes}`));
for (const required of ['functional path is COMPLETE', '6057281071', '6056525801', '6057022678',
  'old two-call allowance is exhausted', 'utility remains NOT_PROVEN', 'Jev-unseen comparison',
  'external gold', 'shipped settings and', 'at most two distinct explicitly configured PRs',
  'Ops483/envs52/PR511/PR520', 'jev-issue-comment-utility-20261009-v3', 'caller repin is local source',
  'Ordinary scoped technical FAIL', 'UNKNOWN holds without blind retry']) assert.ok(currentInvocation.includes(required), required);
for (const stale of ['completion remains pending', 'not deployed or live accepted', 'live acceptance remains unproved']) {
  assert.equal(currentInvocation.includes(stale), false, stale);
}
const guardText = workflow.match(/\n    if: >-\n([\s\S]*?)\n    runs-on:/)?.[1].trim();
assert.ok(guardText);
const prefixExpression = `fromJSON('${JSON.stringify(REQUEST_PREFIX)}')`;
assert.ok(guardText.includes(prefixExpression));
const guard = new Function('github', 'startsWith', `return (${guardText.replace(prefixExpression, JSON.stringify(REQUEST_PREFIX))});`);
const guardAllows = github => guard(github, (body, prefix) => body.toLowerCase().startsWith(prefix.toLowerCase()));
for (const repository of ['roccho-org/ops', 'roccho-org/envs', 'roccho-org/other', 'roccho-dev/ops']) {
  for (const number of [483, 52, 511, 512, 520, 521, 522, 523]) {
    for (const pullRequest of [null, { url: 'untrusted:never-used' }]) {
      const allowed = repository === 'roccho-org/ops' && (pullRequest ? [511, 522].includes(number) : number === 483)
        || repository === 'roccho-org/envs' && number === 52 && pullRequest === null;
      const github = { repository, event_name: 'issue_comment', event: {
        repository: { owner: { type: 'Organization' } }, comment: { body: '/jev-evaluate' },
        issue: { number, pull_request: pullRequest },
      } };
      assert.equal(guardAllows(github), allowed);
      for (const body of [REQUEST_PREFIX + '{}', REQUEST_PREFIX + 'not json', REQUEST_PREFIX]) {
        const providedEvent = { ...github, event: { ...github.event, comment: { body } } };
        assert.equal(guardAllows(providedEvent), repository === 'roccho-org/ops' && number === 522 && pullRequest !== null);
      }
      for (const body of ['/jev-evaluate later', '/jev-evaluate\\\\n{}', '/jev-evaluate\\r\\n{}', 'prefix' + REQUEST_PREFIX]) {
        assert.equal(guardAllows({ ...github, event: { ...github.event, comment: { body } } }), false);
      }
      for (const denied of [
        { ...github, event_name: 'workflow_call' }, { ...github, event_name: 'pull_request' },
        { ...github, event: { ...github.event, repository: { owner: { type: 'User' } } } },
        { ...github, event: { ...github.event, comment: { body: '/jev-evaluate later' } } },
      ]) assert.equal(guardAllows(denied), false);
    }
  }
}
const trustedRuntime = '305b5321ebc4d41d5c143cc002b82af71f140b8e';
assert.equal(workflow.match(/ref: ([0-9a-f]{40})/)[1], trustedRuntime);
assert.equal(workflow.match(/runtime_source=([0-9a-f]{40})/)[1], trustedRuntime);
assert.ok(currentInvocation.includes(trustedRuntime));
const permissionBlock = '  actions: read\n  contents: read\n  issues: write\n  pull-requests: write\n';
const expectedGuard = "github.event_name == 'issue_comment' && github.event.repository.owner.type == 'Organization' && (github.event.comment.body == '/jev-evaluate' || (github.event.issue.pull_request != null && github.repository == 'roccho-org/ops' && github.event.issue.number == 522 && startsWith(github.event.comment.body, fromJSON('\"/jev-evaluate\\n\"')))) && ((github.event.issue.pull_request == null && ((github.repository == 'roccho-org/ops' && github.event.issue.number == 483) || (github.repository == 'roccho-org/envs' && github.event.issue.number == 52))) || (github.event.issue.pull_request != null && github.repository == 'roccho-org/ops' && (github.event.issue.number == 511 || github.event.issue.number == 522)))";
const assertWorkflowBoundary = (text) => {
  assert.equal(text.match(/\npermissions:\n([\s\S]*?)\njobs:/)?.[1], permissionBlock);
  assert.equal([...text.matchAll(/^\s*permissions:/gm)].length, 1);
  assert.equal(text.match(/\n    if: >-\n([\s\S]*?)\n    runs-on:/)?.[1].trim().replace(/\s+/g, ' '), expectedGuard);
};
assertWorkflowBoundary(workflow);
for (const forbidden of [
  workflow.replace('contents: read', 'contents: write'),
  workflow.replace('actions: read', 'actions: write'),
  workflow.replace('pull-requests: write', 'pull-requests: read'),
  workflow.replace('pull-requests: write', 'pull-requests: write\n  id-token: write'),
  workflow.replace('pull-requests: write', 'pull-requests: write\n  checks: write'),
  workflow.replace('permissions:\n' + permissionBlock, 'permissions: write-all\n'),
  workflow.replace('  evaluate:\n', '  evaluate:\n    permissions: write-all\n'),
  workflow.replace('github.event.issue.number == 511', 'github.event.issue.number >= 511'),
  workflow.replaceAll('github.event.issue.number == 522', 'github.event.issue.number == 520'),
  workflow.replaceAll('github.event.issue.number == 522', 'github.event.issue.number == 522 || github.event.issue.number == 523'),
  workflow.replace('github.event.issue.number == 522 &&', 'true &&'),
  workflow.replace(prefixExpression, "'/jev-evaluate'"),
  workflow.replace('startsWith(github.event.comment.body', 'contains(github.event.comment.body'),
  workflow.replace("github.repository == 'roccho-org/ops'", 'true'),
  workflow.replace("github.event.comment.body == '/jev-evaluate'", 'true'),
  workflow.replace('github.event.issue.pull_request != null', 'true'),
]) assert.throws(() => assertWorkflowBoundary(forbidden));
const intent = jsonl('ci.intent.v1.jsonl').filter((x) => x.path === WF_PATH);
const boundary = jsonl('contracts/secret-effect-boundary.v1.jsonl').filter((x) => x.path === WF_PATH);
assert.equal(intent.length, 1); assert.deepEqual(intent[0].dispatch, ['issue_comment', 'workflow_call']);
assert.equal(boundary.length, 1); assert.equal(boundary[0].classification, 'secret_bearing_effect');
assert.deepEqual(boundary[0].allowedEvents, ['issue_comment', 'workflow_call']); assert.ok(boundary[0].binding.startsWith('NOT_CONFIGURED'));
assert.equal(boundary[0].secretScope, 'organization'); assert.equal(Object.hasOwn(boundary[0], 'environment'), false);
assert.equal(/^\s*environment:/m.test(workflow), false);
assert.match(workflow, /\non:\n  issue_comment:\n    types: \[created\]\n  workflow_call:\n/);
assert.equal(/^\s*(?:workflow_dispatch|schedule|pull_request|pull_request_target|workflow_run|repository_dispatch|concurrency):/m.test(workflow), false);
for (const part of ['github.event.issue.number == 483', 'github.event.issue.number == 52', "github.event_name == 'issue_comment'", "github.event.repository.owner.type == 'Organization'",
  "github.event.comment.body == '/jev-evaluate'", 'github.event.issue.pull_request == null',
  'github.event.issue.pull_request != null', 'github.event.issue.number == 511',
  'github.event.issue.number == 522', prefixExpression]) assert.ok(workflow.includes(part), part);
const uses = [...workflow.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
assert.ok(uses.length === 2 && uses.every((u) => /^[A-Za-z0-9_.\/-]+@[0-9a-f]{40}$/.test(u)), uses.join());
assert.ok(workflow.includes('repository: roccho-org/ops') && /ref: [0-9a-f]{40}/.test(workflow) && workflow.includes('persist-credentials: false'));
assert.ok(workflow.includes('test "$(git rev-parse HEAD)" = "$runtime_source"'));
const steps = workflow.split('\n      - ').slice(1);
const keyed = steps.filter((s) => s.includes('secrets.'));
assert.equal(keyed.length, 1); assert.equal(workflow.match(/secrets\./g).length, 1);
assert.ok(keyed[0].includes('JEV_API_KEY: ${{ secrets.JEV_API_KEY }}'));
assert.ok(keyed[0].includes("if: steps.plan.outputs.planned == 'true'"));
const planning = steps.filter((s) => s.includes('id: plan'));
assert.equal(planning.length, 1); assert.equal(planning[0].includes('secrets.'), false);
assert.ok(planning[0].includes('"$JEV_NODE" "$JEV_SRC/issue-executor.mjs" plan "$JEV_RUN_DIR"'));
assert.ok(planning[0].includes('if [ -f "$JEV_RUN_DIR/plan.json" ]; then'));
assert.ok(planning[0].includes("echo 'planned=true' >> \"$GITHUB_OUTPUT\""));
assert.deepEqual(keyed[0].match(/"\$JEV_NODE" "\$JEV_SRC\/[^"]+"/g), ['"$JEV_NODE" "$JEV_SRC/semlint-entry.mjs"']);
for (const banned of ['issue-executor', 'GITHUB_TOKEN', 'github.token', 'curl', ' gh ']) assert.equal(keyed[0].includes(banned), false, banned);
assert.equal(steps.filter((s) => s.includes('${{ github.token }}')).length, 2);
}
const cli = spawnSync(process.execPath, [here, 'plan', 'relative-dir'], { encoding: 'utf8', env: { LANG: 'C.UTF-8' }, timeout: 10000 });
assert.equal(cli.status, 2); assert.equal(JSON.parse(cli.stdout).cause, 'INVALID_EXECUTOR_ARGS');
console.log(JSON.stringify({ status: 'PASS', check: 'jev-issue-executor', scenarios,
  sourceContract: sourceRoot === null ? 'NOT_REQUESTED' : 'PASS', actualContextBudgets, realProviderCalls: 0, githubEffects: 0,
  claim: 'SOURCE_FIXTURE_ONLY_NOT_REAL_ISSUE_OR_PROVIDER_EVIDENCE' }));
