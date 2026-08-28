import {
  CLAIM_CEILING,
  KERNEL_ID,
  canonical,
  projectSurfaceWithBundle,
  sha256,
  validateEvent,
  validateRequestId,
  validateSemanticBundle,
} from '../../adrs-322-log-projected-application/src/kernel.mjs';

const SELECTION_REQUEST_SCHEMA = 'adrs322.semanticBundleSelectionRequest/1';
const POINTER_SCHEMA = 'adrs322.semanticBundlePointer/1';
const MAX_BODY_BYTES = 4096;
const PROOF_ID_RE = /^proof-semantic-[a-z0-9](?:[a-z0-9-]{0,90}[a-z0-9])?$/;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/;

function stableObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function json(value, status = 200, headers = {}) {
  return new Response(canonical(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });
}

function error(status, code, message) {
  return json({ schema: 'adrs322.semanticEvolutionError/1', status: 'ERROR', code, message, authority: false }, status);
}

function assertClosedKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${label}: unknown field ${key}`);
  }
}

function validateDigest(value, label) {
  if (typeof value !== 'string' || !DIGEST_RE.test(value)) throw new TypeError(`${label}: invalid digest`);
  return value;
}

function validateProofId(value) {
  if (typeof value !== 'string' || !PROOF_ID_RE.test(value)) throw new TypeError('proof_id: invalid');
  return value;
}

function allowedDigests(env) {
  return new Set([
    validateDigest(env.BUNDLE_V1_DIGEST, 'BUNDLE_V1_DIGEST'),
    validateDigest(env.BUNDLE_V2_DIGEST, 'BUNDLE_V2_DIGEST'),
  ]);
}

function root(env) {
  return `semantic-evolution/${validateProofId(env.PROOF_ID)}`;
}

function digestSuffix(digest) {
  return validateDigest(digest, 'digest').slice('sha256:'.length);
}

function eventKey(env) {
  return `${root(env)}/events/base.json`;
}

function bundleKey(env, digest) {
  return `${root(env)}/bundles/${digestSuffix(digest)}.json`;
}

function pointerKey(env) {
  return `${root(env)}/current.json`;
}

async function readCanonicalObject(bucket, key) {
  const object = await bucket.get(key);
  if (!object) return null;
  const text = await object.text();
  const value = JSON.parse(text);
  if (text !== canonical(value)) throw new TypeError(`object not canonical: ${key}`);
  return { object, text, value, digest: await sha256(text) };
}

async function readEvent(env) {
  const stored = await readCanonicalObject(env.OBSERVATIONS, eventKey(env));
  if (!stored) throw new TypeError('base event missing');
  const event = validateEvent(stored.value);
  if (stored.digest !== validateDigest(env.EVENT_DIGEST, 'EVENT_DIGEST')) throw new TypeError('base event digest mismatch');
  if (event.profile_id !== 'external') throw new TypeError('base event profile mismatch');
  return { ...stored, event };
}

async function readBundle(env, digest) {
  const accepted = allowedDigests(env);
  if (!accepted.has(digest)) throw new TypeError('bundle not admitted');
  const stored = await readCanonicalObject(env.OBSERVATIONS, bundleKey(env, digest));
  if (!stored) throw new TypeError('bundle missing');
  if (stored.digest !== digest) throw new TypeError('bundle digest/key mismatch');
  return { ...stored, bundle: validateSemanticBundle(stored.value) };
}

function validatePointer(value, env) {
  if (!stableObject(value)) throw new TypeError('pointer: object required');
  assertClosedKeys(value, new Set(['schema', 'proof_id', 'bundle_digest', 'selection_id', 'authority', 'accepted_meaning_authority']), 'pointer');
  if (value.schema !== POINTER_SCHEMA) throw new TypeError('pointer: schema mismatch');
  if (value.proof_id !== env.PROOF_ID) throw new TypeError('pointer: proof mismatch');
  if (!allowedDigests(env).has(value.bundle_digest)) throw new TypeError('pointer: bundle not admitted');
  validateRequestId(value.selection_id);
  if (value.authority !== false || value.accepted_meaning_authority !== false) throw new TypeError('pointer: authority boundary mismatch');
  return value;
}

async function readPointer(env) {
  const stored = await readCanonicalObject(env.OBSERVATIONS, pointerKey(env));
  if (!stored) return null;
  return { ...stored, pointer: validatePointer(stored.value, env) };
}

async function parseBody(request) {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_BODY_BYTES) throw new TypeError('request body too large');
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw new TypeError('request body too large');
  return JSON.parse(text);
}

function validateSelectionRequest(value, env) {
  if (!stableObject(value)) throw new TypeError('selection request: object required');
  assertClosedKeys(value, new Set(['schema', 'request_id', 'proof_id', 'expected_bundle_digest', 'next_bundle_digest']), 'selection request');
  if (value.schema !== SELECTION_REQUEST_SCHEMA) throw new TypeError('selection request: schema mismatch');
  validateRequestId(value.request_id);
  if (value.proof_id !== env.PROOF_ID) throw new TypeError('selection request: proof mismatch');
  if (value.expected_bundle_digest !== 'none') validateDigest(value.expected_bundle_digest, 'expected_bundle_digest');
  validateDigest(value.next_bundle_digest, 'next_bundle_digest');
  if (!allowedDigests(env).has(value.next_bundle_digest)) throw new TypeError('selection request: next bundle not admitted');
  if (value.expected_bundle_digest !== 'none' && !allowedDigests(env).has(value.expected_bundle_digest)) throw new TypeError('selection request: expected bundle not admitted');
  return value;
}

async function currentSurface(env, exactDigest = null) {
  const event = await readEvent(env);
  let digest = exactDigest;
  let pointer = null;
  let selectionMode = 'exact';
  if (digest === null) {
    pointer = await readPointer(env);
    if (!pointer) throw new TypeError('current bundle pointer missing');
    digest = pointer.pointer.bundle_digest;
    selectionMode = 'current';
  }
  const bundle = await readBundle(env, digest);
  const surface = await projectSurfaceWithBundle({
    profileId: 'external',
    subjectId: event.event.subject_id,
    events: [event.event],
    semanticBundle: bundle.bundle,
    appVersion: env.APP_VERSION ?? 'unbound',
  });
  return {
    ...surface,
    schema: 'adrs322.semanticBundleEvolutionSurface/1',
    proof_id: env.PROOF_ID,
    selection_mode: selectionMode,
    event_object_key: eventKey(env),
    event_object_digest: event.digest,
    bundle_object_key: bundleKey(env, digest),
    bundle_object_digest: bundle.digest,
    pointer_object_key: selectionMode === 'current' ? pointerKey(env) : null,
    pointer_digest: pointer?.digest ?? null,
    pointer_authority: false,
    accepted_meaning_authority: false,
  };
}

async function handleSelect(request, env) {
  let input;
  try {
    input = validateSelectionRequest(await parseBody(request), env);
  } catch (cause) {
    return error(400, 'INVALID_SELECTION_REQUEST', cause instanceof Error ? cause.message : String(cause));
  }

  try {
    await readBundle(env, input.next_bundle_digest);
    const current = await readPointer(env);
    const currentDigest = current?.pointer.bundle_digest ?? 'none';
    if (current && current.pointer.selection_id === input.request_id && currentDigest === input.next_bundle_digest) {
      return json({
        schema: 'adrs322.semanticBundleSelectionResult/1',
        status: 'PASS',
        duplicate: true,
        proof_id: env.PROOF_ID,
        prior_bundle_digest: input.expected_bundle_digest,
        current_bundle_digest: currentDigest,
        pointer_digest: current.digest,
        pointer_authority: false,
        accepted_meaning_authority: false,
      });
    }
    if (input.expected_bundle_digest !== currentDigest) {
      return error(409, 'STALE_EXPECTED_CURRENT', `expected ${input.expected_bundle_digest}, observed ${currentDigest}`);
    }
    if (currentDigest === input.next_bundle_digest) {
      return json({
        schema: 'adrs322.semanticBundleSelectionResult/1',
        status: 'PASS',
        duplicate: true,
        proof_id: env.PROOF_ID,
        prior_bundle_digest: currentDigest,
        current_bundle_digest: currentDigest,
        pointer_digest: current.digest,
        pointer_authority: false,
        accepted_meaning_authority: false,
      });
    }

    const pointer = {
      schema: POINTER_SCHEMA,
      proof_id: env.PROOF_ID,
      bundle_digest: input.next_bundle_digest,
      selection_id: input.request_id,
      authority: false,
      accepted_meaning_authority: false,
    };
    const bytes = canonical(pointer);
    const putOptions = current
      ? { onlyIf: { etagMatches: current.object.etag } }
      : { onlyIf: { etagDoesNotMatch: '*' } };
    const stored = await env.OBSERVATIONS.put(pointerKey(env), bytes, {
      ...putOptions,
      httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'no-store' },
      customMetadata: { schema: POINTER_SCHEMA, proof_id: env.PROOF_ID, bundle_digest: input.next_bundle_digest },
    });
    if (!stored) return error(409, 'CONCURRENT_POINTER_WRITE', 'conditional pointer write rejected');
    const readback = await readPointer(env);
    if (!readback || readback.text !== bytes) return error(500, 'POINTER_READBACK_MISMATCH', 'pointer readback mismatch');
    return json({
      schema: 'adrs322.semanticBundleSelectionResult/1',
      status: 'PASS',
      duplicate: false,
      proof_id: env.PROOF_ID,
      prior_bundle_digest: currentDigest,
      current_bundle_digest: input.next_bundle_digest,
      pointer_digest: readback.digest,
      pointer_authority: false,
      accepted_meaning_authority: false,
    }, 201);
  } catch (cause) {
    return error(409, 'SELECTION_UNAVAILABLE', cause instanceof Error ? cause.message : String(cause));
  }
}

async function handleEvidence(env) {
  const prefix = `${root(env)}/`;
  const listed = await env.OBSERVATIONS.list({ prefix, limit: 20 });
  if (listed.truncated) return error(409, 'PREFIX_TOO_LARGE', 'proof prefix unexpectedly truncated');
  const event = await readEvent(env);
  const v1 = await readBundle(env, env.BUNDLE_V1_DIGEST);
  const v2 = await readBundle(env, env.BUNDLE_V2_DIGEST);
  const pointer = await readPointer(env);
  const objects = [...listed.objects].sort((a, b) => a.key.localeCompare(b.key)).map((object) => ({
    key: object.key,
    etag: object.etag,
    size: object.size,
    uploaded: object.uploaded?.toISOString?.() ?? null,
  }));
  return json({
    schema: 'adrs322.semanticBundleEvolutionEvidence/1',
    status: 'PASS',
    proof_id: env.PROOF_ID,
    app_version: env.APP_VERSION ?? 'unbound',
    kernel_id: KERNEL_ID,
    event_object_key: eventKey(env),
    event_object_digest: event.digest,
    admitted_bundle_digests: [v1.digest, v2.digest],
    current_bundle_digest: pointer?.pointer.bundle_digest ?? null,
    pointer_digest: pointer?.digest ?? null,
    object_count: objects.length,
    objects,
    immutable_event_objects: objects.filter((object) => object.key.includes('/events/')).length,
    immutable_bundle_objects: objects.filter((object) => object.key.includes('/bundles/')).length,
    selection_pointer_objects: objects.filter((object) => object.key.endsWith('/current.json')).length,
    relationship_current_state_objects: 0,
    pointer_authority: false,
    accepted_meaning_authority: false,
    claim_ceiling: CLAIM_CEILING,
    authority: false,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === 'GET' && url.pathname === '/api/meta') {
        return json({
          schema: 'adrs322.semanticBundleEvolutionMeta/1',
          status: 'PASS',
          app_version: env.APP_VERSION ?? 'unbound',
          worker_name: env.WORKER_NAME ?? 'unbound',
          proof_id: env.PROOF_ID,
          kernel_id: KERNEL_ID,
          event_digest: env.EVENT_DIGEST,
          admitted_bundle_digests: [env.BUNDLE_V1_DIGEST, env.BUNDLE_V2_DIGEST],
          current_selection_store: 'R2 pointer; non-authority',
          current_relationship_state_store: false,
          accepted_meaning_authority: false,
          production_cutover: false,
          authority: false,
        });
      }
      if (request.method === 'GET' && url.pathname === '/api/evolution/surface') {
        const exact = url.searchParams.get('bundle_digest');
        if (exact !== null && !allowedDigests(env).has(exact)) return error(400, 'UNADMITTED_BUNDLE', 'bundle digest is not admitted');
        return json(await currentSurface(env, exact));
      }
      if (request.method === 'POST' && url.pathname === '/api/evolution/select') return handleSelect(request, env);
      if (request.method === 'GET' && url.pathname === '/api/evolution/evidence') return handleEvidence(env);
      if (url.pathname.startsWith('/api/')) return error(404, 'NOT_FOUND', 'unknown API route');
      if (request.method !== 'GET' && request.method !== 'HEAD') return error(405, 'METHOD_NOT_ALLOWED', 'method not allowed');
      return env.ASSETS.fetch(request);
    } catch (cause) {
      return error(400, 'INVALID_INPUT', cause instanceof Error ? cause.message : String(cause));
    }
  },
};

export { bundleKey, currentSurface, eventKey, pointerKey, readBundle, readEvent, readPointer, root };
