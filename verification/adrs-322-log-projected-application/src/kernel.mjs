const encoder = new TextEncoder();

export const EVENT_SCHEMA = 'adrs322.proofEvent/1';
export const REQUEST_SCHEMA = 'adrs322.actionObservationRequest/1';
export const SURFACE_SCHEMA = 'adrs322.surfaceProjection/1';
export const SEMANTIC_BUNDLE_SCHEMA = 'adrs322.proofSemanticBundle/1';
export const KERNEL_ID = 'log-projected-application-kernel/1';
export const CLAIM_CEILING = 'BOUNDED_PROVIDER_PROOF';

const ID_RE = /^proof-[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const REQUEST_ID_RE = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;
const TOKEN_RE = /^[a-z][a-z0-9._/-]{0,126}$/;
const KIND_RE = /^[a-z][a-z0-9.-]{1,80}$/;
const ACTION_ID_RE = /^[a-z][a-z0-9-]{1,62}$/;
const FIELD_RE = /^[a-z][a-z0-9_]{0,80}$/;

export const SEMANTIC_BUNDLE = Object.freeze({
  schema: SEMANTIC_BUNDLE_SCHEMA,
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

function assertToken(value, label, pattern = TOKEN_RE) {
  if (typeof value !== 'string' || !pattern.test(value)) throw new TypeError(`${label}: invalid`);
  return value;
}

function assertStringArray(value, label, pattern = KIND_RE) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !pattern.test(item))) {
    throw new TypeError(`${label}: string array required`);
  }
  return value;
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
  if (typeof input.kind !== 'string' || !KIND_RE.test(input.kind)) throw new TypeError('event: invalid kind');
  if (typeof input.observed_at !== 'string' || Number.isNaN(Date.parse(input.observed_at))) throw new TypeError('event: invalid observed_at');
  if (!isPlainObject(input.payload)) throw new TypeError('event: payload object required');
  if (typeof input.source !== 'string' || !KIND_RE.test(input.source)) throw new TypeError('event: invalid source');
  return stable(input);
}

export function validateActionRequest(input) {
  if (!isPlainObject(input)) throw new TypeError('request: object required');
  assertClosedKeys(input, new Set(['schema', 'request_id', 'subject_id', 'profile_id', 'action_id']), 'request');
  if (input.schema !== REQUEST_SCHEMA) throw new TypeError('request: schema mismatch');
  validateRequestId(input.request_id);
  validateSubjectId(input.subject_id);
  if (input.profile_id !== 'external') throw new TypeError('request: only external profile is writable in this proof');
  if (typeof input.action_id !== 'string' || !ACTION_ID_RE.test(input.action_id)) throw new TypeError('request: invalid action_id');
  return stable(input);
}

function validateActionDefinition(action, actionId, label) {
  if (!isPlainObject(action)) throw new TypeError(`${label}: object required`);
  assertClosedKeys(action, new Set(['action_id', 'label', 'effect_class', 'event_kind', 'method', 'endpoint', 'href']), label);
  if (action.action_id !== actionId || !ACTION_ID_RE.test(actionId)) throw new TypeError(`${label}: action_id mismatch`);
  if (typeof action.label !== 'string' || action.label.length < 1 || action.label.length > 160) throw new TypeError(`${label}: label invalid`);
  if (action.effect_class === 'read-only-navigation') {
    if (typeof action.href !== 'string' || action.href.length < 1 || action.href.length > 500) throw new TypeError(`${label}: href required`);
    if (action.event_kind !== undefined || action.method !== undefined || action.endpoint !== undefined) throw new TypeError(`${label}: read-only action has effect fields`);
  } else if (action.effect_class === 'append-observation') {
    if (typeof action.event_kind !== 'string' || !KIND_RE.test(action.event_kind)) throw new TypeError(`${label}: event_kind required`);
    if (action.method !== 'POST') throw new TypeError(`${label}: POST required`);
    if (typeof action.endpoint !== 'string' || !action.endpoint.startsWith('/')) throw new TypeError(`${label}: endpoint required`);
    if (action.href !== undefined) throw new TypeError(`${label}: append action has href`);
  } else {
    throw new TypeError(`${label}: unknown effect_class`);
  }
}

export function validateSemanticBundle(input) {
  if (!isPlainObject(input)) throw new TypeError('semantic bundle: object required');
  assertClosedKeys(input, new Set(['schema', 'bundle_id', 'profiles']), 'semantic bundle');
  if (input.schema !== SEMANTIC_BUNDLE_SCHEMA) throw new TypeError('semantic bundle: schema mismatch');
  assertToken(input.bundle_id, 'semantic bundle bundle_id');
  if (!isPlainObject(input.profiles) || Object.keys(input.profiles).length === 0) throw new TypeError('semantic bundle: profiles required');

  for (const [profileId, profile] of Object.entries(input.profiles)) {
    validateProfileId(profileId);
    if (!isPlainObject(profile)) throw new TypeError(`semantic bundle profile ${profileId}: object required`);
    assertClosedKeys(profile, new Set(['base_kind', 'states', 'actions']), `semantic bundle profile ${profileId}`);
    if (typeof profile.base_kind !== 'string' || !KIND_RE.test(profile.base_kind)) throw new TypeError(`semantic bundle profile ${profileId}: base_kind invalid`);
    if (!isPlainObject(profile.actions)) throw new TypeError(`semantic bundle profile ${profileId}: actions required`);
    for (const [actionId, action] of Object.entries(profile.actions)) validateActionDefinition(action, actionId, `semantic bundle action ${profileId}/${actionId}`);
    if (!Array.isArray(profile.states) || profile.states.length === 0) throw new TypeError(`semantic bundle profile ${profileId}: states required`);
    const stateIds = new Set();
    for (const [index, state] of profile.states.entries()) {
      const stateLabel = `semantic bundle state ${profileId}/${index}`;
      if (!isPlainObject(state)) throw new TypeError(`${stateLabel}: object required`);
      assertClosedKeys(state, new Set(['state_id', 'all', 'none', 'current_value', 'include_latest', 'actions']), stateLabel);
      assertToken(state.state_id, `${stateLabel} state_id`);
      if (stateIds.has(state.state_id)) throw new TypeError(`${stateLabel}: duplicate state_id`);
      stateIds.add(state.state_id);
      assertStringArray(state.all, `${stateLabel} all`);
      assertStringArray(state.none, `${stateLabel} none`);
      if (!state.all.includes(profile.base_kind)) throw new TypeError(`${stateLabel}: base_kind must be required`);
      if (!isPlainObject(state.current_value)) throw new TypeError(`${stateLabel}: current_value required`);
      assertClosedKeys(state.current_value, new Set(['title', 'summary']), `${stateLabel} current_value`);
      if (typeof state.current_value.title !== 'string' || typeof state.current_value.summary !== 'string') throw new TypeError(`${stateLabel}: title/summary required`);
      if (!isPlainObject(state.include_latest)) throw new TypeError(`${stateLabel}: include_latest required`);
      for (const [name, path] of Object.entries(state.include_latest)) {
        assertToken(name, `${stateLabel} include name`);
        if (!Array.isArray(path) || path.length !== 2 || typeof path[0] !== 'string' || !KIND_RE.test(path[0]) || typeof path[1] !== 'string' || !FIELD_RE.test(path[1])) {
          throw new TypeError(`${stateLabel}: include path invalid`);
        }
      }
      assertStringArray(state.actions, `${stateLabel} actions`, ACTION_ID_RE);
      for (const actionId of state.actions) {
        if (!Object.hasOwn(profile.actions, actionId)) throw new TypeError(`${stateLabel}: unknown action ${actionId}`);
      }
    }
  }
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

export async function projectSurfaceWithBundle({ profileId, subjectId, events, semanticBundle, appVersion = 'local' }) {
  const bundle = validateSemanticBundle(semanticBundle);
  const validatedProfileId = validateProfileId(profileId);
  const profile = bundle.profiles[validatedProfileId];
  if (!profile) throw new TypeError(`surface: profile ${validatedProfileId} unavailable in bundle`);
  const normalized = normalizeEvents(events, validatedProfileId, subjectId);
  const latest = latestByKind(normalized);
  const state = profile.states.find((candidate) =>
    candidate.all.every((kind) => latest.has(kind)) && candidate.none.every((kind) => !latest.has(kind))
  );
  if (!state) throw new TypeError('surface: no valid state');

  const included = {};
  for (const [name, [kind, key]] of Object.entries(state.include_latest)) included[name] = resolvePath(latest.get(kind), key);
  const actions = state.actions.map((actionId) => stable(profile.actions[actionId]));
  const bundleDigest = await sha256(canonical(bundle));
  const stateDigest = await sha256(canonical(normalized));
  const kernelDigest = await sha256(canonical({ kernel_id: KERNEL_ID, bundle_digest: bundleDigest }));
  const withoutDigest = {
    schema: SURFACE_SCHEMA,
    status: 'PASS',
    claim_ceiling: CLAIM_CEILING,
    authority: false,
    kernel_id: KERNEL_ID,
    kernel_digest: kernelDigest,
    semantic_bundle_id: bundle.bundle_id,
    semantic_bundle_digest: bundleDigest,
    app_version: appVersion,
    profile_id: validatedProfileId,
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

export async function projectSurface({ profileId, subjectId, events, appVersion = 'local' }) {
  return projectSurfaceWithBundle({ profileId, subjectId, events, semanticBundle: SEMANTIC_BUNDLE, appVersion });
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
