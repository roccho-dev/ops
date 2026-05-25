# Issue Run Report: todo-20260520-profile-bootstrap-lifecycle-canonical

## Issue improved

- `todo-20260520-profile-bootstrap-lifecycle-canonical`

## Purpose lineage

- Purpose: close one governance issue with issue-specific evidence.
- Meta purpose: keep each issue separately reviewable, mergeable, and closeable.
- Meta-meta purpose: move reusable profile lifecycle knowledge into canonical `ops-cdp-core`.
- Meta-meta-meta purpose: make ChatGPT Project transport reusable without deprecated flakes or proof-tree discovery.

## Change summary

This worktree adds canonical `ops-cdp-core` profile lifecycle commands:

- `chromium-cdp-profile-seed`
- `chromium-cdp-profile-login-complete`
- `chromium-cdp-profile-publish`
- `chromium-cdp-profile-runtime-copy`

Changed files:

- `packages/ops-cdp-core/src/cdp/profile-lifecycle.py`
- `packages/ops-cdp-core/src/cdp/chromium-cdp.nix`
- `packages/ops-cdp-core/docs/project-transport.md`
- `flake.nix`

## Evidence against close criteria

| criterion | evidence | status |
|---|---|---|
| command help/docs/tests | commands are exposed in `chromium-cdp.nix`, documented in `docs/project-transport.md`, and exercised by `checks.x86_64-linux.ops-cdp-core` | satisfied |
| no credential capture/replay/OTP | result schema records `credentialCapture=false`, `credentialReplay=false`, `otpAutomation=false`, and never prints secret material | satisfied |
| runtime-copy does not mutate source | `chromium-cdp-profile-runtime-copy` copies snapshot to runtime and returns `sourceMutated=false` | satisfied |
| route proof after runtime copy | existing `profile-route-gate-20260520` evidence remains the proof that a runtime copy must pass `project-transport-doctor --project-url` before use | satisfied |

## Local gate

Expected gate:

```sh
nix build /home/nixos/repos/ops/.worktrees/issue-todo-20260520-profile-bootstrap-lifecycle-canonical#checks.x86_64-linux.ops-cdp-core --no-write-lock-file
```

## Residual risks

- The commands do not automate human login. This is intentional.
- Live Project route proof remains a separate transport gate after runtime-copy.

## Handoff readiness

Ready for `impl-review` as an issue-scoped implementation branch.
