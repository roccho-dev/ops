# Issue Run Report: todo-20260520-project-profile-candidate-ranking

## Issue improved

- `todo-20260520-project-profile-candidate-ranking`

## Purpose lineage

- Purpose: close one governance issue with issue-specific evidence.
- Meta purpose: keep each issue separately reviewable, mergeable, and closeable.
- Meta-meta purpose: reduce hidden CDP profile route knowledge.
- Meta-meta-meta purpose: make Project transport reusable through target-Project evidence instead of ambient session guesses.

## Change summary

This worktree records that current `project-transport-env` ranks CDP candidates
by probing each reachable port against the requested Project URL and returns a
single `recommendedRoute` only when target Project access succeeds.

Relevant implementation:

- `packages/ops-cdp-core/src/cdp/project-transport.py`
- `packages/ops-cdp-core/src/cdp/chromium-cdp-project-access-probe.mjs`
- `packages/ops-cdp-core/docs/project-transport.md`

## Evidence against close criteria

| criterion | evidence | status |
|---|---|---|
| target Project probe is ranking source | `project-transport-env --project-url` runs `chromium-cdp-project-access-probe` for each reachable port | satisfied |
| generic auth ranks lower than Project access | only probes with `project-access-ok` can become `recommendedRoute`; generic login/session success alone does not | satisfied |
| stale/broken/no-candidate cases | no reachable port returns `no-cdp-port-reachable`; reachable but non-Project route returns `project-route-not-verified` | satisfied |
| metadata redaction | route output records addr/port/status and not cookies, credentials, profile contents, or prompt bodies | satisfied |

## Local gate

Expected gate:

```sh
nix build /home/nixos/repos/ops/.worktrees/issue-todo-20260520-project-profile-candidate-ranking#checks.x86_64-linux.ops-cdp-core --no-write-lock-file
```

## Residual risks

- Ranking is port/route based; it does not expose browser profile filesystem metadata as an API.
- This is sufficient for route selection and intentionally avoids profile content introspection.

## Handoff readiness

Ready for `impl-review` as an issue-scoped evidence branch.
