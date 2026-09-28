# Research Decision Stack Carry — Final Shape (temporary implementation contract)

> Temporary implementation contract. This file must exist in commit history while the change is built and must be deleted from the final PR tree after every invariant below is represented by executable code, profile data, tests, CI, and receipts.

## 1. Goal

Make one accepted Ops commit sufficient to reproduce and carry the complete research decision stack without package discovery, host-runtime substitution, or a repository checkout on the consumer runner.

The terminal path is:

```text
exact accepted Git commit
→ all producer checks PASS
→ profile-scoped full source/runtime pack
→ deterministic single Carrier + canonical Base64 + receipts
→ new runner with no checkout
→ Carrier validation and extraction
→ carried Nix binary-cache import
→ all clean-room commands PASS using carried runtimes
→ immutable commit-specific GitHub Release
→ authenticated and public byte-for-byte readback
→ latest-verified pointer moves to the exact commit
```

The mutable pointer must never move before all prior stages pass.

## 2. Authority and projection boundary

| Item | Role |
|---|---|
| Git commit and tracked JSONL/source | Authority |
| carry profile row | Checked-in declaration of the exact carry closure |
| SQLite/HTML/read models | Regenerable projection |
| source/runtime pack | Transport projection |
| Carrier/Base64 | Transport projection |
| producer/clean-room/publication receipts | Evidence only |
| immutable GitHub Release | Provider projection of one exact accepted commit |
| `research-decision-stack-latest-verified` | Mutable convenience pointer; never semantic authority |

The workflow must not convert GitHub Actions, a Release, a receipt, SQLite, or HTML into semantic, completion, review, merge, or route authority.

## 3. Exact domain closure

The carry profile `research-decision-stack` contains exactly these three domain components:

| Component | Responsibility |
|---|---|
| `ops-decision-closure` | Immutable Fact/Condition/Claim validation, SQLite projection, decision queries, decision packets/rooms, and clean-room decision closure |
| `hq-source-evidence-runtime` | External source observations and deterministic evidence-only receipts |
| `model-source-reconcile` | Model-claim versus source-observation reconciliation and read projection |

`ops-src-runtime-pack` is the reusable pack/Carrier/validation mechanism. It is carried because the clean room must validate its own payload, but it is not a fourth research-domain component.

## 4. Carry profile contract

One append-only row of kind `ops.srcRuntimePack.profile.v1` must close every input that would otherwise require human discovery:

- stable profile ID and package name;
- component names and responsibility labels;
- canonical repo-relative source paths;
- exact Nix installables;
- exact locked-nixpkgs runtime attributes;
- target Nix system;
- every producer check;
- every clean-room command;
- public entrypoints;
- immutable Release tag prefix;
- mutable verified-pointer tag name;
- `reproducible: true`.

Profile validation is fail-closed for duplicate IDs, unsupported kinds, unsafe paths, missing source selections, duplicate entries, invalid runtimes, invalid commands, invalid release/pointer names, and a non-reproducible declaration.

The concrete profile must select only:

```text
packages/ops-decision-closure/**
packages/hq-source-evidence-runtime/**
packages/model-source-reconcile/**
packages/ops-src-runtime-pack/**
```

No root-wide fallback is permitted once a profile is selected.

## 5. Producer checks

The producer stage must run all seven checks resolved from the profile, not a hand-maintained workflow list:

1. `ops-src-runtime-pack`
2. `ops-decision-closure`
3. `ops-decision-closure-world-core`
4. `hq-source-evidence-runtime-validator`
5. `hq-source-evidence-runtime-receipt-writer`
6. `model-source-reconcile-checker`
7. `model-source-reconcile-projection`

Each check is built as `.#checks.x86_64-linux.<name>`. Any missing, failed, skipped, or duplicated check blocks packing and therefore blocks publication and pointer movement.

`PRODUCER-RECEIPT.json` must bind:

- exact commit and tree;
- profile ID and profile-row SHA-256;
- all seven check commands/results/log identities;
- pack manifest identity;
- Carrier manifest/receipt identities;
- bootstrap script identities;
- `publication.pointerUpdated=false`.

## 6. Scoped full pack

The full pack must contain:

```text
START_HERE.txt
README.md
MANIFEST.json
SRC/source.tar.gz
SRC/working-tree.diff
SRC/staged.diff
NIX/flake.lock
NIX/flake-archive.json
NIX/path-info.json
NIX/binary-cache/**
POLICY/policy-manifest.json
POLICY/files/**
GATES/**
```

For reproducible profile packs:

- the producer worktree is clean;
- tracked files alone are selected;
- every declared source path selects at least one tracked file;
- all selected files have canonical relative paths;
- TAR member ordering, ownership, mode normalization, and GZIP timestamp are deterministic;
- manifest time/nonce inputs derive from the exact commit rather than wall-clock time;
- the source inventory records exact type, mode, bytes, and SHA-256;
- pack validation compares the actual archive member set and hashes against the manifest;
- no source path outside the profile is present.

The Nix binary cache must include the closure of all three component installables plus the runtime attributes `nodejs`, `python3`, `duckdb`, and `git`, all resolved from the repository's locked `nixpkgs` input for `x86_64-linux`.

## 7. Canonical Carrier

The single Carrier must be deterministic and contain only stable consumer payload:

```text
START_HERE.txt
README.md
MANIFEST.json
SRC/**
NIX/**
POLICY/**
```

Producer logs under `GATES/` stay outside the canonical Carrier. The Carrier directory contains:

```text
research-decision-stack.pack.tar.gz
research-decision-stack.pack.tar.gz.b64.txt
CARRIER-MANIFEST.json
CARRIER-RECEIPT.json
```

Carrier validation must fail closed on:

- archive SHA/byte mismatch;
- Base64 SHA/byte mismatch;
- non-canonical Base64 or decode mismatch;
- unsafe/traversing/absolute paths;
- duplicate archive members;
- unexpected or missing inner assets;
- inner asset SHA/byte/type mismatch;
- extracted pack manifest or source-inventory mismatch.

Creating the same Carrier twice from the same exact pack must produce byte-identical archive and Base64 files.

## 8. Clean-room runner

The clean-room job starts on a different runner and must not check out the repository.

It receives only the producer handoff artifact and must prove:

- `$GITHUB_WORKSPACE/.git` is absent;
- the handoff itself contains no `.git` directory;
- the bootstrap scripts match the hashes recorded by the producer receipt;
- the Carrier is revalidated before extraction;
- the exact commit/tree/profile/Carrier identities match the producer receipt;
- all carried store paths are imported from `NIX/binary-cache`;
- the runner's preinstalled Nix and Python are used only as the minimal bootstrap to validate/extract the Carrier and import its cache;
- after import, the Carrier is revalidated with the carried Python;
- all domain/test Node, Python, DuckDB, and Git executables are taken from the carried runtime store paths;
- no host-global substitution is used for domain/test runtimes;
- `SRC/source.tar.gz` is extracted safely;
- the extracted source has no Git metadata;
- all commands below pass.

Exact clean-room commands:

1. `node packages/ops-decision-closure/tests/final-e2e.mjs`
2. `node packages/ops-decision-closure/tests/world-core.mjs`
3. `node packages/hq-source-evidence-runtime/tests/source-validator.mjs`
4. `node packages/hq-source-evidence-runtime/tests/source-receipt-writer.mjs`
5. `node packages/model-source-reconcile/tests/reconcile-checker.mjs`
6. `node packages/model-source-reconcile/tests/reconcile-projection.mjs`

`CLEAN-ROOM-RECEIPT.json` must bind the producer receipt SHA-256, exact source identity, imported cache identity, carried runtime paths, all six command results/log hashes, and the fresh-runner/no-checkout assertions.

## 9. Event and permission boundary

| Event | Allowed stages | GitHub write effect |
|---|---|---|
| Pull request targeting `proposals` | producer checks → pack → Carrier → fresh clean-room rerun | None |
| `workflow_dispatch` on any ref | producer checks → pack → Carrier → fresh clean-room rerun | None |
| Push to accepted `proposals` | all prior stages, then publication | Immutable Release and verified-pointer tag only |
| Any failure | stops at the failing stage | Pointer unchanged |

Top-level workflow permissions are `contents: read`. Only the final `publish` job receives `contents: write`, and its job-level condition is exactly:

```text
github.event_name == 'push' && github.ref == 'refs/heads/proposals'
```

Path filters cover the workflow, CI intent, flake/check declarations, carrier package, and all three domain packages.

## 10. Publication algorithm

The accepted-push publication stage must:

1. download only the verified handoff emitted by the clean-room job;
2. verify candidate commit equals `GITHUB_SHA`;
3. generate `LATEST-VERIFIED.json` from bound producer and clean-room receipts;
4. derive immutable tag `research-decision-stack-<40-hex-commit>`;
5. create the Release as a draft with the exact target commit and complete expected asset set, or validate an identical existing Release;
6. validate tag target, Release target, and exact asset-name set;
7. download every asset through authenticated GitHub APIs and compare SHA-256;
8. publish the draft Release;
9. download every asset through the public Release URL and compare SHA-256;
10. only after all public readbacks pass, create or atomically force-update the lightweight tag `research-decision-stack-latest-verified` to the exact commit;
11. read the pointer back and require it resolves to the exact commit;
12. emit `POINTER-UPDATE-RECEIPT.json` with previous/target commit and asset identities.

A partial, mismatched, or stale existing immutable Release fails closed. It is never silently overwritten. Pointer movement is the final mutation.

## 11. Failure matrix

| Failure | Required result |
|---|---|
| Profile malformed or incomplete | No producer receipt, no publication |
| Worktree dirty | No pack |
| Any producer check fails | No pack/Carrier |
| Pack/source inventory mismatch | Carrier rejected |
| Carrier/Base64 tampered | Clean room rejects before execution |
| Bootstrap hash mismatch | Clean room rejects |
| Runtime closure missing/import fails | Clean room rejects |
| Any clean-room command fails | No verified handoff |
| PR or manual dispatch | Publish job skipped |
| Release target/assets mismatch | Pointer unchanged |
| Authenticated readback mismatch | Pointer unchanged |
| Public readback mismatch | Pointer unchanged |
| Pointer update/readback mismatch | Workflow fails; no PASS receipt |

The previous verified pointer remains usable after every pre-pointer failure.

## 12. Tests and acceptance criteria

Static/unit behavior must prove:

- legacy single-package create/validate still works;
- missing `flake.lock` remains explicit rather than hidden;
- profile resolution returns the intended exact three components;
- source scoping excludes unrelated tracked files;
- repeated profile packs are byte-identical;
- manifest binds check/runtime/command/profile identity;
- repeated Carriers are byte-identical;
- Carrier extraction and inner validation pass;
- tampered Base64 is rejected;
- unsafe profile paths are rejected;
- publication records bind producer/clean-room/Carrier receipts and derive exact tag/pointer names;
- CI intent trigger and push-branch declaration match the workflow.

PR definition of done:

```text
producer seven checks PASS
AND full scoped pack/Carrier PASS
AND fresh no-checkout clean-room six commands PASS
AND PR has no GitHub publication write
```

Accepted-push definition of done:

```text
PR definition of done
AND immutable Release exact asset readback PASS
AND public byte readback PASS
AND latest-verified resolves to exact accepted commit
AND pointer-update receipt PASS
```

## 13. Final tree requirement

This document is intentionally temporary. It must be deleted after the implementation, checked-in profile, tests, README, workflow, and CI intent encode the complete contract. Its add/delete commits remain in history as the implementation plan and closure proof; the final source tree contains no WIP specification authority.
