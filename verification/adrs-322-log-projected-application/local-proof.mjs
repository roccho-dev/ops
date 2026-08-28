#!/usr/bin/env node
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import worker from './src/worker.mjs';
import { REQUEST_SCHEMA, baseEvent, canonical, projectSurface } from './src/kernel.mjs';

class FakeR2Object {
  constructor(key, text, metadata = {}) {
    this.key = key;
    this.textValue = text;
    this.size = new TextEncoder().encode(text).length;
    this.etag = `etag-${this.size}-${key.length}`;
    this.uploaded = new Date('2026-08-28T00:00:00Z');
    this.customMetadata = metadata.customMetadata ?? {};
  }
  async text() { return this.textValue; }
}

class FakeR2 {
  constructor({ reverseList = false } = {}) { this.map = new Map(); this.reverseList = reverseList; }
  async put(key, value, options = {}) {
    if (options.onlyIf?.etagDoesNotMatch === '*' && this.map.has(key)) return null;
    const object = new FakeR2Object(key, String(value), options);
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

const assets = { async fetch() { return new Response('asset', { status: 200 }); } };
const env = (bucket) => ({ OBSERVATIONS: bucket, ASSETS: assets, APP_VERSION: 'local-proof', WORKER_NAME: 'local-proof' });
const requestBody = (subject, requestId = 'continue-001', action = 'continue', extra = {}) => ({
  schema: REQUEST_SCHEMA,
  request_id: requestId,
  subject_id: subject,
  profile_id: 'external',
  action_id: action,
  ...extra,
});

async function call(bucket, path, init) {
  const response = await worker.fetch(new Request(`https://proof.test${path}`, init), env(bucket));
  return { response, value: await response.json() };
}

async function post(bucket, body, raw = false) {
  return call(bucket, '/api/observations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ? body : JSON.stringify(body),
  });
}

const checks = [];
function pass(id) { checks.push({ id, status: 'PASS' }); }

const internalSubject = 'proof-internal-release';
const externalSubject = 'proof-external-local';
const bucket = new FakeR2({ reverseList: true });

const internal = await projectSurface({ profileId: 'internal', subjectId: internalSubject, events: [baseEvent('internal', internalSubject)], appVersion: 'local-proof' });
const before = await projectSurface({ profileId: 'external', subjectId: externalSubject, events: [baseEvent('external', externalSubject)], appVersion: 'local-proof' });
assert.equal(internal.kernel_digest, before.kernel_digest); pass('same-kernel-two-profiles');
assert.equal(before.state_id, 'available'); assert.deepEqual(before.permitted_actions.map((a) => a.action_id), ['continue']); pass('external-before');

let result = await post(bucket, requestBody(externalSubject));
assert.equal(result.response.status, 201); assert.equal(result.value.duplicate, false); pass('append-one');
const observationKey = result.value.object_key;
const storedText = (await bucket.get(observationKey)).textValue;
assert.equal(result.value.object_sha256.startsWith('sha256:'), true); pass('r2-byte-readback');

const afterResponse = await call(bucket, `/api/surface?profile_id=external&subject_id=${externalSubject}`);
assert.equal(afterResponse.response.status, 200); assert.equal(afterResponse.value.state_id, 'continued'); assert.notEqual(afterResponse.value.surface_digest, before.surface_digest); pass('next-surface');
assert.equal(afterResponse.value.kernel_digest, internal.kernel_digest); pass('kernel-stable-after');

result = await post(bucket, requestBody(externalSubject));
assert.equal(result.response.status, 200); assert.equal(result.value.duplicate, true); assert.equal(bucket.map.size, 1); pass('idempotent-duplicate');

result = await post(bucket, requestBody(externalSubject, 'continue-001', 'other-action'));
assert.equal(result.response.status, 409); assert.equal(result.value.code, 'IDEMPOTENCY_CONFLICT'); pass('idempotency-conflict');

result = await post(bucket, requestBody('proof-external-other', 'other-001', 'unknown-action'));
assert.equal(result.response.status, 409); assert.equal(result.value.code, 'ACTION_NOT_PERMITTED'); pass('unknown-action');

result = await post(bucket, requestBody('proof-external-other', 'other-002', 'continue', { email: 'private@example.invalid' }));
assert.equal(result.response.status, 400); assert.equal(result.value.code, 'INVALID_REQUEST'); pass('closed-request-no-pii');

result = await post(bucket, '{bad json', true);
assert.equal(result.response.status, 400); pass('malformed-json');

result = await call(bucket, '/api/surface?profile_id=unknown&subject_id=proof-external-other');
assert.equal(result.response.status, 400); pass('unknown-profile');

result = await call(bucket, '/api/surface?profile_id=external&subject_id=user@example.invalid');
assert.equal(result.response.status, 400); pass('opaque-subject-only');

const internalAfter = await call(bucket, `/api/surface?profile_id=internal&subject_id=${internalSubject}`);
assert.equal(internalAfter.value.surface_digest, internal.surface_digest); pass('subject-isolation');

const evidence = await call(bucket, `/api/evidence?subject_id=${externalSubject}`);
assert.equal(evidence.value.object_count, 1); assert.equal(evidence.value.projection_object_count, 0); pass('events-only-no-current-store');

const replayBucket = new FakeR2({ reverseList: false });
await replayBucket.put(observationKey, storedText);
const replay = await call(replayBucket, `/api/surface?profile_id=external&subject_id=${externalSubject}`);
assert.equal(replay.value.surface_digest, afterResponse.value.surface_digest); assert.equal(replay.value.state_digest, afterResponse.value.state_digest); pass('projection-delete-replay');

const reordered = await call(bucket, `/api/surface?profile_id=external&subject_id=${externalSubject}`);
assert.equal(reordered.value.surface_digest, replay.value.surface_digest); pass('list-order-independent');

const receipt = {
  schema: 'ops.logProjectedApplicationLocalProof/1',
  status: 'PASS',
  claim_ceiling: 'BOUNDED_PROVIDER_PROOF',
  authority: false,
  checks,
  check_count: checks.length,
  kernel_id: internal.kernel_id,
  kernel_digest: internal.kernel_digest,
  semantic_bundle_digest: internal.semantic_bundle_digest,
  internal_surface_digest: internal.surface_digest,
  external_before_surface_digest: before.surface_digest,
  external_after_surface_digest: afterResponse.value.surface_digest,
  replay_surface_digest: replay.value.surface_digest,
  observation_object_count: bucket.map.size,
  current_projection_object_count: evidence.value.projection_object_count,
  persisted_current_state: false,
  production_cutover: false,
};
const output = process.argv[2];
if (output) await writeFile(output, canonical(receipt), 'utf8');
process.stdout.write(canonical(receipt));
