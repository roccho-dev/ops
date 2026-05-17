# Issue 002: Project Source upload/readback/artifact fetch live-proof hardening

## Status

Mostly implemented, but still needs integration hardening and evidence discipline.

`ops-cdp-core` already exposes Project transport wrappers such as:

- `project-transport-doctor`
- `project-source-put`
- `project-thread-create`
- `project-thread-send`
- `project-thread-readback`
- `project-artifact-fetch`
- `project-transport-run`

## ops responsibility

`ops-cdp-core` owns CDP automation, Project Source upload/readback, thread create/send/readback, artifact fetch, and transport-only result records.

It must not make route decisions, semantic approval, completion approval, or merge decisions.

## Problem

The transport tools exist, but the workflow must keep proving these facts separately:

- Project Source upload happened.
- The expected filename is visible.
- The worker thread can actually read the uploaded entrypoint.
- Thread send happened.
- Thread readback saw expected markers.
- Artifact fetch produced local files.
- Hashes and filenames match expected manifest.

Any one of these being true does not imply semantic approval or completion.

## Existing references

- `ops/packages/ops-cdp-core/default.nix`
- `ops/packages/ops-cdp-core/docs/project-transport.md`
- `ops/packages/ops-cdp-core/src/cdp/project-transport.py`
- `ops/packages/ops-cdp-core/src/cdp/docs/host-git-project-workflow.md`
- `.agents/project-workspace.md`
- `.agents/transport.md`
- `specs/packages/ops-project-source-sync/default.nix`

## Desired behavior

Transport result records should remain transport-only:

```json
{
  "semanticApproval": false,
  "completionApproval": false,
  "routeDecision": false
}
```

The wrappers should make it easy for callers to require:

- expected Project Source filename
- expected sha256
- expected thread marker
- target thread id or URL
- artifact locator
- local artifact sha256
- readback evidence path

## Acceptance criteria

- Offline checks prove all wrappers are exposed through the package output.
- `project-thread-create` rejects `?tab=sources` URL shape.
- `project-source-put` accepts Project Source URL shape and records visibility result.
- `project-thread-readback` can require markers and returns `readbackVerified`.
- `project-artifact-fetch` writes manifest plus sha256 evidence.
- No wrapper returns semantic approval or completion approval.
- Runbook checks keep live proof as `not-proven` unless separate readback/artifact evidence exists.

## Non-goals

- No thread content judgment.
- No merge-ready decision.
- No fallback to inline source/diff/handoff body.
- No thread attachment fallback as the standard path.
