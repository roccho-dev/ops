# Binding-driven root JSONL map delivery

`gov-release-proxy` is one bounded read-only Cloudflare Worker.

```text
GET /  Accept: text/html
  -> exact UI asset

GET /  Accept: application/json | application/x-ndjson
  -> exact semantic source asset
```

The browser receives one URL and one path. It does not choose a repository, commit, Release, asset, profile, or credential.

## Binding contract

Instance identity lives under `bindings/`, not in Worker behavior.

```text
exact source repository / commit or Release asset
+ bytes / SHA-256 / media type
+ exact UI commit / tree / profile / artifact digests when visual
+ claim ceiling
+ authority=false
+ productionCutover=false
```

The default binding is `bindings/selected-universe.json`. The historical private Access fixture is `bindings/private-fixture.json`.

A deployment may provide one exact JSON value through `GOV_RELEASE_BINDING_JSON`. The same Worker validates it before serving either HTML or data. Unknown fields, malformed JSON, source-URL mismatch, digest mismatch, authority escalation, unsupported claim ceilings, and HTML/NDJSON meaning-identity mismatch fail closed.

Changing a case must not require changing `src/worker.mjs`.

## Stable Worker responsibility

The Worker owns only:

- `GET` and `HEAD` on `/`;
- `Accept` content negotiation;
- exact binding validation;
- anonymous Git raw or authenticated GitHub Release-asset reads;
- byte and SHA-256 verification;
- same-root UI delegation with exact HTML byte, SHA-256, media-type, and embedded meaning-digest checks;
- response identity headers;
- explicit closed errors.

It does not own Governance meaning, profile selection, renderer behavior, accepted/current state, proposal submission, R2, OIDC, GitHub Issue writes, analytics, or production cutover.

## Response identity

Both HTML and data responses include:

```text
x-gov-map-binding
x-gov-claim-ceiling
x-gov-production-cutover: false
```

Visual bindings also include the exact UI artifact commit, profile ID, and meaning digest. The UI meaning digest must equal the served JSON/NDJSON digest.

## Closed states

```text
401 -> upstream authentication required
403 -> upstream access denied
404 -> non-root path
405 -> non-GET/HEAD method
500 -> invalid binding
502 -> upstream status, byte, or digest mismatch
503 -> missing bounded upstream credential or UI assets
```

Query and fragment input are rejected. Arbitrary browser-selected upstreams are not supported.

## Proof boundary

`roccho-dev/ui#183` and `roccho-dev/ops#359` remain the immutable first provider proof. `roccho-dev/ops#363` adds binding-driven local replay without rewriting that evidence.

Current PR-level proof may establish two local exact bindings through one Worker. A second real Governance/UI/provider case, remote Chromium, repository-wide Green, and merged-head readback remain explicit gates before `ops#363` can close.

Generated HTML, SVG, bindings, headers, and receipts remain `authority:false`.
