# refs-vault managed-root reconcile implementation proposal 260621

## Status

Proposal branch derived from `main`.

This proposal records the locally verified implementation continuation for `ops-refs-vault` and is intended to be reviewed before source merge. It does not modify `roccho-dev/refs`; refs remains a generated backup artifact, not SSOT and not a worktree.

## Source intent preserved

- Source authority remains `/home/nixos/repos/.bare/**/*.git`.
- Destination remains any Git remote forge selected by `--remote`, manifest target, or `OPS_REFS_VAULT_REMOTE`.
- Default backup scope remains selected branch heads, not all refs.
- Repo identity is derived from bare-root-relative filesystem schema path.
- Future wiki / issue expansion remains adapter-profile work, not GitHub API logic in core.

## Local implementation artifact

The implementation was prepared and locally verified in the continuation worktree from `ops-main.zip`.

Local commit recorded in the generated artifact:

```text
ada0ace324250986696311a99da64afce231e55b
```

Local verification summary:

| gate | result |
|---|---:|
| Node tests | 19/19 PASS |
| smoke proof | P01-P15 PASS |
| line coverage | 83.67% |
| requirements rows | 60 |
| `--mirror` usage | PASS, not used |
| GitHub API dependency | PASS, not used |
| Nix check | not run in local environment, Nix unavailable |
| live forge write | not run; local bare remote used as Git protocol equivalent |

## Proposed source changes

| area | change |
|---|---|
| projection | add `repoPath` / `repoKey` codec and reversible projection contract |
| discovery | support recursive bare discovery under bare root |
| audit | scan managed remote root instead of only manifest repo prefixes |
| reconcile | full outer join expected and observed refs |
| classify | classify equal, missing, source-ahead, remote-ahead-candidate, diverged-candidate, extra-current-schema, extra-legacy-schema, unknown-managed-extra |
| lease | require exact source/remote observation leases for adopt/discard |
| restore | require staging restore, HEAD verification, fsck, clone usability proof |
| tests | add projection, reconcile, e2e managed-root drift tests |
| requirements | add fine-grained final requirements and verification report |

## Review gates

| id | gate |
|---|---|
| G01 | path collision: `a.git` + branch `b/main` does not collide with `a/b.git` + branch `main` |
| G02 | repo path codec round-trips spaces, unicode, `%`, nested paths, hidden paths, and fails closed |
| G03 | recursive bare discovery finds nested `.git` bare repos |
| G04 | legacy `refs/heads/repos/...` is classified as `extra-legacy-schema` |
| G05 | unknown managed-root refs are reported instead of silently ignored |
| G06 | remote-ahead is candidate only and does not mutate SSOT automatically |
| G07 | diverged candidate blocks direct adoption |
| G08 | adopt fails if source changed after observation |
| G09 | discard fails if remote changed after observation |
| G10 | restore proves OID equality, HEAD, fsck, and clone usability |

## Required implementation paths

```text
flake.nix
packages/ops-refs-vault/bin/ops-refs-vault.mjs
packages/ops-refs-vault/default.nix
packages/ops-refs-vault/lib/ref-projection.mjs
packages/ops-refs-vault/lib/ref-reconcile.mjs
packages/ops-refs-vault/tests/e2e.mjs
packages/ops-refs-vault/tests/test_ref_projection.mjs
packages/ops-refs-vault/tests/test_ref_reconcile.mjs
packages/ops-refs-vault/requirements/final-requirements.tsv
packages/ops-refs-vault/requirements/verification-report.md
packages/ops-refs-vault/requirements/verification-summary.json
```

## Decision requested

Review this as the `main`-derived proposal for implementing the already-accepted managed-root scan, path-identity projection, recovery-candidate, and exact-lease design.

If accepted, apply the generated implementation artifact to this branch as source edits, then run the review gates above before merge.
