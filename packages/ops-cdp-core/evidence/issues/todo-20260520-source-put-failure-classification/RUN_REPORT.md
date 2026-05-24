# Issue Run Report: todo-20260520-source-put-failure-classification

## Issue improved

- `todo-20260520-source-put-failure-classification`

## Purpose lineage

- Purpose: close one governance issue with issue-specific evidence.
- Meta purpose: keep each issue separately reviewable, mergeable, and closeable.
- Meta-meta purpose: replace coarse transport failure prose with reusable machine status.
- Meta-meta-meta purpose: make Project Source transport failures actionable for future worker handoff.

## Change summary

This worktree changes `project-source-put` failure output from one coarse
visibility failure into a documented taxonomy with `failureClass` and
`failurePrecedence`.

Changed files:

- `packages/ops-cdp-core/src/cdp/project-transport.py`
- `flake.nix`

## Failure taxonomy

| failureClass | status |
|---|---|
| `local-file-validation-failure` | `local-file-validation-failed` |
| `wrong-url-shape` | `project-url-wrong-shape` |
| `project-access` | `project-access-profile-missing` |
| `missing-source-page` | `source-page-not-loaded` |
| `upload-interaction-failure` | `source-upload-interaction-failed` |
| `upload-visibility-readback-failure` | `source-upload-visibility-readback-failed` |
| `unknown` | `source-upload-unknown-failed` |

## Local gate

Expected gate:

```sh
nix build /home/nixos/repos/ops/.worktrees/issue-todo-20260520-source-put-failure-classification#checks.x86_64-linux.ops-cdp-core --no-write-lock-file
```

The check now includes wrong URL shape and missing local file cases.

## Residual risks

- Browser/UI-specific upload failures are classified from stderr/stdout and structured upload output. Unknown UI failure shapes may still fall back to `unknown`.

## Handoff readiness

Ready for `impl-review` as an issue-scoped implementation branch.
