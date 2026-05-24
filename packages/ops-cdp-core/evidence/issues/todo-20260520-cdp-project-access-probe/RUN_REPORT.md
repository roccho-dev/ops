# Issue Run Report: todo-20260520-cdp-project-access-probe

## Issue improved

- `todo-20260520-cdp-project-access-probe`

## Purpose lineage

- Purpose: close one governance issue with issue-specific evidence.
- Meta purpose: keep each issue separately reviewable, mergeable, and closeable.
- Meta-meta purpose: reduce prose-only CDP Project transport knowledge.
- Meta-meta-meta purpose: make Project transport safe to reuse through evidence, review, and localizer gates.

## Change summary

This worktree records that current `ops-cdp-core` already probes the supplied
target Project URL, not just ambient ChatGPT authentication.

Relevant implementation:

- `packages/ops-cdp-core/src/cdp/project-transport.py`
- `packages/ops-cdp-core/src/cdp/chromium-cdp-project-access-probe.mjs`
- `packages/ops-cdp-core/docs/project-transport.md`
- `packages/ops-cdp-core/evidence/profile-route-gate-20260520/`

## Evidence against close criteria

| criterion | evidence | status |
|---|---|---|
| route-state vocabulary for target Project access | `chromium-cdp-project-access-probe.mjs` emits `project-access-ok`, `project-url-wrong-shape`, `project-access-profile-missing`, `project-access-denied`, `project-access-url-mismatch`, and `project-access-shell-missing` | satisfied |
| supplied target Project URL is probed | `project-transport-doctor --project-url` calls `chromium-cdp-project-access-probe --projectUrl` | satisfied |
| generic auth is not enough | `docs/project-transport.md` and `evidence/profile-route-gate-20260520/README.md` state generic ChatGPT login is insufficient | satisfied |
| login redirect / inaccessible Project classification | probe classifies login URL as `project-access-profile-missing` and denied/not-found as `project-access-denied` | satisfied |
| redacted proof | profile route gate evidence records route state without cookies, credentials, or profile contents | satisfied |

## Local gate

Expected gate:

```sh
nix build /home/nixos/repos/ops/.worktrees/issue-todo-20260520-cdp-project-access-probe#checks.x86_64-linux.ops-cdp-core --no-write-lock-file
```

## Residual risks

- This report is evidence over current implementation. It does not claim live Project access for every future Project URL.
- `impl-review-pass` is still required before this can be aggregated into a repo-level pre-canonical candidate.

## Handoff readiness

Ready for `impl-review` as an issue-scoped evidence branch.
