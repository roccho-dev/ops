import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import worker, {
  FIXED_PROPOSAL,
  OIDC_AUDIENCE,
  PROPOSAL_ID,
  RELAY_WORKFLOW_REF,
  canonical,
} from '../src/worker.mjs';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

class FakeObject {
  constructor(text) { this.textValue = text; }
  async text() { return this.textValue; }
}

class FakeBucket {
  constructor() { this.values = new Map(); }
  async get(key) { return this.values.has(key) ? new FakeObject(this.values.get(key)) : null; }
  async put(key, value, options = {}) {
    if (options.onlyIf?.etagDoesNotMatch === '*' && this.values.has(key)) return null;
    this.values.set(key, typeof value === 'string' ? value : new TextDecoder().decode(value));
    return { etag: `etag-${key}` };
  }
  async list({ prefix = '', limit = 1000 } = {}) {
    const objects = [...this.values.keys()].filter(key => key.startsWith(prefix)).sort().slice(0, limit).map(key => ({ key }));
    return { objects, truncated: false };
  }
}

const bucket = () => new FakeBucket();
const envFor = proposals => ({
  APP_VERSION: 'test',
  PROPOSALS: proposals,
  ASSETS: { fetch: async () => new Response('<!doctype html><title>test</title>', { headers: { 'content-type': 'text/html' } }) },
});

function proposalRequest(value = FIXED_PROPOSAL) {
  return new Request('https://proof.example/api/proposals', {
    method: 'POST',
    headers: { origin: 'https://proof.example', 'content-type': 'application/json' },
    body: JSON.stringify(value),
  });
}

async function value(response) { return response.json(); }

async function relayToken() {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  publicJwk.kid = 'test-key';
  publicJwk.use = 'sig';
  publicJwk.alg = 'RS256';
  const encode = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: 'RS256', typ: 'JWT', kid: 'test-key' });
  const payload = encode({
    iss: 'https://token.actions.githubusercontent.com',
    aud: OIDC_AUDIENCE,
    iat: now - 30,
    nbf: now - 30,
    exp: now + 300,
    repository: 'roccho-dev/adrs',
    repository_owner: 'roccho-dev',
    ref: 'refs/heads/proposals',
    workflow_ref: RELAY_WORKFLOW_REF,
    event_name: 'push',
  });
  const input = `${header}.${payload}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(input));
  const token = `${input}.${Buffer.from(signature).toString('base64url')}`;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (String(url).endsWith('/.well-known/openid-configuration')) {
      return Response.json({ jwks_uri: 'https://oidc.example/jwks' });
    }
    if (String(url) === 'https://oidc.example/jwks') return Response.json({ keys: [publicJwk] });
    return originalFetch(url);
  };
  return { token, restore: () => { globalThis.fetch = originalFetch; } };
}

test('same-origin proposal appends once and duplicate is idempotent', async () => {
  const proposals = bucket();
  const env = envFor(proposals);
  const first = await worker.fetch(proposalRequest(), env);
  assert.equal(first.status, 201);
  const one = await value(first);
  assert.equal(one.status, 'PASS');
  assert.equal(one.duplicate, false);
  assert.equal(one.state, 'submitted');

  const second = await worker.fetch(proposalRequest(), env);
  assert.equal(second.status, 200);
  assert.equal((await value(second)).duplicate, true);
  assert.equal([...proposals.values.keys()].filter(key => key.startsWith('proposals/')).length, 1);
});

test('cross-origin and arbitrary proposal meaning fail closed', async () => {
  const proposals = bucket();
  const env = envFor(proposals);
  const cross = new Request('https://proof.example/api/proposals', {
    method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: JSON.stringify(FIXED_PROPOSAL),
  });
  assert.equal((await worker.fetch(cross, env)).status, 400);
  const altered = structuredClone(FIXED_PROPOSAL);
  altered.reason = 'different meaning';
  assert.equal((await worker.fetch(proposalRequest(altered), env)).status, 400);
  assert.equal(proposals.values.size, 0);
});

test('ADRS-owned OIDC relay reads pending and acknowledges exact comment', async () => {
  const proposals = bucket();
  const env = envFor(proposals);
  assert.equal((await worker.fetch(proposalRequest(), env)).status, 201);
  const signed = await relayToken();
  try {
    const pendingResponse = await worker.fetch(new Request('https://proof.example/api/relay/pending', {
      headers: { authorization: `Bearer ${signed.token}` },
    }), env);
    assert.equal(pendingResponse.status, 200);
    const pending = await value(pendingResponse);
    assert.equal(pending.items.length, 1);
    assert.equal(pending.items[0].proposal_id, PROPOSAL_ID);
    assert.match(pending.items[0].comment_body, /adrs\.uiProposal\.canary\.v2/);

    const ack = {
      schema: 'adrs.uiProposalRelayAck.v1',
      proposal_id: PROPOSAL_ID,
      proposal_digest: pending.items[0].proposal_digest,
      comment_body_sha256: pending.items[0].comment_body_sha256,
      comment_id: 123456,
      comment_url: 'https://github.com/roccho-dev/adrs/issues/318#issuecomment-123456',
      exact_comment_readback: true,
    };
    const ackResponse = await worker.fetch(new Request('https://proof.example/api/relay/ack', {
      method: 'POST',
      headers: { authorization: `Bearer ${signed.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(ack),
    }), env);
    assert.equal(ackResponse.status, 201);
    assert.equal((await value(ackResponse)).duplicate, false);

    const status = await value(await worker.fetch(new Request(`https://proof.example/api/proposals/${PROPOSAL_ID}`), env));
    assert.equal(status.state, 'recorded');
    assert.equal(status.comment_id, 123456);

    const duplicate = await worker.fetch(new Request('https://proof.example/api/relay/ack', {
      method: 'POST', headers: { authorization: `Bearer ${signed.token}`, 'content-type': 'application/json' }, body: canonical(ack),
    }), env);
    assert.equal(duplicate.status, 200);
    assert.equal((await value(duplicate)).duplicate, true);
  } finally {
    signed.restore();
  }
});

test('relay rejects unsigned or wrong-workflow tokens', async () => {
  const proposals = bucket();
  const env = envFor(proposals);
  const response = await worker.fetch(new Request('https://proof.example/api/relay/pending', {
    headers: { authorization: 'Bearer invalid' },
  }), env);
  assert.equal(response.status, 401);
  assert.equal((await value(response)).code, 'RELAY_AUTH_DENIED');
});
