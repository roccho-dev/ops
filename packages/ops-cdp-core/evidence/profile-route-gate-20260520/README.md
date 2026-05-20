# Profile Route Gate Evidence 2026-05-20

This directory keeps the small durable proof for the Project profile route gate.
Raw CDP logs stay outside package docs unless promoted by a later handoff.

## Positive route

- Profile kind: authenticated Project-capable runtime copy
- CDP port: 9223
- Result: `project-route-recommended`
- Project Source upload: `source-upload-visible`
- Project thread create: `thread-created`
- Readback interval: at least 300 seconds
- Readback result: `readback-verified`

## Negative route

- Profile kind: fresh unauthenticated runtime profile
- CDP port: 9224
- Result: `project-route-not-verified`
- Doctor session status: `unauthenticated`
- Doctor reason: `NO_AUTH_SESSION_COOKIE`
- Recommended route: `null`

## Unauthenticated to existing snapshot route

- Fresh unauthenticated runtime profile: rejected
- Existing authenticated snapshot source:
  `/home/nixos/.secret/hq/chromium-cdp-profile.snapshot`
- Runtime profile: fresh copy of that existing snapshot
- CDP port: 9223
- Result: `project-route-recommended`
- Project Source upload: `source-upload-visible`
- Project thread create: `thread-created`
- Readback interval: at least 300 seconds
- Readback result: `readback-verified`
- Proof marker: `SAFE_PROJECT_SOURCE_MARKER_20260520T081000Z`

## Rule

A reachable CDP port is not enough.
Generic ChatGPT login is not enough.
The accepted route is the requested Project URL itself, followed by Project
Source upload, thread creation, and delayed thread readback.

## Automatic session route

The reusable automatic route proven here is session reuse from an existing
authenticated profile snapshot. It is not credential or OTP automation.

The proven route is:

```text
existing authenticated snapshot
  -> copy snapshot to a fresh runtime profile
  -> start Chromium CDP with that runtime copy
  -> project-transport-env/doctor probes the requested Project URL
  -> Project Source upload
  -> Project thread creation
  -> delayed thread readback
```

Accepted as automatic:

- starting CDP from a runtime copy of an existing authenticated
  snapshot;
- proving the requested Project route before upload;
- using Project Source and delayed readback to prove the route.
- rejecting a fresh unauthenticated profile before using the snapshot runtime
  copy.

Proven source:

- `/home/nixos/.secret/hq/chromium-cdp-profile.snapshot`

Not proven by this package evidence:

- creating that snapshot from a fresh profile;
- publishing that snapshot through canonical `ops-cdp-core` commands.

Not accepted as automatic:

- entering credentials, OTP, or account selection through CDP;
- treating a fresh unauthenticated profile as usable;
- treating a generic ChatGPT session as Project access;
- treating a reachable CDP port as Project access.
