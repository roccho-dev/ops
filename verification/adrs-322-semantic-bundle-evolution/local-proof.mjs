#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from './src/worker.mjs';
import {
  KERNEL_ID,
  baseEvent,
  canonical,
  projectSurface,
  sha256,
  validateEvent,
  validateSemanticBundle,
} from '../adrs-322-log-projected-application/src/kernel.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(root, 'fixtures');
const publicDir = resolve(root, 'public');

class FakeR2Object {
  constructor(key, text, version, options = {}) {
    this.key = key;
    this.textValue = text;
    this.size = new TextEncoder().encode(text).length;
    this.etag = `etag-${version}-${createHash('sha256').update(text).digest('hex').slice(0, 16)}`;
    this.uploaded = new Date(`2026-08-28T00:00:${String(version).padStart(2, '0')}.000Z`);
    this.customMetadata = options.customMetadata ?? {};
  }
  async text() { return this.textValue; }
}

class FakeR2 {
  constructor({ reverseList = false } = {}) {
    this.map = new Map();
    this.version = 0;
    this.reverseList = reverseList;
  }
  async put(key, value, options = {}) {
    const existing = this.map.get(key) ?? null;
    const onlyIf = options.onlyIf ?? {};
    if (onlyIf.etagDoesNotMatch === '*' && existing) return null;
    if (onlyIf.etagMatches !== undefined && (!existing || existing.etag !== onlyIf.etagMatches)) return null;
    this.version += 1;
    const object = new FakeR2Object(key, String(value), this.version, options);
    this.map.set(key, object);
    return object;
  }
  async get(key) { return this.map.get(key) ?? null; }
  async list({ prefix = '', limit = 1000 } = {}) {
    let objects = [...this.map.values()].filter((object) => object.key.startsWith(prefix));
    objects.sort((a, b) => a.key.localeCompare(b.key));
    if (this.reverseList) objects.reverse();
    return { objects: objects.slice(0, limit), truncated: objects.length > limit };
  }
}

function digestHex(text) { return createHash('sha256').update(text).digest('hex'); }
function assetBundleDigest(entries) {
  return digestHex(`${JSON.stringify(Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))))}\n`);
}

async function fixture(name) {
  const text = await readFile(resolve(fixtures, name), 'utf8');
  const value = JSON.parse(text);
  assert.equal(text, canonical(value));
  return { text, value, digest: await sha256(text) };
}

async function call(env, path, init) {
  const response = await worker.fetch(new Request(`https://proof.test${path}`, init), env);
  return { response, value: await response.json() };
}
async function select(env, requestId, expected, next, extra = {}) {
  return call(env, '/api/evolution/select', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      schema: 'adrs322.semanticBundleSelectionRequest/1',
      request_id: requestId,
      proof_id: env.PROOF_ID,
      expected_bundle_digest: expected,
      next_bundle_digest: next,
      ...extra,
    }),
  });
}

const event = await fixture('event.json');
const v1 = await fixture('bundle-v1.json');
const v2 = await fixture('bundle-v2.json');
validateEvent(event.value);
validateSemanticBundle(v1.value);
validateSemanticBundle(v2.value);
assert.notEqual(v1.digest, v2.digest);

const assetHashes = {};
for (const name of ['app.js', 'index.html', 'styles.css']) {
  assetHashes[name] = digestHex(await readFile(resolve(publicDir, name)));
}
const staticBundleDigest = assetBundleDigest(assetHashes);

const proofId = 'proof-semantic-local';
const env = {
  OBSERVATIONS: new FakeR2({ reverseList: true }),
  ASSETS: { async fetch() { return new Response('asset'); } },
  APP_VERSION: 'local-proof',
  WORKER_NAME: 'local-proof',
  PROOF_ID: proofId,
  EVENT_DIGEST: event.digest,
  BUNDLE_V1_DIGEST: v1.digest,
  BUNDLE_V2_DIGEST: v2.digest,
};
const prefix = `semantic-evolution/${proofId}`;
await env.OBSERVATIONS.put(`${prefix}/events/base.json`, event.text, { onlyIf: { etagDoesNotMatch: '*' } });
await env.OBSERVATIONS.put(`${prefix}/bundles/${v1.digest.slice(7)}.json`, v1.text, { onlyIf: { etagDoesNotMatch: '*' } });
await env.OBSERVATIONS.put(`${prefix}/bundles/${v2.digest.slice(7)}.json`, v2.text, { onlyIf: { etagDoesNotMatch: '*' } });
const eventBytesBefore = (await env.OBSERVATIONS.get(`${prefix}/events/base.json`)).textValue;

const checks = [];
function pass(id) { checks.push({ id, status: 'PASS' }); }

const legacyInternal = await projectSurface({
  profileId: 'internal',
  subjectId: 'proof-internal-release',
  events: [baseEvent('internal', 'proof-internal-release')],
  appVersion: 'local-proof',
});
assert.equal(legacyInternal.kernel_digest, 'sha256:8964251f98c7911bab0a0e101426f67173671e589b018d0a3c591fa2a5db71ab');
pass('backward-compatible-existing-kernel');

let result = await call(env, '/api/evolution/surface');
assert.equal(result.response.status, 400);
assert.equal(result.value.code, 'INVALID_INPUT');
pass('current-missing-fails-closed');

result = await select(env, 'select-v1', 'none', v1.digest);
assert.equal(result.response.status, 201);
assert.equal(result.value.current_bundle_digest, v1.digest);
pass('select-v1-from-none');

const firstV1 = await call(env, '/api/evolution/surface');
assert.equal(firstV1.response.status, 200);
assert.equal(firstV1.value.semantic_bundle_id, 'semantic-evolution/1');
assert.equal(firstV1.value.permitted_actions.length, 1);
assert.equal(firstV1.value.event_object_digest, event.digest);
pass('surface-v1');

result = await select(env, 'select-v2', v1.digest, v2.digest);
assert.equal(result.response.status, 201);
pass('cas-v1-to-v2');

const currentV2 = await call(env, '/api/evolution/surface');
assert.equal(currentV2.response.status, 200);
assert.equal(currentV2.value.semantic_bundle_id, 'semantic-evolution/2');
assert.equal(currentV2.value.permitted_actions.length, 2);
assert.equal(currentV2.value.state_digest, firstV1.value.state_digest);
assert.equal(currentV2.value.event_object_digest, firstV1.value.event_object_digest);
assert.notEqual(currentV2.value.surface_digest, firstV1.value.surface_digest);
assert.equal(currentV2.value.app_version, firstV1.value.app_version);
pass('same-log-different-bundle-surface');

const exactV1 = await call(env, `/api/evolution/surface?bundle_digest=${encodeURIComponent(v1.digest)}`);
assert.equal(exactV1.response.status, 200);
assert.equal(exactV1.value.surface_digest, firstV1.value.surface_digest);
assert.equal(exactV1.value.selection_mode, 'exact');
pass('historical-v1-exact-replay');

result = await call(env, `/api/evolution/surface?bundle_digest=${encodeURIComponent(`sha256:${'f'.repeat(64)}`)}`);
assert.equal(result.response.status, 400);
assert.equal(result.value.code, 'UNADMITTED_BUNDLE');
pass('unknown-bundle-read-rejected');

result = await select(env, 'stale-select', v1.digest, v1.digest);
assert.equal(result.response.status, 409);
assert.equal(result.value.code, 'STALE_EXPECTED_CURRENT');
pass('stale-writer-rejected');

result = await select(env, 'duplicate-v2', v2.digest, v2.digest);
assert.equal(result.response.status, 200);
assert.equal(result.value.duplicate, true);
pass('same-selection-idempotent');

result = await select(env, 'unknown-next', v2.digest, `sha256:${'e'.repeat(64)}`);
assert.equal(result.response.status, 400);
assert.equal(result.value.code, 'INVALID_SELECTION_REQUEST');
pass('unadmitted-next-rejected');

result = await select(env, 'pii-extra', v2.digest, v1.digest, { email: 'private@example.invalid' });
assert.equal(result.response.status, 400);
assert.equal(result.value.code, 'INVALID_SELECTION_REQUEST');
pass('closed-request-rejects-pii-shape');

result = await select(env, 'rollback-v1', v2.digest, v1.digest);
assert.equal(result.response.status, 201);
pass('rollback-v2-to-v1');

const rolledBack = await call(env, '/api/evolution/surface');
assert.equal(rolledBack.response.status, 200);
assert.equal(rolledBack.value.surface_digest, firstV1.value.surface_digest);
assert.equal(rolledBack.value.semantic_bundle_id, 'semantic-evolution/1');
assert.equal(rolledBack.value.app_version, firstV1.value.app_version);
pass('rollback-exact-surface');

const eventBytesAfter = (await env.OBSERVATIONS.get(`${prefix}/events/base.json`)).textValue;
assert.equal(eventBytesAfter, eventBytesBefore);
assert.equal(await sha256(eventBytesAfter), event.digest);
pass('event-bytes-never-changed');

const evidence = await call(env, '/api/evolution/evidence');
assert.equal(evidence.response.status, 200);
assert.equal(evidence.value.immutable_event_objects, 1);
assert.equal(evidence.value.immutable_bundle_objects, 2);
assert.equal(evidence.value.selection_pointer_objects, 1);
assert.equal(evidence.value.relationship_current_state_objects, 0);
assert.deepEqual(evidence.value.admitted_bundle_digests, [v1.digest, v2.digest]);
pass('events-bundles-pointer-only');

const missingBundleEnv = { ...env, OBSERVATIONS: new FakeR2(), PROOF_ID: 'proof-semantic-missing' };
const missingPrefix = `semantic-evolution/${missingBundleEnv.PROOF_ID}`;
await missingBundleEnv.OBSERVATIONS.put(`${missingPrefix}/events/base.json`, event.text);
await missingBundleEnv.OBSERVATIONS.put(`${missingPrefix}/bundles/${v1.digest.slice(7)}.json`, v1.text);
result = await select(missingBundleEnv, 'missing-v2', 'none', v2.digest);
assert.equal(result.response.status, 409);
assert.equal(result.value.code, 'SELECTION_UNAVAILABLE');
pass('missing-bundle-selection-fails');

const malformedEnv = { ...env, OBSERVATIONS: new FakeR2(), PROOF_ID: 'proof-semantic-malformed' };
const malformedPrefix = `semantic-evolution/${malformedEnv.PROOF_ID}`;
await malformedEnv.OBSERVATIONS.put(`${malformedPrefix}/events/base.json`, event.text);
await malformedEnv.OBSERVATIONS.put(`${malformedPrefix}/bundles/${v1.digest.slice(7)}.json`, canonical({ schema: 'wrong', bundle_id: 'semantic-evolution/1', profiles: {} }));
await malformedEnv.OBSERVATIONS.put(`${malformedPrefix}/bundles/${v2.digest.slice(7)}.json`, v2.text);
result = await select(malformedEnv, 'malformed-v1', 'none', v1.digest);
assert.equal(result.response.status, 409);
assert.equal(result.value.code, 'SELECTION_UNAVAILABLE');
pass('malformed-bundle-fails');

const receipt = {
  schema: 'ops.semanticBundleEvolutionLocalProof/1',
  status: 'PASS',
  claim_ceiling: 'BOUNDED_PROVIDER_PROOF',
  authority: false,
  kernel_id: KERNEL_ID,
  checks,
  check_count: checks.length,
  event_digest: event.digest,
  bundle_v1_digest: v1.digest,
  bundle_v2_digest: v2.digest,
  static_asset_sha256: assetHashes,
  static_asset_bundle_sha256: staticBundleDigest,
  v1_surface_digest: firstV1.value.surface_digest,
  v2_surface_digest: currentV2.value.surface_digest,
  rollback_surface_digest: rolledBack.value.surface_digest,
  event_state_digest: firstV1.value.state_digest,
  app_version_stable: true,
  relationship_current_state_objects: 0,
  accepted_meaning_authority: false,
  production_cutover: false,
};
const output = process.argv[2];
if (output) await writeFile(output, canonical(receipt), 'utf8');
process.stdout.write(canonical(receipt));
