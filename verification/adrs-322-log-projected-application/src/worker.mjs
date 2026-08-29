import {
  CLAIM_CEILING,
  baseEvent,
  canonical,
  findPermittedAction,
  observationFromRequest,
  projectSurface,
  requestFingerprint,
  sha256,
  validateActionRequest,
  validateRequestId,
  validateSubjectId,
} from './kernel.mjs';

const MAX_BODY_BYTES = 4096;
const MAX_EVENTS = 100;

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
  return json({ schema: 'adrs322.error/1', status: 'ERROR', code, message, authority: false }, status);
}

function eventKey(subjectId, requestId) {
  return `events/${subjectId}/${requestId}.json`;
}

async function readStoredEvent(bucket, key) {
  const object = await bucket.get(key);
  if (!object) return null;
  const text = await object.text();
  return { object, text, event: JSON.parse(text) };
}

async function listStoredEvents(bucket, subjectId) {
  const prefix = `events/${subjectId}/`;
  const listed = await bucket.list({ prefix, limit: MAX_EVENTS + 1 });
  if (listed.truncated || listed.objects.length > MAX_EVENTS) throw new TypeError('event limit exceeded');
  const events = [];
  for (const metadata of listed.objects) {
    const stored = await readStoredEvent(bucket, metadata.key);
    if (!stored) throw new TypeError(`listed object missing: ${metadata.key}`);
    events.push(stored.event);
  }
  return events;
}

async function surface(env, profileId, subjectId) {
  const stored = profileId === 'external' ? await listStoredEvents(env.OBSERVATIONS, subjectId) : [];
  return projectSurface({
    profileId,
    subjectId,
    events: [baseEvent(profileId, subjectId), ...stored],
    appVersion: env.APP_VERSION ?? 'unbound',
  });
}

async function parseBody(request) {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_BODY_BYTES) throw new TypeError('request body too large');
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw new TypeError('request body too large');
  return JSON.parse(text);
}

async function handleObservation(request, env) {
  let input;
  try {
    input = validateActionRequest(await parseBody(request));
  } catch (cause) {
    return error(400, 'INVALID_REQUEST', cause instanceof Error ? cause.message : String(cause));
  }

  const key = eventKey(input.subject_id, input.request_id);
  const existing = await readStoredEvent(env.OBSERVATIONS, key);
  if (existing) {
    const same = existing.event?.payload?.request_fingerprint === requestFingerprint(input);
    if (!same) return error(409, 'IDEMPOTENCY_CONFLICT', 'request_id already binds different meaning');
    return json({
      schema: 'adrs322.observationAppendResult/1',
      status: 'PASS',
      duplicate: true,
      object_key: key,
      object_sha256: await sha256(existing.text),
      event: existing.event,
      claim_ceiling: CLAIM_CEILING,
      authority: false,
    });
  }

  let current;
  try {
    current = await surface(env, input.profile_id, input.subject_id);
  } catch (cause) {
    return error(409, 'SURFACE_UNAVAILABLE', cause instanceof Error ? cause.message : String(cause));
  }
  const action = findPermittedAction(current, input.action_id);
  if (!action || action.effect_class !== 'append-observation' || action.event_kind !== 'interaction.continue.observed') {
    return error(409, 'ACTION_NOT_PERMITTED', 'action is not currently permitted');
  }

  const event = observationFromRequest(input, new Date().toISOString());
  const bytes = canonical(event);
  const stored = await env.OBSERVATIONS.put(key, bytes, {
    onlyIf: { etagDoesNotMatch: '*' },
    httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'no-store' },
    customMetadata: {
      schema: event.schema,
      event_id: event.event_id,
      subject_id: event.subject_id,
      profile_id: event.profile_id,
      action_id: input.action_id,
    },
  });

  if (!stored) {
    const raced = await readStoredEvent(env.OBSERVATIONS, key);
    if (!raced) return error(409, 'CONCURRENT_APPEND_UNKNOWN', 'conditional append failed without readable winner');
    const same = raced.event?.payload?.request_fingerprint === requestFingerprint(input);
    if (!same) return error(409, 'IDEMPOTENCY_CONFLICT', 'concurrent request_id binds different meaning');
    return json({
      schema: 'adrs322.observationAppendResult/1',
      status: 'PASS',
      duplicate: true,
      object_key: key,
      object_sha256: await sha256(raced.text),
      event: raced.event,
      claim_ceiling: CLAIM_CEILING,
      authority: false,
    });
  }

  const readback = await readStoredEvent(env.OBSERVATIONS, key);
  if (!readback || readback.text !== bytes) return error(500, 'R2_READBACK_MISMATCH', 'written observation did not read back byte-identically');
  return json({
    schema: 'adrs322.observationAppendResult/1',
    status: 'PASS',
    duplicate: false,
    object_key: key,
    object_sha256: await sha256(readback.text),
    event: readback.event,
    claim_ceiling: CLAIM_CEILING,
    authority: false,
  }, 201);
}

async function handleEvidence(env, subjectId) {
  const prefix = `events/${subjectId}/`;
  const listed = await env.OBSERVATIONS.list({ prefix, limit: MAX_EVENTS + 1 });
  if (listed.truncated || listed.objects.length > MAX_EVENTS) return error(409, 'EVENT_LIMIT', 'event limit exceeded');
  const objects = [...listed.objects]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((object) => ({ key: object.key, etag: object.etag, size: object.size, uploaded: object.uploaded?.toISOString?.() ?? null }));
  return json({
    schema: 'adrs322.observationPoolEvidence/1',
    status: 'PASS',
    subject_id: subjectId,
    prefix,
    object_count: objects.length,
    objects,
    projection_object_count: objects.filter((object) => object.key.includes('/current/') || object.key.includes('/projection/')).length,
    claim_ceiling: CLAIM_CEILING,
    authority: false,
  });
}

async function handleObservationReadback(env, subjectId, requestId) {
  const key = eventKey(subjectId, requestId);
  const stored = await readStoredEvent(env.OBSERVATIONS, key);
  if (!stored) return error(404, 'NOT_FOUND', 'observation not found');
  return json({
    schema: 'adrs322.observationReadback/1',
    status: 'PASS',
    object_key: key,
    object_sha256: await sha256(stored.text),
    event: stored.event,
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
          schema: 'adrs322.runtimeMeta/1',
          status: 'PASS',
          app_version: env.APP_VERSION ?? 'unbound',
          worker_name: env.WORKER_NAME ?? 'unbound',
          claim_ceiling: CLAIM_CEILING,
          observation_store: 'R2',
          current_state_store: false,
          authority: false,
        });
      }
      if (request.method === 'GET' && url.pathname === '/api/surface') {
        const profileId = url.searchParams.get('profile_id') ?? '';
        const subjectId = validateSubjectId(url.searchParams.get('subject_id') ?? '');
        return json(await surface(env, profileId, subjectId));
      }
      if (request.method === 'POST' && url.pathname === '/api/observations') return handleObservation(request, env);
      if (request.method === 'GET' && url.pathname === '/api/evidence') {
        const subjectId = validateSubjectId(url.searchParams.get('subject_id') ?? '');
        return handleEvidence(env, subjectId);
      }
      if (request.method === 'GET' && url.pathname === '/api/observation') {
        const subjectId = validateSubjectId(url.searchParams.get('subject_id') ?? '');
        const requestId = validateRequestId(url.searchParams.get('request_id') ?? '');
        return handleObservationReadback(env, subjectId, requestId);
      }
      if (url.pathname.startsWith('/api/')) return error(404, 'NOT_FOUND', 'unknown API route');
      if (request.method !== 'GET' && request.method !== 'HEAD') return error(405, 'METHOD_NOT_ALLOWED', 'method not allowed');
      return env.ASSETS.fetch(request);
    } catch (cause) {
      return error(400, 'INVALID_INPUT', cause instanceof Error ? cause.message : String(cause));
    }
  },
};

export { eventKey, listStoredEvents, surface };
