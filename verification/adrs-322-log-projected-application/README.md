# ADRS #322 / OPS #339 — log-projected application kernel proof

This bounded proof reuses the exact internal Release observation already verified by `ops#336` and closes only the missing return loop:

```text
base event + immutable observations
→ one deterministic kernel
→ actor/profile surface
→ permitted Web action
→ POST observation
→ one immutable R2 object
→ reproject and replay
```

## Two surfaces, one kernel

| Profile | Source | Projected value | Writable effect |
|---|---|---|---|
| `internal` | exact `ops#336` governance Release observation | current internal Release surface | none; read-only evidence link |
| `external` | public-safe base event + R2 observations | current/next value surface | one typed `continue` observation |

Both responses carry the same `kernel_id`, `kernel_digest`, and semantic-bundle digest. The profile bundle changes the current value and permitted actions; it does not create a second reducer.

## Persistence boundary

R2 stores only immutable event objects:

```text
events/<opaque-subject-id>/<request-id>.json
```

No `current`, snapshot, score, funnel stage, or surface projection is stored. Every GET reconstructs the surface from the base event and listed R2 events. A duplicate request ID with the same request fingerprint is idempotent; a different meaning fails closed.

The POST body is a closed request shape and accepts no free-form payload or PII field:

```json
{
  "schema": "adrs322.actionObservationRequest/1",
  "request_id": "continue-...",
  "subject_id": "proof-external-...",
  "profile_id": "external",
  "action_id": "continue"
}
```

This is a proof fixture, not a production event schema.

## Run locally

The pure proof requires only Node 22:

```text
node verification/adrs-322-log-projected-application/local-proof.mjs /tmp/receipt.json
```

It uses a fake R2 implementation and proves the deterministic kernel, conditional append, idempotency, conflict rejection, closed request, subject isolation, events-only persistence, deletion/replay, and list-order independence.

## Provider proof

The PR workflow uses the existing `cloudflare-production` environment to:

1. run the local proof;
2. create/reuse one staging R2 bucket;
3. deploy one staging Worker with static assets;
4. append/read back real R2 observations;
5. prove HTTP and real-Chromium before/after/reload behavior;
6. read static assets back byte-identically;
7. emit a secret-free provider receipt.

Resources are staging proof resources:

```text
Worker: stg-log-projected-application
R2:     stg-log-projected-observations
```

## Claim ceiling

A PASS proves only that one bounded Cloudflare Worker/R2 implementation can project an internal Release-derived surface and an external next-value surface with the same deterministic kernel, append one typed observation, and reconstruct the next surface without persisted current state or a shell redeploy.

It does not prove production authority, identity resolution, consent, authentication, generic schemas, mail delivery, customer value, PMF, revenue, or cutover.
