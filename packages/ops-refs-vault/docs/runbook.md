# ops-refs-vault runbook

`ops-refs-vault` backs up repo-specific bare SSOT repositories into one
replaceable forge repository by namespaced refs.

## Canonical route

```text
local working clone
  -> git push or rsync
  -> nixos-vm:$HOME/repos/.bare/<repoId>.git
  -> ops-refs-vault backup-one / backup-all
  -> $OPS_REFS_VAULT_REMOTE refs/heads/<repoId>/<branch>
```

Roles:

| role | location |
|---|---|
| SSOT | `nixos-vm:$HOME/repos/.bare/<repoId>.git` repo-specific bare repo |
| backup | single forge repo selected by `--remote`, manifest `targetForgeRepo`, or `OPS_REFS_VAULT_REMOTE` |
| local | temporary workspace or working clone |
| local -> SSOT | `git push` or `rsync`, outside this package's approval boundary |
| SSOT -> backup | namespaced refs via this package |

GitHub is backup, not SSOT. Dirty files, untracked files, ignored files,
secrets, and build caches are not protected by this Git backup route.

## Manifest

The manifest used for a production backup run is a generated receipt
snapshot, not the authority for which repositories should exist. Authority
remains the repo-specific bare SSOT registry/root. Until a root-owned registry
exists, generate the manifest from the current bare root immediately before the
backup run and preserve it with the backup receipt.

```json
{
  "kind": "ops.refsVault.generatedManifest.v1",
  "authority": "filesystem-snapshot-not-ssot-authority",
  "targetForgeRepo": {},
  "source": {
    "bareRoot": "/home/nixos/repos/.bare",
    "excludeFile": null,
    "excludedRepoIds": []
  },
  "repos": [
    {
      "repoId": "specs",
      "sourceBarePath": "/home/nixos/repos/.bare/specs.git"
    }
  ]
}
```

When running on `nixos-vm`, `sourceBarePath` is normally
`$HOME/repos/.bare/<repoId>.git`. A remote source URL is allowed, but the
normal operator route is to run on the host where the bare SSOT paths are local.

Generate a snapshot manifest from the bare root:

```bash
export OPS_REFS_VAULT_REMOTE=git@github.com:OWNER/refs.git

ops-refs-vault generate-manifest \
  --bare-root /home/nixos/repos/.bare \
  --out /var/lib/ssot/refs-vault/runs/20260619/manifest.json
```

Use `--exclude-file` only for intentional opt-out repository IDs. The exclude
file is one repo ID per line and is validated against the discovered bare root.

## Back up

```bash
export OPS_REFS_VAULT_REMOTE=git@github.com:OWNER/refs.git

ops-refs-vault backup-one \
  --manifest refs-vault.manifest.json \
  --repo-id specs \
  --branch main

ops-refs-vault backup-all \
  --manifest /var/lib/ssot/refs-vault/runs/20260619/manifest.json \
  --receipt-out /var/lib/ssot/refs-vault/runs/20260619/backup-receipt.json
```

The destination branch is:

```text
refs/heads/<repoId>/<branch>
```

Default backup is no-force. Use `--force` only after an operator decision.
Do not combine backup with restore promotion in the same run.

Do not publish the refs backup with `git push --mirror`. The refs repository
may contain remote-only historical refs that are outside the generated current
snapshot, and mirror push would delete them. Use this package's `backup-all`
route, or explicit non-delete refspecs, so backup publication never removes
unrelated remote refs.

## Verify and audit

```bash
ops-refs-vault verify-all \
  --manifest /var/lib/ssot/refs-vault/runs/20260619/manifest.json

ops-refs-vault orphan-audit \
  --manifest /var/lib/ssot/refs-vault/runs/20260619/manifest.json

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
`verify-all` applies that comparison to every branch in the generated
manifest. `orphan-audit` fails if the forge has missing or extra
`refs/heads/<repoId>/<branch>` refs relative to the generated snapshot.

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
  --target-bare "$HOME/repos/.bare/specs.git" \
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
