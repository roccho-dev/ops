# generated manifest receipt proof 260619

This proposal proves the backup manifest as a generated run snapshot, not as
SSOT authority.

## Proposal branch

```text
ops.git:proposal/refs-vault-generated-manifest-receipt-260619
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
