# ops-refs-vault runbook

`ops-refs-vault` backs up repo-specific bare SSOT repositories into one
replaceable forge repository by namespaced refs.

## Canonical route

```text
local working clone
  -> git push or rsync
  -> nixos-vm:$HOME/repos/<repoId>.git
  -> ops-refs-vault backup-one / backup-all
  -> git@github.com:roccho-dev/refs.git refs/heads/repos/<repoId>/<branch>
```

Roles:

| role | location |
|---|---|
| SSOT | `nixos-vm:$HOME/repos/<repoId>.git` repo-specific bare repo |
| backup | single forge repo, normally `git@github.com:roccho-dev/refs.git` |
| local | temporary workspace or working clone |
| local -> SSOT | `git push` or `rsync`, outside this package's approval boundary |
| SSOT -> backup | namespaced refs via this package |

GitHub is backup, not SSOT. Dirty files, untracked files, ignored files,
secrets, and build caches are not protected by this Git backup route.

## Manifest

```json
{
  "targetForgeRepo": {
    "sshUrl": "git@github.com:roccho-dev/refs.git"
  },
  "repos": [
    {
      "repoId": "specs",
      "sourceBarePath": "/home/nixos/repos/specs.git"
    }
  ]
}
```

When running on `nixos-vm`, `sourceBarePath` is normally
`$HOME/repos/<repoId>.git`. A remote source URL is allowed, but the normal
operator route is to run on the host where the bare SSOT paths are local.

## Back up

```bash
ops-refs-vault backup-one \
  --manifest refs-vault.manifest.json \
  --repo-id specs \
  --branch main

ops-refs-vault backup-all \
  --manifest refs-vault.manifest.json
```

The destination branch is:

```text
refs/heads/repos/<repoId>/<branch>
```

Default backup is no-force. Use `--force` only after an operator decision.

## Verify and audit

```bash
ops-refs-vault verify-one \
  --manifest refs-vault.manifest.json \
  --repo-id specs \
  --branch main

ops-refs-vault audit \
  --manifest refs-vault.manifest.json

ops-refs-vault inventory \
  --manifest refs-vault.manifest.json \
  --out-dir /tmp/refs-vault-inventory
```

`verify-one` compares the bare SSOT branch hash with the forge backup hash.

## Restore

Restore always writes to a staging bare repo first.

```bash
ops-refs-vault restore-bare-one \
  --manifest refs-vault.manifest.json \
  --repo-id specs \
  --branch main \
  --staging-bare /tmp/restored/specs.git
```

Promotion into the SSOT location is a separate approved step:

```bash
ops-refs-vault promote-staging-bare \
  --repo-id specs \
  --staging-bare /tmp/restored/specs.git \
  --target-bare "$HOME/repos/specs.git" \
  --confirm
```

Missing branch restore fails. It does not fall back to `main` or the first
available branch.

## Smoke

```bash
ops-refs-vault smoke-local
```

The smoke test creates local bare SSOT repos, backs them up to a local bare
forge repo, restores one branch to staging, promotes it into a target bare repo,
and checks hash equality.
