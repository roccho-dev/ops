const encoder = new TextEncoder();

export const EVENT_SCHEMA = 'adrs322.proofEvent/1';
export const REQUEST_SCHEMA = 'adrs322.actionObservationRequest/1';
export const SURFACE_SCHEMA = 'adrs322.surfaceProjection/1';
export const KERNEL_ID = 'log-projected-application-kernel/1';
export const CLAIM_CEILING = 'BOUNDED_PROVIDER_PROOF';

const ID_RE = /^proof-[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const REQUEST_ID_RE = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;

export const SEMANTIC_BUNDLE = Object.freeze({
  schema: 'adrs322.proofSemanticBundle/1',
  bundle_id: 'internal-external-next-value/1',
  profiles: {
    internal: {
      base_kind: 'release.current.observed',
      states: [
        {
          state_id: 'release-current',
          all: ['release.current.observed'],
          none: [],
          current_value: {
            title: 'Current internal Release log',
            summary: 'The exact governance Release observation is available for review.',
          },
          include_latest: {
            release_tag: ['release.current.observed', 'release_tag'],
            source_receipt: ['release.current.observed', 'source_receipt'],
          },
          actions: ['inspect-release'],
        },
      ],
      actions: {
        'inspect-release': {
          action_id: 'inspect-release',
          label: 'Inspect exact Release evidence',
          effect_class: 'read-only-navigation',
          href: 'https://github.com/roccho-dev/ops/pull/336',
        },
      },
    },
    external: {
      base_kind: 'surface.public.available',
      states: [
        {
          state_id: 'continued',
          all: ['surface.public.available', 'interaction.continue.observed'],
          none: [],
          current_value: {
            title: 'Next value surface',
            summary: 'The prior public surface was used, so the next reusable surface is now available.',
          },
          include_latest: {
            prior_action: ['interaction.continue.observed', 'action_id'],
          },
          actions: ['open-next'],
        },
        {
          state_id: 'available',
          all: ['surface.public.available'],
          none: ['interaction.continue.observed'],
          current_value: {
            title: 'Public log surface',
            summary: 'A public-safe projection is available. Continue only when it is useful.',
          },
          include_latest: {},
          actions: ['continue'],
        },
      ],
      actions: {
        continue: {
          action_id: 'continue',
          label: 'Continue to the next value surface',
          effect_class: 'append-observation',
          event_kind: 'interaction.continue.observed',
          method: 'POST',
          endpoint: '/api/observations',
        },
        'open-next': {
          action_id: 'open-next',
          label: 'Open the next surface',
          effect_class: 'read-only-navigation',
          href: '#next',
        },
      },
    },
  },
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

export function canonical(value) {
  return `${JSON.stringify(stable(value))}\n`;
}

export async function sha256(value) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function assertClosedKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${label}: unknown field ${key}`);
  }
}

export function validateSubjectId(value) {
  if (typeof value !== 'string' || !ID_RE.test(value)) throw new TypeError('subject_id: invalid opaque proof identity');
  return value;
}

export function validateRequestId(value) {
  if (typeof value !== 'string' || !REQUEST_ID_RE.test(value)) throw new TypeError('request_id: invalid');
  return value;
}

export function validateProfileId(value) {
  if (value !== 'internal' && value !== 'external') throw new TypeError('profile_id: unknown');
  return value;
}

export function validateEvent(input) {
  if (!isPlainObject(input)) throw new TypeError('event: object required');
  assertClosedKeys(input, new Set(['schema', 'event_id', 'subject_id', 'profile_id', 'kind', 'observed_at', 'payload', 'source']), 'event');
  if (input.schema !== EVENT_SCHEMA) throw new TypeError('event: schema mismatch');
  validateRequestId(input.event_id);
  validateSubjectId(input.subject_id);
  validateProfileId(input.profile_id);
  if (typeof input.kind !== 'string' || !/^[a-z][a-z0-9.-]{1,80}$/.test(input.kind)) throw new TypeError('event: invalid kind');
  if (typeof input.observed_at !== 'string' || Number.isNaN(Date.parse(input.observed_at))) throw new TypeError('event: invalid observed_at');
  if (!isPlainObject(input.payload)) throw new TypeError('event: payload object required');
  if (typeof input.source !== 'string' || !/^[a-z][a-z0-9.-]{1,80}$/.test(input.source)) throw new TypeError('event: invalid source');
  return stable(input);
}

export function validateActionRequest(input) {
  if (!isPlainObject(input)) throw new TypeError('request: object required');
  assertClosedKeys(input, new Set(['schema', 'request_id', 'subject_id', 'profile_id', 'action_id']), 'request');
  if (input.schema !== REQUEST_SCHEMA) throw new TypeError('request: schema mismatch');
  validateRequestId(input.request_id);
  validateSubjectId(input.subject_id);
  if (input.profile_id !== 'external') throw new TypeError('request: only external profile is writable in this proof');
  if (typeof input.action_id !== 'string' || !/^[a-z][a-z0-9-]{1,62}$/.test(input.action_id)) throw new TypeError('request: invalid action_id');
  return stable(input);
}

export function baseEvent(profileId, subjectId) {
  validateProfileId(profileId);
  validateSubjectId(subjectId);
  if (profileId === 'internal') {
    return validateEvent({
      schema: EVENT_SCHEMA,
      event_id: 'base-release-current',
      subject_id: subjectId,
      profile_id: profileId,
      kind: 'release.current.observed',
      observed_at: '2026-08-27T20:42:54.000Z',
      source: 'ops-336-provider-readback',
      payload: {
        release_tag: 'gov-release/company-operating-contract-v0.2.0/8f087d7babfbb04bce7e9e6a1bd21169dec5d37299c58bfcbb49c5756468c461',
        release_id: '356287183',
        source_receipt: 'https://github.com/roccho-dev/ops/actions/runs/33112694104/artifacts/9663196591',
        proof_pr: 'https://github.com/roccho-dev/ops/pull/336',
      },
    });
  }
  return validateEvent({
    schema: EVENT_SCHEMA,
    event_id: 'base-public-surface',
    subject_id: subjectId,
    profile_id: profileId,
    kind: 'surface.public.available',
    observed_at: '2026-08-28T00:00:00.000Z',
    source: 'adrs-322-public-safe-fixture',
    payload: {
      public_safe: true,
      value_surface: 'log-projected-application-kernel',
    },
  });
}

function eventOrder(left, right) {
  return left.observed_at.localeCompare(right.observed_at) || left.event_id.localeCompare(right.event_id);
}

export function normalizeEvents(inputs, profileId, subjectId) {
  validateProfileId(profileId);
  validateSubjectId(subjectId);
  const byId = new Map();
  for (const raw of inputs) {
    const event = validateEvent(raw);
    if (event.profile_id !== profileId || event.subject_id !== subjectId) continue;
    const previous = byId.get(event.event_id);
    if (previous && canonical(previous) !== canonical(event)) throw new TypeError(`event: conflicting duplicate ${event.event_id}`);
    byId.set(event.event_id, event);
  }
  return [...byId.values()].sort(eventOrder);
}

function latestByKind(events) {
  const result = new Map();
  for (const event of events) result.set(event.kind, event);
  return result;
}

function resolvePath(event, key) {
  if (!event) return null;
  return Object.hasOwn(event.payload, key) ? event.payload[key] : null;
}

export async function projectSurface({ profileId, subjectId, events, appVersion = 'local' }) {
  const profile = SEMANTIC_BUNDLE.profiles[validateProfileId(profileId)];
  const normalized = normalizeEvents(events, profileId, subjectId);
  const latest = latestByKind(normalized);
  const state = profile.states.find((candidate) =>
    candidate.all.every((kind) => latest.has(kind)) && candidate.none.every((kind) => !latest.has(kind))
  );
  if (!state) throw new TypeError('surface: no valid state');

  const included = {};
  for (const [name, [kind, key]] of Object.entries(state.include_latest)) included[name] = resolvePath(latest.get(kind), key);
  const actions = state.actions.map((actionId) => stable(profile.actions[actionId]));
  const bundleDigest = await sha256(canonical(SEMANTIC_BUNDLE));
  const stateDigest = await sha256(canonical(normalized));
  const kernelDigest = await sha256(canonical({ kernel_id: KERNEL_ID, bundle_digest: bundleDigest }));
  const withoutDigest = {
    schema: SURFACE_SCHEMA,
    status: 'PASS',
    claim_ceiling: CLAIM_CEILING,
    authority: false,
    kernel_id: KERNEL_ID,
    kernel_digest: kernelDigest,
    semantic_bundle_id: SEMANTIC_BUNDLE.bundle_id,
    semantic_bundle_digest: bundleDigest,
    app_version: appVersion,
    profile_id: profileId,
    subject_id: subjectId,
    state_id: state.state_id,
    state_digest: stateDigest,
    event_count: normalized.length,
    current_value: { ...state.current_value, ...included },
    permitted_actions: actions,
    projection_persisted: false,
    current_state_authority: false,
  };
  return stable({ ...withoutDigest, surface_digest: await sha256(canonical(withoutDigest)) });
}

export function requestFingerprint(request) {
  const value = validateActionRequest(request);
  return canonical({
    request_id: value.request_id,
    subject_id: value.subject_id,
    profile_id: value.profile_id,
    action_id: value.action_id,
  });
}

export function observationFromRequest(request, observedAt) {
  const value = validateActionRequest(request);
  if (typeof observedAt !== 'string' || Number.isNaN(Date.parse(observedAt))) throw new TypeError('observed_at: invalid');
  return validateEvent({
    schema: EVENT_SCHEMA,
    event_id: value.request_id,
    subject_id: value.subject_id,
    profile_id: value.profile_id,
    kind: 'interaction.continue.observed',
    observed_at: observedAt,
    source: 'cloudflare-worker-post',
    payload: {
      action_id: value.action_id,
      request_fingerprint: requestFingerprint(value),
    },
  });
}

export function findPermittedAction(surface, actionId) {
  return surface.permitted_actions.find((action) => action.action_id === actionId) ?? null;
}
