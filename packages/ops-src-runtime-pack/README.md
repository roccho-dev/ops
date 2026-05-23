# ops-src-runtime-pack

`ops-src-runtime-pack` creates the payload side of a handoff.

It is intentionally separate from `ops-handoff-core`:

- `ops-src-runtime-pack` builds the source/runtime/policy payload.
- `ops-handoff-core` builds the role-aware handoff directory and per-thread
  bootstrap files.
- `ops-cdp-core` transports the pack to ChatGPT Project Source.

## Create

```sh
ops-src-runtime-pack create \
  --repo-root /home/nixos/repos/ops \
  --package-name ops-handoff-core \
  --installable .#ops-handoff-core \
  --installable .#ops-cdp-core \
  --policy-file /home/nixos/repos/AGENTS.md \
  --policy-file /home/nixos/repos/.agents/transport.md \
  --out-dir /tmp/ops-src-runtime-pack
```

By default the source archive contains tracked Git files only. Use
`--include-untracked` only when the handoff explicitly needs untracked
non-ignored files.

The output includes:

```text
START_HERE.txt
README.md
MANIFEST.json
SRC/source.tar.gz
SRC/working-tree.diff
NIX/flake.lock
NIX/flake-archive.json
NIX/path-info.json
NIX/binary-cache/
POLICY/policy-manifest.json
POLICY/files/*
GATES/nix-build.log
GATES/nix-copy.log
```

`NIX/flake.lock` is included when the source repo has one. If it is absent, the
manifest records `flakeLock.present=false` instead of hiding the absence.

`START_HERE.txt` is the Project Source text entrypoint. It contains a nonce and
small dependency/runtime/policy markers for readback. The archive/cache files are
secondary payloads.

## Validate

```sh
ops-src-runtime-pack validate --pack-dir /tmp/ops-src-runtime-pack
```

Validation checks that required files exist, hashes match, and the local binary
cache exists for full packs.
