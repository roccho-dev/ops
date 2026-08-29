const TARGET_REPOSITORY = 'roccho-dev/adrs';
const TARGET_ISSUE = 318;
const PROPOSAL_ID = 'adrs318-ui-proposal-oidc-canary-v1';
const OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
const OIDC_AUDIENCE = 'adrs-318-ui-proposal-relay';
const RELAY_WORKFLOW_REF = 'roccho-dev/adrs/.github/workflows/adrs-318-ui-proposal-relay.yml@refs/heads/proposals';
const MAX_BODY_BYTES = 4096;

const FIXED_PROPOSAL = Object.freeze({
  schema: 'adrs.uiProposal.canary.v2',
  sample: true,
  authority: false,
  target_repository: TARGET_REPOSITORY,
  target_issue: TARGET_ISSUE,
  proposal_id: PROPOSAL_ID,
  base_release_digest: 'sha256:8f087d7babfbb04bce7e9e6a1bd21169dec5d37299c58bfcbb49c5756468c461',
  operations: [{
    op: 'set-responsibility',
    package_id: 'pkg.adrs318.canary',
    value: 'UI proposal ingress can be recorded through an ADRS-owned OIDC relay without giving the public Worker GitHub write credentials.',
  }],
  reason: 'Prove UI submit → immutable R2 queue → ADRS-owned GitHub Actions relay → exact Issue comment readback → Worker acknowledgement.',
  idempotency_key: PROPOSAL_ID,
  cutover: false,
});

let oidcMetadataCache = null;
let jwksCache = null;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}

function canonical(value) {
  return `${JSON.stringify(stable(value))}\n`;
}

function json(value, status = 200, headers = {}) {
  return new Response(canonical(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      ...headers,
    },
  });
}

function fail(status, code, message) {
  return json({
    schema: 'ops.adrsUiProposalIngressError/1',
    status: 'ERROR',
    code,
    message,
    authority: false,
    cutover: false,
  }, status);
}

function hex(bytes) {
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  return `sha256:${hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))}`;
}

function proposalKey(id) {
  return `proposals/${id}.json`;
}

function receiptKey(id) {
  return `receipts/${id}.json`;
}

async function readJsonObject(bucket, key) {
  const object = await bucket.get(key);
  if (!object) return null;
  const text = await object.text();
  return { object, text, value: JSON.parse(text) };
}

function commentBody(proposal) {
  return `<!-- adrs.uiProposal.canary.v2 proposal_id=${proposal.proposal_id} -->\n\n\`\`\`jsonl\n${canonical(proposal)}\`\`\`\n`;
}

function exactProposal(value) {
  return canonical(value) === canonical(FIXED_PROPOSAL);
}

async function parseJsonBody(request) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new TypeError('request body too large');
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw new TypeError('request body too large');
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('request body must be an object');
  return value;
}

function requireSameOrigin(request) {
  const origin = request.headers.get('origin');
  const expected = new URL(request.url).origin;
  if (origin !== expected) throw new TypeError('same-origin submission required');
  const media = (request.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
  if (media !== 'application/json') throw new TypeError('application/json required');
}

async function submitProposal(request, env) {
  try {
    requireSameOrigin(request);
    const proposal = await parseJsonBody(request);
    if (!exactProposal(proposal)) return fail(400, 'CANARY_CONTRACT_MISMATCH', 'only the fixed non-authority canary is accepted by this proof');

    const proposalBytes = canonical(proposal);
    const proposalDigest = await sha256(proposalBytes);
    const body = commentBody(proposal);
    const bodyDigest = await sha256(body);
    const key = proposalKey(proposal.proposal_id);
    const existing = await readJsonObject(env.PROPOSALS, key);
    if (existing) {
      if (existing.value?.proposal_digest !== proposalDigest) return fail(409, 'IDEMPOTENCY_CONFLICT', 'proposal_id already binds different meaning');
      return json({
        schema: 'ops.adrsUiProposalSubmitResult/1',
        status: 'PASS',
        duplicate: true,
        proposal_id: proposal.proposal_id,
        proposal_digest: proposalDigest,
        comment_body_sha256: bodyDigest,
        object_key: key,
        object_sha256: await sha256(existing.text),
        state: (await readJsonObject(env.PROPOSALS, receiptKey(proposal.proposal_id))) ? 'recorded' : 'submitted',
        authority: false,
        current_changed: false,
        cutover: false,
      });
    }

    const envelope = {
      schema: 'ops.adrsUiProposalQueueItem/1',
      status: 'submitted',
      proposal,
      proposal_digest: proposalDigest,
      comment_body: body,
      comment_body_sha256: bodyDigest,
      submitted_at: new Date().toISOString(),
      authority: false,
      current_changed: false,
      cutover: false,
    };
    const bytes = canonical(envelope);
    const stored = await env.PROPOSALS.put(key, bytes, {
      onlyIf: { etagDoesNotMatch: '*' },
      httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'no-store' },
      customMetadata: {
        schema: envelope.schema,
        proposal_id: proposal.proposal_id,
        proposal_digest: proposalDigest,
      },
    });
    if (!stored) {
      const raced = await readJsonObject(env.PROPOSALS, key);
      if (!raced) return fail(409, 'CONCURRENT_APPEND_UNKNOWN', 'conditional append failed without readable winner');
      if (raced.value?.proposal_digest !== proposalDigest) return fail(409, 'IDEMPOTENCY_CONFLICT', 'concurrent proposal_id binds different meaning');
      return json({
        schema: 'ops.adrsUiProposalSubmitResult/1', status: 'PASS', duplicate: true,
        proposal_id: proposal.proposal_id, proposal_digest: proposalDigest,
        comment_body_sha256: bodyDigest, object_key: key,
        object_sha256: await sha256(raced.text), state: 'submitted',
        authority: false, current_changed: false, cutover: false,
      });
    }
    const readback = await readJsonObject(env.PROPOSALS, key);
    if (!readback || readback.text !== bytes) return fail(500, 'R2_READBACK_MISMATCH', 'proposal did not read back byte-identically');
    return json({
      schema: 'ops.adrsUiProposalSubmitResult/1',
      status: 'PASS',
      duplicate: false,
      proposal_id: proposal.proposal_id,
      proposal_digest: proposalDigest,
      comment_body_sha256: bodyDigest,
      object_key: key,
      object_sha256: await sha256(readback.text),
      state: 'submitted',
      authority: false,
      current_changed: false,
      cutover: false,
    }, 201);
  } catch (error) {
    return fail(400, 'INVALID_PROPOSAL', error instanceof Error ? error.message : String(error));
  }
}

async function proposalStatus(env, id) {
  if (id !== PROPOSAL_ID) return fail(404, 'NOT_FOUND', 'proposal not found');
  const proposal = await readJsonObject(env.PROPOSALS, proposalKey(id));
  if (!proposal) return fail(404, 'NOT_FOUND', 'proposal not found');
  const receipt = await readJsonObject(env.PROPOSALS, receiptKey(id));
  return json({
    schema: 'ops.adrsUiProposalStatus/1',
    status: 'PASS',
    proposal_id: id,
    proposal_digest: proposal.value.proposal_digest,
    comment_body_sha256: proposal.value.comment_body_sha256,
    state: receipt ? 'recorded' : 'submitted',
    comment_id: receipt?.value?.comment_id ?? null,
    comment_url: receipt?.value?.comment_url ?? null,
    exact_comment_readback: receipt?.value?.exact_comment_readback ?? false,
    gov_materialized: false,
    current_changed: false,
    authority: false,
    cutover: false,
  });
}

function decodeBase64Url(value) {
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=')), char => char.charCodeAt(0));
}

function decodeJsonPart(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

async function oidcMetadata() {
  if (!oidcMetadataCache) {
    const response = await fetch(`${OIDC_ISSUER}/.well-known/openid-configuration`, { cache: 'force-cache' });
    if (!response.ok) throw new TypeError(`OIDC metadata HTTP ${response.status}`);
    oidcMetadataCache = await response.json();
  }
  return oidcMetadataCache;
}

async function jwks() {
  if (!jwksCache) {
    const metadata = await oidcMetadata();
    const response = await fetch(metadata.jwks_uri, { cache: 'force-cache' });
    if (!response.ok) throw new TypeError(`OIDC JWKS HTTP ${response.status}`);
    jwksCache = await response.json();
  }
  return jwksCache;
}

async function verifyRelayToken(request) {
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) throw new TypeError('relay bearer token required');
  const token = authorization.slice(7);
  const parts = token.split('.');
  if (parts.length !== 3) throw new TypeError('invalid relay JWT');
  const header = decodeJsonPart(parts[0]);
  const claims = decodeJsonPart(parts[1]);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new TypeError('unsupported relay JWT');
  const set = await jwks();
  const jwk = set.keys?.find(item => item.kid === header.kid && item.kty === 'RSA');
  if (!jwk) throw new TypeError('relay signing key not found');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    decodeBase64Url(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!valid) throw new TypeError('relay JWT signature invalid');
  const now = Math.floor(Date.now() / 1000);
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== OIDC_ISSUER || !audience.includes(OIDC_AUDIENCE)) throw new TypeError('relay JWT issuer or audience invalid');
  if (!Number.isInteger(claims.exp) || claims.exp <= now || (Number.isInteger(claims.nbf) && claims.nbf > now + 30)) throw new TypeError('relay JWT expired or not active');
  if (claims.repository !== TARGET_REPOSITORY) throw new TypeError('relay repository denied');
  if (claims.ref !== 'refs/heads/proposals') throw new TypeError('relay ref denied');
  if (claims.workflow_ref !== RELAY_WORKFLOW_REF) throw new TypeError('relay workflow denied');
  if (!['push', 'workflow_dispatch', 'schedule'].includes(claims.event_name)) throw new TypeError('relay event denied');
  return claims;
}

async function pending(request, env) {
  try {
    const claims = await verifyRelayToken(request);
    const listed = await env.PROPOSALS.list({ prefix: 'proposals/', limit: 10 });
    const items = [];
    for (const metadata of listed.objects.sort((a, b) => a.key.localeCompare(b.key))) {
      const stored = await readJsonObject(env.PROPOSALS, metadata.key);
      if (!stored) continue;
      const id = stored.value?.proposal?.proposal_id;
      if (!id || await readJsonObject(env.PROPOSALS, receiptKey(id))) continue;
      items.push({
        proposal_id: id,
        target_repository: stored.value.proposal.target_repository,
        target_issue: stored.value.proposal.target_issue,
        proposal_digest: stored.value.proposal_digest,
        comment_body: stored.value.comment_body,
        comment_body_sha256: stored.value.comment_body_sha256,
      });
    }
    return json({
      schema: 'ops.adrsUiProposalPending/1',
      status: 'PASS',
      items,
      relay_repository: claims.repository,
      relay_ref: claims.ref,
      authority: false,
      cutover: false,
    });
  } catch (error) {
    return fail(401, 'RELAY_AUTH_DENIED', error instanceof Error ? error.message : String(error));
  }
}

async function acknowledge(request, env) {
  try {
    await verifyRelayToken(request);
    const value = await parseJsonBody(request);
    const allowed = ['schema', 'proposal_id', 'proposal_digest', 'comment_body_sha256', 'comment_id', 'comment_url', 'exact_comment_readback'];
    if (Object.keys(value).sort().join(',') !== [...allowed].sort().join(',')) throw new TypeError('ack fields invalid');
    if (value.schema !== 'adrs.uiProposalRelayAck.v1' || value.proposal_id !== PROPOSAL_ID) throw new TypeError('ack identity invalid');
    const proposal = await readJsonObject(env.PROPOSALS, proposalKey(value.proposal_id));
    if (!proposal) throw new TypeError('proposal missing');
    if (value.proposal_digest !== proposal.value.proposal_digest || value.comment_body_sha256 !== proposal.value.comment_body_sha256) throw new TypeError('ack digest mismatch');
    if (!Number.isInteger(value.comment_id) || value.comment_id <= 0) throw new TypeError('comment_id invalid');
    if (!new RegExp(`^https://github\\.com/roccho-dev/adrs/issues/${TARGET_ISSUE}#issuecomment-[0-9]+$`).test(value.comment_url)) throw new TypeError('comment_url invalid');
    if (value.exact_comment_readback !== true) throw new TypeError('exact readback required');

    const receipt = {
      schema: 'ops.adrsUiProposalRecordedReceipt/1',
      status: 'recorded',
      ...value,
      recorded_at: new Date().toISOString(),
      authority: false,
      gov_materialized: false,
      current_changed: false,
      cutover: false,
    };
    const bytes = canonical(receipt);
    const key = receiptKey(value.proposal_id);
    const existing = await readJsonObject(env.PROPOSALS, key);
    if (existing) {
      const same = existing.value?.comment_id === value.comment_id && existing.value?.comment_body_sha256 === value.comment_body_sha256;
      if (!same) return fail(409, 'ACK_CONFLICT', 'proposal already binds different comment acknowledgement');
      return json({ schema: 'ops.adrsUiProposalAckResult/1', status: 'PASS', duplicate: true, receipt: existing.value, authority: false, cutover: false });
    }
    const stored = await env.PROPOSALS.put(key, bytes, {
      onlyIf: { etagDoesNotMatch: '*' },
      httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'no-store' },
      customMetadata: { schema: receipt.schema, proposal_id: value.proposal_id, comment_id: String(value.comment_id) },
    });
    if (!stored) return fail(409, 'ACK_RACE', 'acknowledgement race');
    const readback = await readJsonObject(env.PROPOSALS, key);
    if (!readback || readback.text !== bytes) return fail(500, 'ACK_READBACK_MISMATCH', 'acknowledgement did not read back exactly');
    return json({ schema: 'ops.adrsUiProposalAckResult/1', status: 'PASS', duplicate: false, receipt: readback.value, authority: false, cutover: false }, 201);
  } catch (error) {
    return fail(400, 'INVALID_ACK', error instanceof Error ? error.message : String(error));
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/meta') {
      return json({
        schema: 'ops.adrsUiProposalIngressMeta/1',
        status: 'PASS',
        proposal_id: PROPOSAL_ID,
        target_repository: TARGET_REPOSITORY,
        target_issue: TARGET_ISSUE,
        queue: 'R2',
        relay_auth: 'GitHub Actions OIDC',
        github_write_credential_in_worker: false,
        app_version: env.APP_VERSION || 'unbound',
        authority: false,
        cutover: false,
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/proposals') return submitProposal(request, env);
    if (request.method === 'GET' && url.pathname === `/api/proposals/${PROPOSAL_ID}`) return proposalStatus(env, PROPOSAL_ID);
    if (request.method === 'GET' && url.pathname === '/api/relay/pending') return pending(request, env);
    if (request.method === 'POST' && url.pathname === '/api/relay/ack') return acknowledge(request, env);
    if (url.pathname.startsWith('/api/')) return fail(404, 'NOT_FOUND', 'unknown API route');
    if (!['GET', 'HEAD'].includes(request.method)) return fail(405, 'METHOD_NOT_ALLOWED', 'method not allowed');
    return env.ASSETS.fetch(request);
  },
};

export { FIXED_PROPOSAL, OIDC_AUDIENCE, PROPOSAL_ID, RELAY_WORKFLOW_REF, canonical, commentBody, proposalKey, receiptKey };
