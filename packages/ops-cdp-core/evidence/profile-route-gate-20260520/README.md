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

## Rule

A reachable CDP port is not enough.
Generic ChatGPT login is not enough.
The accepted route is the requested Project URL itself, followed by Project
Source upload, thread creation, and delayed thread readback.
