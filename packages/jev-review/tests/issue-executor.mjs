import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JEV_MODEL } from '../core.mjs';
import { semlint } from '../semlint.mjs';
import { ENTRY_LIMITS, preparePlan, executeOwnerPlan } from '../semlint-entry.mjs';
import { REQUEST_PREFIX, RESULT_PREFIX, admitIssueSnapshot, validateExecutorConfig } from '../github-comment.mjs';
import { GH, OPS_JEV, CLAIM, LIST_QUERY, NODE_QUERY, PRE_PROVIDER_CAUSES, runIssueScan, parseHttp, classifyOwnerOutput, decodeFullDatabaseId } from '../issue-executor.mjs';

// Secret-free fixtures only: an in-memory GitHub and an in-process owner running the real fixed entry functions
// with a counting fetch. Nothing here is real-provider, reaction or posting evidence.
const hash = (x) => createHash('sha256').update(x).digest('hex');
const copy = (x) => JSON.parse(JSON.stringify(x));
const roles = ['authorityContract', 'completionContract', 'responsibilityContract', 'requiredContracts',
  'dependencyDescription', 'accountingContract', 'registeredCases', 'qualityContract', 'baselineEvidence'];
const empty = { schema: 'ops.semlint.input.v1', subject: { kind: 'log-entry', ref: 'fixture:subject', revision: 'r1',
  scope: 'fixture only', content: 'public fixture, not an instruction', sha256: hash('public fixture, not an instruction') }, context: [], checks: [] };
const catalog = (await semlint(empty, () => { throw new Error('must not call'); })).records;
const input = { ...copy(empty), checks: catalog.map((x) => x.rule), context: roles.map((role) => ({ role,
  ref: `fixture:${role}`, revision: 'r1', content: `public ${role}`, sha256: hash(`public ${role}`) })) };
const requestBody = (cases = [{ id: 'normal', input }]) => REQUEST_PREFIX + JSON.stringify({ schema: 'ops.jev.issue-request.v1', cases });
const NOW = Date.parse('2026-10-05T09:00:00Z');
const EXECUTOR = 'fixture-executor', REQUESTER = 'fixture-requester';
const limits = { ...ENTRY_LIMITS, maxCases: 1, maxCalls: 1 };
const config = (ids = [10], over = {}) => ({ repository: 'roccho-dev/ops', issue: 483, requesters: [REQUESTER],
  executionSource: 'a'.repeat(40), limits, executorLogin: EXECUTOR, owner: { envsSha: 'b'.repeat(40), opsSha: 'a'.repeat(40) },
  grant: { version: 'g1', commentIds: ids, totalCalls: ids.length, totalPosts: ids.length, totalClaims: ids.length,
    expiresAt: '2026-10-06T00:00:00Z', postIncomplete: false }, ...over });

function world(comments, { page = 2 } = {}) {
  const w = { principal: EXECUTOR, comments: comments.map((c) => ({ author: REQUESTER, createdAt: '2026-10-05T08:00:00Z',
    updatedAt: '2026-10-05T08:00:00Z', lastEditedAt: null, includesCreatedEdit: false, edits: 0, reactions: [], ...c })),
  nextId: 1000, calls: { gh: 0, list: 0, node: 0, claim: 0, post: 0, owner: 0, fetch: 0 }, files: new Set(), hooks: {}, ownerArgs: [], ownerStdin: [], clock: NOW };
  const params = (args) => { const p = {}; for (let i = 0; i < args.length; i++) if (args[i] === '-f' || args[i] === '-F') { const [k, ...v] = args[++i].split('='); p[k] = v.join('='); } return p; };
  // Official wire: fullDatabaseId is BigInt, encoded as a string; legacy Int databaseId is never returned
  // because it is never requested. `wireId`/`extraKeys` model malformed or mismatched wire nodes.
  const node = (c) => ({ ...c.extraKeys, id: `IC_${c.databaseId}`, fullDatabaseId: 'wireId' in c ? c.wireId : String(c.databaseId),
    author: c.author === null ? null : { login: c.author }, body: c.body,
    createdAt: c.createdAt, updatedAt: c.updatedAt, lastEditedAt: c.lastEditedAt, includesCreatedEdit: c.includesCreatedEdit,
    userContentEdits: c.edits === null ? null : { totalCount: c.edits },
    reactions: { totalCount: c.reactions.length + (c.hiddenReactions ?? 0),
      nodes: c.reactions.filter((r) => r.content === CLAIM.rest).map((r) => ({ content: CLAIM.graphql, user: r.user === null ? null : { login: r.user } })) } });
  const http = (status, body) => ({ status: status < 300 ? 0 : 1, stdout: `HTTP/2.0 ${status} X\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(body)}` });
  const gh = async (args, stdin) => {
    w.calls.gh++;
    if (args.join(' ') === 'api user') return { status: 0, stdout: JSON.stringify({ login: w.principal }) };
    if (args[1] === 'graphql') {
      const p = params(args);
      // Independent of the exported constants: the production query text must select exactly these
      // comment fields and must not request the Int32 databaseId.
      for (const field of ['id', 'fullDatabaseId', 'author{login}', 'body', 'createdAt', 'updatedAt', 'lastEditedAt',
        'includesCreatedEdit', 'userContentEdits{totalCount}', 'reactions(content:EYES,first:100){totalCount nodes{content user{login}}}']) {
        assert.ok(new RegExp(`(^|[\\s{])${field.replace(/[{}()[\]:,]/g, '\\$&')}(?=[\\s}])`).test(p.query), field);
      }
      assert.equal(/\bdatabaseId\b/.test(p.query), false);
      if (p.query === NODE_QUERY) {
        w.calls.node++;
        if (w.hooks.reread) return w.hooks.reread(w);
        const c = w.comments.find((x) => `IC_${x.databaseId}` === p.id);
        return { status: 0, stdout: JSON.stringify({ data: { node: c ? node(c) : null } }) };
      }
      assert.equal(p.query, LIST_QUERY); assert.equal(`${p.owner}/${p.name}`, 'roccho-dev/ops'); assert.equal(p.number, '483');
      w.calls.list++;
      if (w.hooks.list) { const r = await w.hooks.list(w, p); if (r) return r; }
      const start = p.after ? Number(p.after) : 0, slice = w.comments.slice(start, start + page);
      return { status: 0, stdout: JSON.stringify({ data: { repository: { issue: { comments: { totalCount: w.totalOverride ?? w.comments.length,
        pageInfo: { hasNextPage: start + page < w.comments.length, endCursor: String(start + page) }, nodes: slice.map(node) } } } } }) };
    }
    const claimPath = /^repos\/roccho-dev\/ops\/issues\/comments\/(\d+)\/reactions$/.exec(args[4] ?? '');
    if (args[1] === '-i' && args[3] === 'POST' && claimPath) {
      assert.deepEqual(args.slice(5), ['-f', 'content=eyes']);
      w.calls.claim++;
      if (w.hooks.beforeClaim) await w.hooks.beforeClaim(w);
      const c = w.comments.find((x) => x.databaseId === Number(claimPath[1]));
      const existing = c.reactions.find((r) => r.user === w.principal && r.content === CLAIM.rest);
      const reply = existing ? http(200, { id: 1, user: { login: w.principal }, content: CLAIM.rest }) : (c.reactions.push({ user: w.principal, content: CLAIM.rest }),
        http(201, { id: 2, user: { login: w.hooks.claimUser ?? w.principal }, content: CLAIM.rest }));
      if (w.hooks.afterClaim) return w.hooks.afterClaim(w, c, reply);
      return reply;
    }
    if (args[1] === '-i' && args[3] === 'POST' && args[4] === 'repos/roccho-dev/ops/issues/483/comments') {
      assert.deepEqual(args.slice(5), ['--input', '-']);
      w.calls.post++;
      if (w.hooks.beforePost) await w.hooks.beforePost(w);
      const id = w.nextId++, body = JSON.parse(stdin).body;
      w.comments.push({ databaseId: id, author: w.principal, body, createdAt: '2026-10-05T09:00:01Z', updatedAt: '2026-10-05T09:00:01Z',
        lastEditedAt: null, includesCreatedEdit: false, edits: 0, reactions: [] });
      const reply = http(201, { id, user: { login: w.principal }, body });
      return w.hooks.afterPost ? w.hooks.afterPost(w, reply) : reply;
    }
    const read = /^repos\/roccho-dev\/ops\/issues\/comments\/(\d+)$/.exec(args[1] ?? '');
    if (args[0] === 'api' && args.length === 2 && read) {
      const c = w.comments.find((x) => x.databaseId === Number(read[1]));
      return { status: 0, stdout: JSON.stringify({ id: c.databaseId, user: { login: c.author }, body: w.hooks.readBody ?? c.body,
        issue_url: 'https://api.github.com/repos/roccho-dev/ops/issues/483' }) };
    }
    throw new Error('unexpected gh call ' + args.join(' '));
  };
  const owner = async (args, stdin) => {
    w.calls.owner++; w.ownerArgs.push(args); w.ownerStdin.push(stdin);
    if (w.hooks.owner) { const r = await w.hooks.owner(w, stdin); if (r) return r; }
    let prepared;
    try { prepared = await preparePlan(JSON.parse(stdin)); }
    catch (error) { return { status: 1, stdout: JSON.stringify({ schema: 'ops.semlint.entry-error.v1', status: 'REJECTED', cause: error.message, authority: false }) + '\n' }; }
    const result = await executeOwnerPlan(prepared, 'synthetic-fixture-key', async (url, init) => {
      w.calls.fetch++;
      if (w.hooks.fetch) return w.hooks.fetch(url, init);
      return new Response(JSON.stringify({ model: JEV_MODEL,
        answers: Object.fromEntries(Object.keys(JSON.parse(init.body).questions).map((k) => [k, { type: 'noul', noul: 0.4 }])) }), { status: 200 });
    });
    return { status: 0, stdout: JSON.stringify(result) + '\n' };
  };
  w.deps = { now: () => w.clock, run: async (file, args, stdin) => {
    w.files.add(file);
    if (file === GH) return gh(args, stdin);
    if (file === OPS_JEV) { const out = await owner(args, stdin); if (w.hooks.afterOwner) w.hooks.afterOwner(w); return out; }
    throw new Error('unexpected executable ' + file);
  } };
  return w;
}
const ownerArgs = ['--semlint-real', '--envs-sha', 'b'.repeat(40), '--ops-sha', 'a'.repeat(40)];
const effects = (w) => ({ claim: w.calls.claim, owner: w.calls.owner, fetch: w.calls.fetch, post: w.calls.post });
const zero = { claim: 0, owner: 0, fetch: 0, post: 0 };
const req = (id = 10, extra = {}) => ({ databaseId: id, body: requestBody(), ...extra });
let scenarios = 0;
const check = async (name, fn) => { await fn(); scenarios++; };

// Normal path, then idempotent rescan.
await check('normal', async () => {
  const w = world([req(10), { databaseId: 11, author: 'someone', body: 'unrelated' }, { databaseId: 12, body: requestBody() }]);
  const r = await runIssueScan(config(), w.deps);
  assert.equal(r.stopped, null);
  assert.equal(r.decisions.length, 1);
  assert.equal(r.decisions[0].effect, 'APPENDED'); assert.equal(r.decisions[0].cause, 'READBACK_EXACT'); assert.equal(r.decisions[0].claimStatus, 201);
  assert.deepEqual(r.decisions[0].accounting, { providerHttpCalls: 1, validatedResponses: 1, unknownHttpCalls: 0 });
  assert.deepEqual(effects(w), { claim: 1, owner: 1, fetch: 1, post: 1 });
  assert.deepEqual(w.ownerArgs, [ownerArgs]); assert.deepEqual([...w.files].sort(), [GH, OPS_JEV].sort());
  assert.equal(w.comments.find((c) => c.databaseId === 12).reactions.length, 0); // outside the exact grant: untouched
  const posted = w.comments.at(-1);
  assert.ok(posted.body.startsWith(RESULT_PREFIX)); assert.equal(posted.author, EXECUTOR);
  assert.equal(JSON.parse(posted.body.slice(RESULT_PREFIX.length)).identity.observation, 'API_SNAPSHOT_NO_EDIT_SIGNAL');
  assert.equal(posted.body.includes('synthetic-fixture-key'), false);
  // Owner stdin is byte-identical to the admitted plan (cases plus effective caller caps).
  const c10 = w.comments.find((c) => c.databaseId === 10);
  const admittedHere = await admitIssueSnapshot({ repository: 'roccho-dev/ops', issue: 483, comment: { id: 'IC_10', databaseId: 10, author: c10.author,
    body: c10.body, createdAt: c10.createdAt, updatedAt: c10.updatedAt, lastEditedAt: null, includesCreatedEdit: false, userContentEditsTotal: 0 } }, config(), NOW);
  assert.deepEqual(w.ownerStdin, [JSON.stringify(admittedHere.prepared.plan)]);
  assert.deepEqual(JSON.parse(w.ownerStdin[0]).limits, limits);
  const again = await runIssueScan(config(), w.deps);
  assert.equal(again.stopped, null); assert.equal(again.decisions[0].cause, 'READBACK_ONLY');
  assert.deepEqual(effects(w), { claim: 1, owner: 1, fetch: 1, post: 1 });
});

// Parallel same ID: both read before either claims; only the raw-201 winner pays and posts.
await check('parallel-same-id', async () => {
  const w = world([req(10)]);
  let arrived = 0, release; const gate = new Promise((r) => { release = r; });
  w.hooks.beforeClaim = async () => { if (++arrived === 2) release(); await gate; };
  const [a, b] = await Promise.all([runIssueScan(config(), w.deps), runIssueScan(config(), w.deps)]);
  assert.deepEqual([a, b].map((x) => x.decisions[0].cause).sort(), ['ALREADY_CLAIMED', 'READBACK_EXACT']);
  assert.deepEqual(effects(w), { claim: 2, owner: 1, fetch: 1, post: 1 });
});

// Parallel distinct IDs within one statically bounded grant: each ID at most once in total.
await check('parallel-distinct-ids', async () => {
  const w = world([req(10), req(11)]);
  const ids = [10, 11];
  const [a, b] = await Promise.all([runIssueScan(config(ids), w.deps), runIssueScan(config(ids), w.deps)]);
  assert.equal(a.stopped, null); assert.equal(b.stopped, null);
  assert.equal(w.calls.owner, 2); assert.equal(w.calls.fetch, 2); assert.equal(w.calls.post, 2);
  assert.ok(w.calls.fetch <= ids.length * limits.maxCalls);
});

// Static grant bounds and config refusals: whole run has no gh/owner call at all.
await check('config-refusals', async () => {
  const w = world([req(10), req(11)]);
  for (const [bad, cause] of [
    [config([10, 11], { grant: { ...config([10, 11]).grant, totalCalls: 1 } }), 'GRANT_BOUNDS_EXCEEDED'],
    [config([10, 11], { grant: { ...config([10, 11]).grant, totalPosts: 1 } }), 'GRANT_BOUNDS_EXCEEDED'],
    [config([10, 11], { grant: { ...config([10, 11]).grant, totalClaims: 1 } }), 'GRANT_BOUNDS_EXCEEDED'],
    [config([10], { grant: { ...config().grant, expiresAt: '2026-10-05T08:59:59Z' } }), 'GRANT_EXPIRED'],
    [config([10, 10]), 'INVALID_EXECUTOR_CONFIG'], [config([]), 'INVALID_EXECUTOR_CONFIG'], [config([0]), 'INVALID_EXECUTOR_CONFIG'],
    [{ ...config(), extra: 1 }, 'INVALID_EXECUTOR_CONFIG'], [{ ...config(), program: '/bin/sh' }, 'INVALID_EXECUTOR_CONFIG'],
    [config([10], { owner: { envsSha: 'b'.repeat(40), opsSha: 'a'.repeat(40), argv: ['--x'] } }), 'INVALID_EXECUTOR_CONFIG'],
    [config([10], { owner: { envsSha: 'b'.repeat(40), opsSha: 'c'.repeat(40) } }), 'INVALID_EXECUTOR_CONFIG'],
    [config([10], { grant: { ...config().grant, gh: '/tmp/gh' } }), 'INVALID_EXECUTOR_CONFIG'],
    [config([10], { limits: { ...ENTRY_LIMITS, maxCalls: 25 } }), 'INVALID_EXECUTOR_CONFIG'],
  ]) {
    const r = await runIssueScan(bad, w.deps);
    assert.deepEqual(r.stopped, { stage: 'config', cause });
  }
  assert.equal(w.calls.gh, 0); assert.deepEqual(effects(w), zero);
});

// Principal mismatch / unknown: stops before snapshot or any effect.
await check('principal', async () => {
  const w = world([req(10)]); w.principal = 'someone-else';
  assert.deepEqual((await runIssueScan(config(), w.deps)).stopped, { stage: 'principal', cause: 'PRINCIPAL_MISMATCH' });
  assert.equal(w.calls.list, 0); assert.deepEqual(effects(w), zero);
  const u = world([req(10)]); const run = u.deps.run;
  u.deps.run = async (file, args, stdin) => (args.join(' ') === 'api user' ? { status: null, stdout: '' } : run(file, args, stdin));
  assert.deepEqual((await runIssueScan(config(), u.deps)).stopped, { stage: 'principal', cause: 'UNKNOWN' });
  assert.deepEqual(effects(u), zero);
  const p = world([req(10)]); const prun = p.deps.run;
  p.deps.run = async (file, args, stdin) => (args.join(' ') === 'api user' ? { status: 0, stdout: 'not json' } : prun(file, args, stdin));
  assert.deepEqual((await runIssueScan(config(), p.deps)).stopped, { stage: 'principal', cause: 'UNKNOWN' });
  assert.equal(p.calls.list, 0); assert.deepEqual(effects(p), zero);
});

// Incomplete or erroneous provider observations: no claim.
await check('snapshot-incomplete', async () => {
  for (const mutate of [
    (w) => { w.hooks.list = () => ({ status: 0, stdout: JSON.stringify({ data: null, errors: [{ message: 'x' }] }) }); },
    (w) => { w.totalOverride = 5; },
    (w) => { w.hooks.list = () => ({ status: 1, stdout: '' }); },
    (w) => { w.hooks.list = (_, p) => (p.after ? { status: 0, stdout: JSON.stringify({ data: { repository: { issue: { comments: { totalCount: 3,
      pageInfo: { hasNextPage: true, endCursor: p.after }, nodes: [] } } } } }) } : null); },
  ]) {
    const w = world([req(10), req(11, { body: 'x' }), req(12, { body: 'y' })]); mutate(w);
    assert.deepEqual((await runIssueScan(config(), w.deps)).stopped, { stage: 'snapshot', cause: 'SNAPSHOT_UNKNOWN' });
    assert.deepEqual(effects(w), zero);
  }
  // Incomplete reactions hold only that comment: on a non-grant comment they no longer stop the scan.
  const other = world([req(10), { databaseId: 11, body: 'unrelated', hiddenReactions: 1 }]);
  const ro = await runIssueScan(config(), other.deps);
  assert.equal(ro.stopped, null); assert.equal(ro.decisions[0].cause, 'READBACK_EXACT');
  const own = world([req(10, { hiddenReactions: 1 })]);
  assert.deepEqual((await runIssueScan(config(), own.deps)).decisions, [{ commentId: 10, effect: 'NONE', cause: 'CLAIMS_INCOMPLETE' }]);
  assert.deepEqual(effects(own), zero);
});

// Per-comment refusals: no claim, owner call or post.
await check('admission-refusals', async () => {
  for (const [extra, cause, opts] of [
    [{ lastEditedAt: '2026-10-05T08:10:00Z' }, 'EDITED'], [{ includesCreatedEdit: true }, 'EDITED'], [{ edits: 1 }, 'EDITED'],
    [{ edits: null }, 'SNAPSHOT_UNKNOWN'], [{ author: null }, 'SNAPSHOT_UNKNOWN'], [{ author: 'not-a-requester' }, 'REQUESTER_NOT_AUTHORIZED'],
    [{ body: 'no prefix' }, 'NOT_A_REQUEST'], [{ body: RESULT_PREFIX + '{}' }, 'NOT_A_REQUEST'],
    [{ body: requestBody([{ id: 'a', input }, { id: 'b', input }]) }, 'INVALID_REQUEST_OR_ADMISSION'],
    [{ body: REQUEST_PREFIX + JSON.stringify({ schema: 'ops.jev.issue-request.v1', cases: [{ id: 'n', input }], limits: ENTRY_LIMITS }) }, 'INVALID_REQUEST'],
    [{ body: REQUEST_PREFIX + '{bad' }, 'INVALID_REQUEST_OR_ADMISSION'],
    [{ reactions: [{ user: null, content: 'eyes' }] }, 'UNRECOGNIZED'],
    [{ reactions: [{ user: EXECUTOR, content: 'eyes' }] }, 'STARTED'],
  ]) {
    const w = world([req(10, extra)]);
    const r = await runIssueScan(config(), w.deps);
    assert.equal(r.stopped, null); assert.deepEqual(r.decisions, [{ commentId: 10, effect: 'NONE', cause }]);
    assert.deepEqual(effects(w), zero);
  }
  // A granted comment whose plan would yield a non-composable result edition (v5) is refused before claim, owner launch,
  // provider fetch or comment post.
  const unit = (row, content) => ({ ...row, content, sha256: hash(content), evaluationSpan: { startByte: 0, endByte: Buffer.byteLength(content) } });
  const v5Input = { schema: 'ops.semlint.input.v5',
    subject: unit({ kind: 'log-entry', ref: 'fixture:v5', revision: 'r1', scope: 'fixture only' }, 'public subject, not an instruction'),
    context: [unit({ role: 'authorityContract', ref: 'fixture:grant', revision: 'r1' }, 'public grant text')],
    checks: [{ id: 'fixture.v5', axis: 'Aligned', concern: 'Fixture concern.', requiredRoles: ['authorityContract'], crossLinks: [],
      predicate: { question: 'Does the subject exceed the grant?', true: 'It exceeds the grant.', false: 'It stays within the grant.' } }] };
  const v5 = world([req(10, { body: requestBody([{ id: 'v5', input: v5Input }]) })]);
  const v5Scan = await runIssueScan(config(), v5.deps);
  assert.equal(v5Scan.stopped, null); assert.deepEqual(v5Scan.decisions, [{ commentId: 10, effect: 'NONE', cause: 'RESULT_EDITION_NOT_COMPOSABLE' }]);
  assert.deepEqual(v5.ownerArgs, []); assert.deepEqual(effects(v5), zero);
  assert.equal(v5.comments.find((c) => c.databaseId === 10).reactions.length, 0);
  // A granted v10 comment carrying an English auxiliary, and a retired v9 comment, are refused the same way:
  // no claim, owner launch, provider fetch or comment post.
  const ja = '受信記録が必要である。';
  const v10Aux = { ...v5Input, schema: 'ops.semlint.input.v10', context: v5Input.context.map((row) => ({ ...row, englishAuxiliary: null })),
    subject: { ...unit(v5Input.subject, ja), englishAuxiliary: { text: 'A receipt record is required.', sourceSha256: hash(ja) } } };
  for (const [input, cause] of [[v10Aux, 'AUDITED_AUXILIARY_REQUIRES_OWNER_ROUTE'], [{ ...v10Aux, schema: 'ops.semlint.input.v9' }, 'INVALID_REQUEST_OR_ADMISSION']]) {
    const w = world([req(10, { body: requestBody([{ id: 'one', input }]) })]);
    const scan = await runIssueScan(config(), w.deps);
    assert.equal(scan.stopped, null); assert.deepEqual(scan.decisions, [{ commentId: 10, effect: 'NONE', cause }]);
    assert.deepEqual(w.ownerArgs, []); assert.deepEqual(effects(w), zero);
    assert.equal(w.comments.find((c) => c.databaseId === 10).reactions.length, 0);
  }
  // A known other login's same-kind reaction is not a claim: the request proceeds normally.
  const human = world([req(10, { reactions: [{ user: 'a-human', content: 'eyes' }] })]);
  assert.equal((await runIssueScan(config(), human.deps)).decisions[0].cause, 'READBACK_EXACT');
  assert.deepEqual(effects(human), { claim: 1, owner: 1, fetch: 1, post: 1 });
  const missing = world([req(11)]);
  assert.deepEqual((await runIssueScan(config(), missing.deps)).decisions, [{ commentId: 10, effect: 'NONE', cause: 'NOT_FOUND' }]);
  // Direct snapshot admission: target and grant membership, and no fabricated action.
  const snap = { repository: 'roccho-dev/ops', issue: 483, comment: { id: 'IC_10', databaseId: 10, author: REQUESTER, body: requestBody(),
    createdAt: '2026-10-05T08:00:00Z', updatedAt: '2026-10-05T08:00:00Z', lastEditedAt: null, includesCreatedEdit: false, userContentEditsTotal: 0 } };
  const admitted = await admitIssueSnapshot(snap, config(), NOW);
  assert.equal(admitted.status, 'ADMITTED'); assert.equal('action' in admitted.identity, false);
  assert.equal(admitted.identity.revision, snap.comment.updatedAt); assert.equal(admitted.identity.nodeId, 'IC_10');
  assert.equal((await admitIssueSnapshot({ ...snap, issue: 484 }, config(), NOW)).cause, 'TARGET_NOT_AUTHORIZED');
  assert.equal((await admitIssueSnapshot({ ...snap, comment: { ...snap.comment, databaseId: 99 } }, config(), NOW)).cause, 'NOT_IN_GRANT');
  assert.equal((await admitIssueSnapshot({ ...snap, action: 'created' }, config(), NOW)).cause, 'SNAPSHOT_UNKNOWN');
  assert.equal((await admitIssueSnapshot(snap, config(), Date.parse('2026-10-07T00:00:00Z'))).cause, 'GRANT_EXPIRED');
  const g2 = await admitIssueSnapshot(snap, config([10], { grant: { ...config().grant, version: 'g2' } }), NOW);
  assert.notEqual(g2.requestDigest, admitted.requestDigest);
});

// Claim outcomes: unknown or not-ours never pays; an unknown-but-created claim stops later scans too.
await check('claim-unknown', async () => {
  const w = world([req(10)]);
  w.hooks.afterClaim = () => ({ status: null, stdout: '' });
  assert.deepEqual((await runIssueScan(config(), w.deps)).stopped, { stage: 'claim', cause: 'UNKNOWN', commentId: 10 });
  assert.deepEqual(effects(w), { claim: 1, owner: 0, fetch: 0, post: 0 });
  delete w.hooks.afterClaim;
  assert.equal((await runIssueScan(config(), w.deps)).decisions[0].cause, 'STARTED');
  assert.equal(w.calls.owner, 0);
  const other = world([req(10)]); other.hooks.claimUser = 'impostor';
  assert.equal((await runIssueScan(config(), other.deps)).stopped.cause, 'CLAIM_NOT_OURS'); assert.equal(other.calls.owner, 0);
  const denied = world([req(10)]); denied.hooks.afterClaim = (_, c) => { c.reactions.pop(); return { status: 1, stdout: 'HTTP/2.0 403 Forbidden\r\n\r\n{}' }; };
  assert.equal((await runIssueScan(config(), denied.deps)).stopped.claimStatus, 403); assert.equal(denied.calls.owner, 0);
  assert.equal(parseHttp('HTTP/1.1 201 Created\n\n{"a":1}').status, 201); assert.equal(parseHttp('201'), null);
});

// TOCTOU after claim: any observed drift stops before the paid call.
await check('reread-drift', async () => {
  for (const change of [
    (c) => { c.body = requestBody([{ id: 'changed', input }]); c.updatedAt = '2026-10-05T09:00:00Z'; c.lastEditedAt = '2026-10-05T09:00:00Z'; },
    (c) => { c.updatedAt = '2026-10-05T09:00:00Z'; },
    (c) => { c.reactions.push({ user: null, content: 'eyes' }); },
    (c) => { c.reactions = c.reactions.filter((r) => r.user !== EXECUTOR); },
    (c) => { c.hiddenReactions = 1; },
  ]) {
    const w = world([req(10)]);
    w.hooks.afterClaim = (_, c, reply) => { change(c); return reply; };
    const r = await runIssueScan(config(), w.deps);
    assert.equal(r.stopped, null); assert.equal(r.decisions[0].cause, 'DRIFT_AFTER_CLAIM');
    assert.deepEqual(effects(w), { claim: 1, owner: 0, fetch: 0, post: 0 });
  }
  const benign = world([req(10)]);
  benign.hooks.afterClaim = (_, c, reply) => { c.reactions.push({ user: 'a-human', content: 'eyes' }); return reply; };
  assert.equal((await runIssueScan(config(), benign.deps)).decisions[0].cause, 'READBACK_EXACT');
  const u = world([req(10)]); u.hooks.reread = () => { throw new Error('crash before launch'); };
  assert.equal((await runIssueScan(config(), u.deps)).stopped.stage, 'reread'); assert.equal(u.calls.owner, 0);
  delete u.hooks.reread;
  assert.equal((await runIssueScan(config(), u.deps)).decisions[0].cause, 'STARTED'); assert.equal(u.calls.owner, 0);
});

// Launch classification: known pre-provider refusal, unknown output, and the paid-before-append crash window.
await check('launch', async () => {
  const refused = world([req(10)]);
  refused.hooks.owner = () => ({ status: 1, stdout: JSON.stringify({ schema: 'ops.semlint.entry-error.v1', status: 'REJECTED', cause: 'INVALID_ENTRY_LIMITS', authority: false }) + '\n' });
  const rr = await runIssueScan(config(), refused.deps);
  assert.equal(rr.stopped, null); assert.equal(rr.decisions[0].cause, 'REFUSED_BEFORE_PROVIDER'); assert.equal(refused.calls.post, 0);
  const err = (extra) => ({ status: 1, stdout: JSON.stringify({ schema: 'ops.semlint.entry-error.v1', status: 'REJECTED', cause: 'INVALID_ENTRY_PLAN', authority: false, ...extra }) + '\n' });
  for (const out of [{ status: 1, stdout: '' }, { status: 1, stdout: JSON.stringify({ schema: 'ops.semlint.entry-error.v1', status: 'REJECTED', cause: 'ENTRY_FAILED', authority: false }) + '\n' },
    err({ authority: true }), err({ extra: 1 }), err({ status: 'ACCEPTED' }), { ...err({}), status: 0 }, { status: 1, stdout: err({}).stdout + err({}).stdout },
    { status: 0, stdout: '{}\n' }, { status: 0, stdout: 'not json\n' }, { status: null, stdout: '' }]) {
    const w = world([req(10)]); w.hooks.owner = () => out;
    assert.deepEqual((await runIssueScan(config(), w.deps)).stopped, { stage: 'launch', cause: 'UNKNOWN', commentId: 10 });
    assert.equal(w.calls.post, 0);
  }
  const crash = world([req(10)]); crash.hooks.beforePost = () => { throw new Error('crash after paid call'); };
  assert.equal((await runIssueScan(config(), crash.deps)).stopped.stage, 'append');
  assert.deepEqual(effects(crash), { claim: 1, owner: 1, fetch: 1, post: 1 });
  assert.equal(crash.comments.length, 1);
  delete crash.hooks.beforePost;
  assert.equal((await runIssueScan(config(), crash.deps)).decisions[0].cause, 'STARTED');
  assert.equal(crash.calls.owner, 1); assert.equal(crash.calls.fetch, 1); // no recharge
});

// Unsuccessful results are withheld unless the finite grant allows posting them.
await check('withheld', async () => {
  const fail503 = () => new Response('{}', { status: 503 });
  const w = world([req(10)]); w.hooks.fetch = fail503;
  const r = await runIssueScan(config(), w.deps);
  assert.equal(r.decisions[0].cause, 'RESULT_WITHHELD'); assert.equal(w.calls.post, 0);
  assert.deepEqual(r.decisions[0].accounting, { providerHttpCalls: 1, validatedResponses: 0, unknownHttpCalls: 0 });
  assert.equal((await runIssueScan(config(), w.deps)).decisions[0].cause, 'STARTED'); assert.equal(w.calls.fetch, 1);
  const allowed = world([req(10)]); allowed.hooks.fetch = fail503;
  const ok = await runIssueScan(config([10], { grant: { ...config().grant, postIncomplete: true } }), allowed.deps);
  assert.equal(ok.decisions[0].cause, 'READBACK_EXACT'); assert.ok(allowed.comments.at(-1).body.includes('HTTP_5XX'));
});

// Unknown append is reconciled from Issue comments, never reposted; readback mismatch stays a mismatch.
await check('append-unknown', async () => {
  const w = world([req(10)]); w.hooks.afterPost = () => ({ status: null, stdout: '' });
  assert.equal((await runIssueScan(config(), w.deps)).stopped.stage, 'append');
  delete w.hooks.afterPost;
  const again = await runIssueScan(config(), w.deps);
  assert.equal(again.decisions[0].cause, 'READBACK_ONLY'); assert.equal(w.calls.post, 1); assert.equal(w.calls.owner, 1);
  const m = world([req(10)]); m.hooks.readBody = 'edited';
  assert.equal((await runIssueScan(config(), m.deps)).stopped.cause, 'READBACK_MISMATCH');
  const tampered = world([req(10)]);
  await runIssueScan(config(), tampered.deps);
  tampered.comments.at(-1).body += 'x';
  assert.equal((await runIssueScan(config(), tampered.deps)).decisions[0].cause, 'STARTED'); // no matching digest: stop, no recall
  const dup = world([req(10)]);
  await runIssueScan(config(), dup.deps);
  dup.comments.push({ ...dup.comments.at(-1), databaseId: 2000 });
  assert.equal((await runIssueScan(config(), dup.deps)).decisions[0].cause, 'UNRECOGNIZED'); assert.equal(dup.calls.owner, 1);
});

// A new grant version that re-lists a used ID cannot clear the source-constant claim marker.
await check('grant-version-change', async () => {
  const w = world([req(10), req(11)]);
  await runIssueScan(config([10]), w.deps);
  const g2 = config([10, 11], { grant: { ...config([10, 11]).grant, version: 'g2' } });
  const r = await runIssueScan(g2, w.deps);
  assert.deepEqual(r.decisions.map((x) => x.cause), ['STARTED', 'READBACK_EXACT']);
  assert.equal(w.calls.fetch, 2); assert.equal(w.calls.post, 2);
});

// Pagination across pages; config is validated as a pure function independent of the scan.
await check('pagination-and-pure-config', async () => {
  const w = world([{ databaseId: 1, body: 'a' }, { databaseId: 2, body: 'b' }, { databaseId: 3, body: 'c' }, req(10)], { page: 1 });
  assert.equal((await runIssueScan(config(), w.deps)).decisions[0].cause, 'READBACK_EXACT'); assert.ok(w.calls.list >= 4);
  assert.throws(() => validateExecutorConfig(config(), NaN), /GRANT_EXPIRED/);
});

// F1: expiry is re-observed before each new effect; nothing (not even a paid result) is posted after expiry.
await check('expiry-mid-run', async () => {
  const late = Date.parse('2026-10-06T00:00:00Z');
  const a = world([req(10)]); a.hooks.list = (w) => { w.clock = late; return null; };
  assert.deepEqual((await runIssueScan(config(), a.deps)).stopped, { stage: 'claim', cause: 'GRANT_EXPIRED', commentId: 10 });
  assert.deepEqual(effects(a), zero);
  const b = world([req(10)]); b.hooks.afterClaim = (w, _, reply) => { w.clock = late; return reply; };
  assert.deepEqual((await runIssueScan(config(), b.deps)).stopped, { stage: 'launch', cause: 'GRANT_EXPIRED', commentId: 10 });
  assert.deepEqual(effects(b), { claim: 1, owner: 0, fetch: 0, post: 0 });
  const c = world([req(10)]); c.hooks.afterOwner = (w) => { w.clock = late; };
  const rc = await runIssueScan(config(), c.deps);
  assert.deepEqual(rc.stopped, { stage: 'append', cause: 'GRANT_EXPIRED', commentId: 10 });
  assert.equal(rc.decisions[0].cause, 'GRANT_EXPIRED_BEFORE_APPEND');
  assert.deepEqual(rc.decisions[0].accounting, { providerHttpCalls: 1, validatedResponses: 1, unknownHttpCalls: 0 });
  assert.deepEqual(effects(c), { claim: 1, owner: 1, fetch: 1, post: 0 });
  c.clock = NOW; // even back inside a valid window, the claimed ID stays STARTED: no recharge, no late post
  assert.equal((await runIssueScan(config(), c.deps)).decisions[0].cause, 'STARTED'); assert.equal(c.calls.fetch, 1); assert.equal(c.calls.post, 0);
});

// F2: results by any author other than executorLogin are ignored, so copies cannot block or fake delivery.
await check('forged-results', async () => {
  const a = world([req(10)]);
  await runIssueScan(config(), a.deps);
  const real = a.comments.at(-1);
  a.comments.push({ ...real, databaseId: 3000, author: 'a-human' });
  const ra = await runIssueScan(config(), a.deps);
  assert.equal(ra.decisions[0].cause, 'READBACK_ONLY'); assert.equal(ra.ignoredResults, 1);
  assert.deepEqual(effects(a), { claim: 1, owner: 1, fetch: 1, post: 1 });
  const b = world([req(10), { ...real, databaseId: 3000, author: 'a-human' }]);
  const rb = await runIssueScan(config(), b.deps);
  assert.equal(rb.decisions[0].cause, 'READBACK_EXACT'); assert.equal(rb.ignoredResults, 1);
  assert.deepEqual(effects(b), { claim: 1, owner: 1, fetch: 1, post: 1 });
});

// Classification against the real fixed entry's actual refusals (no key, no network, pre-provider only).
await check('real-entry-classification', async () => {
  const entry = fileURLToPath(new URL('../semlint-entry.mjs', import.meta.url));
  const child = (stdin) => { const r = spawnSync(process.execPath, [entry], { input: stdin, encoding: 'utf8', env: { LANG: 'C.UTF-8' }, timeout: 10000 });
    return { status: r.status, stdout: r.stdout }; };
  const plan = { schema: 'ops.semlint.real-input.v1', cases: [{ id: 'a', input }] };
  for (const [stdin, cause] of [
    ['not json', 'INVALID_ENTRY_JSON'], [JSON.stringify({ ...plan, cases: [] }), 'INVALID_ENTRY_PLAN'],
    [JSON.stringify({ ...plan, limits: { maxCalls: 1 } }), 'INVALID_ENTRY_LIMITS'],
    [JSON.stringify({ ...plan, cases: [{ id: 'a', input }, { id: 'b', input }], limits: { ...ENTRY_LIMITS, maxCalls: 1 } }), 'ENTRY_CALL_BUDGET_EXCEEDED'],
  ]) assert.deepEqual(classifyOwnerOutput(child(stdin)), { kind: 'REFUSED', cause });
  // The executor's copy must equal the entry's closed allowed set (semlint-entry.mjs is outside this file set).
  const entrySource = fs.readFileSync(entry, 'utf8');
  const allowed = JSON.parse(entrySource.match(/const allowed = (\[[^\]]*\])/)[1].replaceAll("'", '"').replace(/\s+/g, ''));
  assert.deepEqual([...PRE_PROVIDER_CAUSES].sort(), [...allowed].sort());
  // A lone surrogate is refused by the entry as ENTRY_FAILED, which cannot be proven pre-provider: UNKNOWN.
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

// Real-scale IDs (above Int32, e.g. the observed REST id 5969636905) through grant, claim, re-read, append,
// readback and replay; malformed or mismatched wire IDs hold only that comment with zero effect.
await check('real-scale-ids', async () => {
  const BIG = 5969636905;
  const w = world([req(BIG)]); w.nextId = 5969700001;
  const r = await runIssueScan(config([BIG]), w.deps);
  assert.equal(r.stopped, null); assert.equal(r.decisions[0].commentId, BIG); assert.equal(r.decisions[0].cause, 'READBACK_EXACT');
  assert.equal(r.decisions[0].resultId, 5969700001); assert.equal(w.calls.node, 1);
  assert.deepEqual(w.comments[0].reactions, [{ user: EXECUTOR, content: 'eyes' }]);
  const identity = JSON.parse(w.comments.at(-1).body.slice(RESULT_PREFIX.length)).identity;
  assert.equal(identity.commentId, BIG); assert.equal(identity.nodeId, `IC_${BIG}`);
  assert.equal((await runIssueScan(config([BIG]), w.deps)).decisions[0].cause, 'READBACK_ONLY');
  assert.deepEqual(effects(w), { claim: 1, owner: 1, fetch: 1, post: 1 });
  for (const [wire, extra] of [[BIG], ['0'], ['-1'], ['05969636905'], ['1e10'], [' 1'], ['9007199254740993'], [null],
    [String(BIG), { databaseId: null }], [String(BIG), { databaseId: 1674670121 }]]) {
    const bad = { ...req(BIG), wireId: wire, ...(extra ? { extraKeys: extra } : {}) };
    // The malformed granted node is unidentifiable: it can only be NOT_FOUND, and an unrelated valid
    // granted request in the same scan is still processed (no global stop).
    const m = world([bad, req(10)]);
    const rm = await runIssueScan(config([BIG, 10], { grant: { ...config([BIG, 10]).grant } }), m.deps);
    assert.equal(rm.stopped, null); assert.equal(rm.unidentifiedComments, 1);
    assert.deepEqual(rm.decisions.map((x) => [x.commentId, x.cause]), [[10, 'READBACK_EXACT'], [BIG, 'NOT_FOUND']]);
    assert.deepEqual(m.comments[0].reactions, []); assert.equal(m.calls.owner, 1); assert.equal(m.calls.post, 1);
  }
  // Re-read returning an unidentifiable node stops before the paid call.
  const rr = world([req(BIG)]);
  rr.hooks.afterClaim = (_, c, reply) => { c.wireId = BIG; return reply; };
  assert.equal((await runIssueScan(config([BIG]), rr.deps)).stopped.stage, 'reread'); assert.equal(rr.calls.owner, 0);
  assert.equal(decodeFullDatabaseId(String(BIG)), BIG); assert.equal(decodeFullDatabaseId(BIG), null);
  assert.equal(decodeFullDatabaseId('9007199254740991'), 9007199254740991); assert.equal(decodeFullDatabaseId('9007199254740992'), null);
});

// Static boundary: no delete/update provider API, no key access, fixed executables only.
const here = fileURLToPath(new URL('../issue-executor.mjs', import.meta.url));
for (const file of [here, fileURLToPath(new URL('../github-comment.mjs', import.meta.url))]) {
  const src = fs.readFileSync(file, 'utf8');
  for (const banned of ["'DELETE'", "'PATCH'", "'PUT'", 'JEV_API_KEY', 'process.env', 'shell: true']) assert.equal(src.includes(banned), false, banned);
}
assert.equal(GH, '/nix/var/nix/profiles/windows-dev/bin/gh'); assert.equal(OPS_JEV, '/nix/var/nix/profiles/windows-dev/bin/ops-jev');
const cli = spawnSync(process.execPath, [here, '--config', 'relative.json'], { encoding: 'utf8', env: { LANG: 'C.UTF-8' }, timeout: 10000 });
assert.equal(cli.status, 2); assert.equal(JSON.parse(cli.stdout).stopped.cause, 'INVALID_EXECUTOR_ARGS');
console.log(JSON.stringify({ status: 'PASS', check: 'jev-issue-executor', scenarios, realProviderCalls: 0, githubEffects: 0,
  claim: 'SOURCE_FIXTURE_ONLY_NOT_REAL_ISSUE_OR_PROVIDER_EVIDENCE' }));
