import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RESULT_PREFIX, validateExecutorConfig, admitIssueSnapshot, deriveIssuePrior, nextIssueEffect,
  composeResultComment, verifyResultReadback } from './github-comment.mjs';

// Source-constant adapter surface. Candidates declared by the owner profile source (windows 0d77745 oci/dev/nix.nix);
// their adoption on a target is not implied. Config supplies only the two SHA values, never a path/argv/program/cwd.
export const GH = '/nix/var/nix/profiles/windows-dev/bin/gh';
export const OPS_JEV = '/nix/var/nix/profiles/windows-dev/bin/ops-jev';
export const CLAIM = Object.freeze({ rest: 'eyes', graphql: 'EYES' });
const PRE_PROVIDER_CAUSES = ['INVALID_ENTRY_ARGS', 'ENTRY_INPUT_TOO_LARGE', 'INVALID_ENTRY_JSON', 'INVALID_ENTRY_PLAN',
  'INVALID_ENTRY_LIMITS', 'INVALID_ENTRY_CASE', 'INVALID_ENTRY_SEMLINT', 'ENTRY_PREFLIGHT_FAILED', 'ENTRY_CALL_BUDGET_EXCEEDED'];
// IssueComment.databaseId is Int (signed 32-bit) and cannot represent real REST comment IDs; fullDatabaseId is
// BigInt, whose wire encoding is a string. Only fullDatabaseId is requested.
const FIELDS = 'id fullDatabaseId author{login} body createdAt updatedAt lastEditedAt includesCreatedEdit userContentEdits{totalCount} '
  + `reactions(content:${CLAIM.graphql},first:100){totalCount nodes{content user{login}}}`;
export const LIST_QUERY = 'query($owner:String!,$name:String!,$number:Int!,$after:String){repository(owner:$owner,name:$name)'
  + `{issue(number:$number){comments(first:100,after:$after){totalCount pageInfo{hasNextPage endCursor} nodes{${FIELDS}}}}}}`;
export const NODE_QUERY = `query($id:ID!){node(id:$id){... on IssueComment{${FIELDS}}}}`;
const MAX_PAGES = 1000;

const json = (s) => { try { return JSON.parse(s); } catch { return undefined; } };
// One JSON line on stdout; anything else is not a parseable result.
const oneLine = (s) => (typeof s === 'string' && s.endsWith('\n') && s.indexOf('\n') === s.length - 1 ? json(s) : undefined);
// `gh api -i` prints the raw HTTP status line and headers before the body.
export function parseHttp(stdout) {
  if (typeof stdout !== 'string') return null;
  const m = /^HTTP\/[0-9.]+ (\d{3})\b/.exec(stdout);
  const split = stdout.search(/\r?\n\r?\n/);
  if (!m || split < 0) return null;
  const body = stdout.slice(split).trim();
  return { status: Number(m[1]), json: body ? json(body) : null };
}

async function ghJson(deps, args, input) {
  let out;
  try { out = await deps.run(GH, args, input); } catch { return undefined; }
  return out && out.status === 0 ? json(out.stdout) : undefined;
}

// BigInt wire string -> exact positive safe integer, or null. No rounding, opaque node-id decoding or fallback.
export function decodeFullDatabaseId(value) {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && String(n) === value ? n : null;
}
const NODE_KEYS = ['author', 'body', 'createdAt', 'fullDatabaseId', 'id', 'includesCreatedEdit', 'lastEditedAt', 'reactions', 'updatedAt', 'userContentEdits'];

// Map one GraphQL IssueComment to the admission snapshot plus its claim list. Returns undefined for a
// non-object node, and null for a node that cannot be identified (key set differs from the requested
// fields, or fullDatabaseId is not an exact safe positive integer string). An incomplete or malformed
// reaction list yields claims=null: only that comment is held, the rest of the scan continues.
function mapNode(node, repository, issue) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return undefined;
  const databaseId = decodeFullDatabaseId(node.fullDatabaseId);
  if (databaseId === null || JSON.stringify(Object.keys(node).sort()) !== JSON.stringify(NODE_KEYS)) return null;
  const r = node.reactions;
  const complete = r && Array.isArray(r.nodes) && r.totalCount === r.nodes.length && r.nodes.every((x) => x && x.content === CLAIM.graphql);
  return {
    snapshot: { repository, issue, comment: { id: node.id, databaseId, author: node.author?.login ?? null,
      body: node.body, createdAt: node.createdAt, updatedAt: node.updatedAt, lastEditedAt: node.lastEditedAt,
      includesCreatedEdit: node.includesCreatedEdit, userContentEditsTotal: node.userContentEdits?.totalCount ?? null } },
    claims: complete ? r.nodes.map((x) => x.user?.login ?? null) : null,
  };
}

// Owner stdout is one JSON line. Only an exact closed pre-provider entry-error is a refusal; anything else
// that is not a v2 result (including ENTRY_FAILED, empty or malformed output) is UNKNOWN.
export function classifyOwnerOutput(out) {
  const value = oneLine(out?.stdout);
  if (out?.status === 1 && value && Object.keys(value).length === 4 && value.schema === 'ops.semlint.entry-error.v1'
    && value.status === 'REJECTED' && value.authority === false && PRE_PROVIDER_CAUSES.includes(value.cause)) return { kind: 'REFUSED', cause: value.cause };
  if (out?.status === 0 && value?.schema === 'ops.semlint.real-result.v2') return { kind: 'RESULT', value };
  return { kind: 'UNKNOWN' };
}
export { PRE_PROVIDER_CAUSES };

async function readIssue(deps, config) {
  const [owner, name] = config.repository.split('/');
  const nodes = [];
  let after = null, total = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const args = ['api', 'graphql', '-f', `query=${LIST_QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `number=${config.issue}`];
    if (after !== null) args.push('-f', `after=${after}`);
    const value = await ghJson(deps, args);
    const c = value?.data?.repository?.issue?.comments;
    if (!value || value.errors !== undefined || !c || !Array.isArray(c.nodes) || !Number.isSafeInteger(c.totalCount)
      || (total !== null && c.totalCount !== total) || typeof c.pageInfo?.hasNextPage !== 'boolean') return undefined;
    total = c.totalCount;
    nodes.push(...c.nodes);
    if (!c.pageInfo.hasNextPage) {
      if (nodes.length !== total) return undefined;
      const all = nodes.map((n) => mapNode(n, config.repository, config.issue));
      if (all.some((x) => x === undefined)) return undefined;
      // An unidentifiable comment is excluded, not a global stop: every effect is keyed by a verified
      // exact ID, so a granted ID that may hide behind it is simply NOT_FOUND with zero effect.
      const mapped = all.filter((x) => x !== null);
      const ids = mapped.map((x) => x.snapshot.comment.databaseId);
      if (new Set(ids).size !== ids.length) return undefined;
      const prefixed = mapped.filter((x) => typeof x.snapshot.comment.body === 'string' && x.snapshot.comment.body.startsWith(RESULT_PREFIX));
      // Only the trusted result author can deliver; copies by anyone else are ignored and only counted.
      const ours = prefixed.filter((x) => x.snapshot.comment.author === config.executorLogin);
      return { byId: new Map(mapped.map((x) => [x.snapshot.comment.databaseId, x])), ignoredResults: prefixed.length - ours.length,
        unidentifiedComments: all.length - mapped.length,
        results: ours.map((x) => ({ databaseId: x.snapshot.comment.databaseId, author: x.snapshot.comment.author, body: x.snapshot.comment.body })) };
    }
    if (typeof c.pageInfo.endCursor !== 'string' || c.pageInfo.endCursor === after) return undefined;
    after = c.pageInfo.endCursor;
  }
  return undefined;
}

async function readNode(deps, config, nodeId) {
  const value = await ghJson(deps, ['api', 'graphql', '-f', `query=${NODE_QUERY}`, '-f', `id=${nodeId}`]);
  if (!value || value.errors !== undefined) return undefined;
  return mapNode(value?.data?.node, config.repository, config.issue);
}

function completeResult(output, prepared) {
  const a = output.accounting;
  return a.providerHttpCalls === prepared.plannedCalls && a.validatedResponses === a.providerHttpCalls && a.unknownHttpCalls === 0;
}

// One finite scan over the trusted exact-ID grant. Not a daemon: no loop, timer, queue, ledger or retry.
// Any UNKNOWN effect stops every later effect in this run; a later scan reconciles from provider state.
export async function runIssueScan(configValue, deps) {
  const receipt = { schema: 'ops.jev.issue-scan-receipt.v1', decisions: [], stopped: null, authority: false };
  const stop = (stage, cause, extra = {}) => { receipt.stopped = { stage, cause, ...extra }; return receipt; };
  const nowMs = deps.now();
  let config;
  try { config = validateExecutorConfig(configValue, nowMs); } catch (error) { return stop('config', error.message); }
  const who = await ghJson(deps, ['api', 'user']);
  if (!who) return stop('principal', 'UNKNOWN');
  if (who.login !== config.executorLogin) return stop('principal', 'PRINCIPAL_MISMATCH');
  const scan = await readIssue(deps, config);
  if (!scan) return stop('snapshot', 'SNAPSHOT_UNKNOWN');
  receipt.ignoredResults = scan.ignoredResults;
  receipt.unidentifiedComments = scan.unidentifiedComments;
  const repo = config.repository;
  // Expiry is observed from the injected clock immediately before each new effect, never reused from scan start.
  const expired = () => { const t = deps.now(); return !Number.isFinite(t) || t >= Date.parse(config.grant.expiresAt); };
  for (const commentId of [...config.grant.commentIds].sort((a, b) => a - b)) {
    const decide = (effect, cause, extra = {}) => receipt.decisions.push({ commentId, effect, cause, ...extra });
    const seen = scan.byId.get(commentId);
    if (!seen) { decide('NONE', 'NOT_FOUND'); continue; }
    const request = await admitIssueSnapshot(seen.snapshot, config, nowMs);
    if (request.status !== 'ADMITTED') { decide('NONE', request.cause); continue; }
    if (seen.claims === null) { decide('NONE', 'CLAIMS_INCOMPLETE'); continue; }
    const prior = deriveIssuePrior(request, { claims: seen.claims, results: scan.results }, config.executorLogin);
    const next = nextIssueEffect(request, prior);
    if (next.effect === 'READBACK_ONLY') { decide('APPENDED', 'READBACK_ONLY', { requestDigest: request.requestDigest }); continue; }
    if (next.effect !== 'EVALUATE') { decide('NONE', prior ? prior.state : next.cause); continue; }

    // Claim: only a raw 201 for this principal and the source-constant kind proceeds to a paid call.
    if (expired()) { decide('NONE', 'GRANT_EXPIRED'); return stop('claim', 'GRANT_EXPIRED', { commentId }); }
    let claimOut;
    try { claimOut = await deps.run(GH, ['api', '-i', '-X', 'POST', `repos/${repo}/issues/comments/${commentId}/reactions`, '-f', `content=${CLAIM.rest}`]); }
    catch { claimOut = null; }
    const claim = parseHttp(claimOut?.stdout);
    if (!claim) { decide('UNKNOWN', 'CLAIM_UNKNOWN'); return stop('claim', 'UNKNOWN', { commentId }); }
    if (claim.status === 200) { decide('NONE', 'ALREADY_CLAIMED', { claimStatus: 200 }); continue; }
    if (claim.status !== 201 || claim.json?.user?.login !== config.executorLogin || claim.json?.content !== CLAIM.rest) {
      decide('UNKNOWN', 'CLAIM_NOT_OURS', { claimStatus: claim.status });
      return stop('claim', 'CLAIM_NOT_OURS', { commentId, claimStatus: claim.status });
    }

    // Re-read after claim, before any paid call: the observed comment and claim set must be unchanged.
    const again = await readNode(deps, config, seen.snapshot.comment.id);
    if (!again) { decide('UNKNOWN', 'REREAD_UNKNOWN', { claimStatus: 201 }); return stop('reread', 'UNKNOWN', { commentId }); }
    const claimsOk = (claims) => Array.isArray(claims) && !claims.includes(null) && claims.filter((x) => x === config.executorLogin).length === 1;
    if (JSON.stringify(again.snapshot) !== JSON.stringify(seen.snapshot) || !claimsOk(again.claims)) {
      decide('NONE', 'DRIFT_AFTER_CLAIM', { claimStatus: 201 }); continue;
    }

    // Fixed existing owner entry only; the plan on stdin carries cases and effective caller caps.
    if (expired()) { decide('NONE', 'GRANT_EXPIRED', { claimStatus: 201 }); return stop('launch', 'GRANT_EXPIRED', { commentId }); }
    let launched;
    try {
      launched = await deps.run(OPS_JEV, ['--semlint-real', '--envs-sha', config.owner.envsSha, '--ops-sha', config.owner.opsSha],
        JSON.stringify(request.prepared.plan));
    } catch { launched = null; }
    const owner = classifyOwnerOutput(launched);
    if (owner.kind === 'REFUSED') { decide('NONE', 'REFUSED_BEFORE_PROVIDER', { claimStatus: 201, entryCause: owner.cause }); continue; }
    const value = owner.value;
    let body;
    try {
      if (owner.kind !== 'RESULT') throw new Error('LAUNCH');
      body = composeResultComment(request, value);
    } catch { decide('UNKNOWN', 'LAUNCH_UNKNOWN', { claimStatus: 201 }); return stop('launch', 'UNKNOWN', { commentId }); }
    const accounting = { providerHttpCalls: value.accounting.providerHttpCalls, validatedResponses: value.accounting.validatedResponses,
      unknownHttpCalls: value.accounting.unknownHttpCalls };
    if (!config.grant.postIncomplete && !completeResult(value, request.prepared)) { decide('NONE', 'RESULT_WITHHELD', { claimStatus: 201, accounting }); continue; }

    // Expiry is a hard permission boundary for every effect, including delivery of an already paid result:
    // nothing is posted after expiresAt. The paid attempt is reported here and the claim keeps the ID STARTED.
    if (expired()) {
      decide('NONE', 'GRANT_EXPIRED_BEFORE_APPEND', { claimStatus: 201, accounting, requestDigest: request.requestDigest });
      return stop('append', 'GRANT_EXPIRED', { commentId });
    }
    // Append exactly once; an unknown post is never reposted, a later scan reconciles from Issue comments.
    let postOut;
    try { postOut = await deps.run(GH, ['api', '-i', '-X', 'POST', `repos/${repo}/issues/${config.issue}/comments`, '--input', '-'], JSON.stringify({ body })); }
    catch { postOut = null; }
    const post = parseHttp(postOut?.stdout);
    const resultId = post?.json?.id;
    if (!post || post.status !== 201 || !Number.isSafeInteger(resultId) || resultId <= 0) {
      decide('UNKNOWN', 'APPEND_UNKNOWN', { claimStatus: 201, accounting }); return stop('append', 'UNKNOWN', { commentId });
    }
    const read = await ghJson(deps, ['api', `repos/${repo}/issues/comments/${resultId}`]);
    const where = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)$/.exec(read?.issue_url ?? '');
    if (!read || !where) { decide('UNKNOWN', 'READBACK_UNKNOWN', { claimStatus: 201, resultId, accounting }); return stop('readback', 'UNKNOWN', { commentId, resultId }); }
    const observed = { repository: where[1], issue: Number(where[2]), id: read.id, author: read.user?.login, body: read.body };
    if (!verifyResultReadback(request, body, observed, config.executorLogin, resultId)) {
      decide('APPENDED', 'READBACK_MISMATCH', { claimStatus: 201, resultId, accounting }); return stop('readback', 'READBACK_MISMATCH', { commentId, resultId });
    }
    decide('APPENDED', 'READBACK_EXACT', { claimStatus: 201, resultId, requestDigest: request.requestDigest, accounting });
  }
  return receipt;
}

// Production process boundary: absolute source-constant executables, explicit argv, shell disabled, stderr inherited.
export const productionDeps = Object.freeze({
  now: () => Date.now(),
  run: async (file, args, input = '') => {
    const r = spawnSync(file, args, { input, encoding: 'utf8', shell: false, stdio: ['pipe', 'pipe', 'inherit'],
      maxBuffer: 16 << 20, timeout: 30 * 60 * 1000 });
    return { status: r.error ? null : r.status, stdout: r.stdout ?? '' };
  },
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--config' || !path.isAbsolute(args[1])) {
    process.stdout.write(JSON.stringify({ schema: 'ops.jev.issue-scan-receipt.v1', stopped: { stage: 'args', cause: 'INVALID_EXECUTOR_ARGS' }, authority: false }) + '\n');
    process.exitCode = 2;
  } else {
    const config = json(fs.readFileSync(args[1], 'utf8'));
    const receipt = await runIssueScan(config, productionDeps);
    process.stdout.write(JSON.stringify(receipt) + '\n');
    process.exitCode = receipt.stopped ? 1 : 0;
  }
}
