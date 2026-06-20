# generated manifest receipt proof 260619

This proposal proves the backup manifest as a generated run snapshot, not as
SSOT authority.

## Proposal branch

```text
ops.git:proposal/v-o-follow-refs-backup-env-260621
```

## Local package gates

```text
node --check packages/ops-refs-vault/bin/ops-refs-vault.mjs
ops-refs-vault smoke-local
nix build .#packages.x86_64-linux.ops-refs-vault --no-link --no-write-lock-file
nix build .#checks.x86_64-linux.ops-refs-vault --no-link --no-write-lock-file
```

The smoke proof now includes:

```text
P12 generate-manifest derives a non-authority backup snapshot from the bare root
P13 backup-all can emit a receipt containing the manifest digest and per-ref results
P14 verify-all compares every generated manifest source head with the forge backup hash
P15 orphan-audit rejects missing or extra forge refs relative to the generated snapshot
```

## Current refs-backed proof 260621

This proposal was consolidated with the current refs backup direction:

- no hardcoded forge backup URL in the package
- backup remote selected by `--remote`, manifest `targetForgeRepo`, or
  `OPS_REFS_VAULT_REMOTE`
- destination refs use `refs/heads/<repoId>/<branch>` with no extra `repos/`
  prefix
- `/home/nixos/git/refs.git` is the tested local refs backup store

Ran on `nixos-vm` against the current SSOT bare root:

```text
source bare root: /home/nixos/repos/.bare
local refs backup: /home/nixos/git/refs.git
proof directory: /tmp/refs-backup-proof-260621
manifest repos: 37
backup refs: 262
verify failed: 0
orphan audit: ok
restore proof: adrs, policy, ops, ui, agent-history, jsonlxlsx main restored
```

GitHub `roccho-dev/refs.git` received the new no-prefix refs. A direct
`git push --mirror` was also tested and proved unsafe for this use case because
it deletes remote-only historical refs; do not use mirror push as the publication
path for this package.

## Current SSOT 37-bare proof

Ran on `nixos-vm` against the current SSOT bare root:

```text
source bare root: /home/nixos/repos/.bare
proof directory: /tmp/refs-vault-current-37-formal-260619
forge target: /tmp/refs-vault-current-37-formal-260619/refs.git
```

Commands executed with the proposal package:

```text
generate-manifest --bare-root /home/nixos/repos/.bare --out manifest.json --remote refs.git
inventory --manifest manifest.json --out-dir inventory
backup-all --manifest manifest.json --remote refs.git --receipt-out backup-receipt.json
verify-all --manifest manifest.json --remote refs.git
orphan-audit --manifest manifest.json --remote refs.git
restore-bare-one --manifest manifest.json --remote refs.git --repo-id adrs --branch main --staging-bare staging/adrs.git
```

Observed result:

```text
manifest repos: 37
inventory rows: 221
backup results: 221
backup failed: 0
verify results: 221
verify failed: 0
orphan audit: ok
staging restore adrs/main: ok
local proof vault size: 103M
```

No GitHub/forge refs were written during this proof. The proof writes only to a
temporary local bare vault under `/tmp`.

## Boundary

- The generated manifest is a run snapshot and receipt input.
- The generated manifest is not the repository registry and not SSOT authority.
- `backup-all --force` remains an operator decision outside the normal run.
- `promote-staging-bare --confirm` is not part of backup completion.
