# ops-refs-vault troubleshooting

## `extra-legacy-schema`

The remote contains an older layout such as:

```text
refs/heads/repos/<repoId>/<branch>
refs/heads/<unversionedRepoId>/<branch>
```

The audit reports it but never deletes it. Decide whether to retain, migrate, or delete it through a separately reviewed operation.

## `unknown-managed-extra`

A ref exists under `refs/heads/*` but cannot be parsed by a current or legacy schema. Stop normal backup. Do not guess its owner from a prefix.

## `remote-ahead-candidate`

The source tip is an ancestor of the remote tip. Use `candidate-plan`; then explicitly adopt, discard, or defer. Normal backup will not overwrite it.

## `diverged-candidate`

Both sides contain unique commits. Direct adoption and normal backup are blocked. Fetch both into an isolated worktree or staging repository, reconcile, and promote the reviewed result through the normal SSOT path.

## exact lease failed

The source or remote changed after observation. Generate a new candidate plan. Never reuse stale OIDs.

## restore fsck or clone test failed

The candidate is not proven restorable. Keep SSOT unchanged and investigate missing objects, partial clones, alternates, or remote transport errors.

## backup preflight blocked

Run `audit` and inspect `counts` and `rows`. Backup never automatically deletes remote-only, legacy, or unknown refs.
