# Issue 004: Src Pack + Offline Nix Cache payload

## Status

Not integrated. This is the preferred payload format for robust handoff, but current ops packages do not produce it as a standard artifact.

## ops responsibility

`repos/ops` should implement the pack builder and verification tooling.

`repos/specs` should define the package contract and expected manifest shape.

## Problem

Project Source handoff can deliver files, but handoff recipients may lack live repo access or the exact runtime environment. A handoff should be able to carry enough source and Nix closure material for offline read, build, test, and review.

## Proposed payload

```text
src-runtime-pack/
  README.md
  MANIFEST.json
  SRC/
    src.tar.zst
    upstream.bundle
    candidate.patch
  NIX/
    flake.lock
    flake-archive/
    binary-cache/
  GATES/
    eval.log
    check.log
  EVIDENCE/
    heads.json
    hashes.json
    RUN_REPORT.md
```

## Manifest fields

Minimum `MANIFEST.json` fields:

- package name and version
- repoId
- source head
- upstream/base head
- candidate head or patch hash
- flake.lock hash
- flake archive path
- binary cache path
- store paths
- closure size
- system/platform
- Nix version
- generated command
- verify command
- gate logs

## Desired behavior

The pack builder should support:

- source archive creation
- git bundle or patch creation
- flake.lock inclusion
- `nix flake archive` material
- local `file://` binary cache
- `nix copy` closure export where applicable
- manifest generation
- offline verification command

## Acceptance criteria

- A single command creates `src-runtime-pack/`.
- A verifier can run without network and prove expected files, hashes, and Nix metadata exist.
- Pack contains a one-page README with restore/build/test/run entrypoint.
- Pack does not imply semantic approval, merge-ready, or completion.
- Pack can be used as payload by the end-to-end handoff generator.

## Non-goals

- No VM image.
- No OCI image unless a separate package contract is approved.
- No binary-only handoff as the default.
- No source secrecy guarantee; this format is for readable source handoff.

## Update 2026-06-12

Partial integration via `ops-handoff-pack`: handoffs now standardly carry a
`src-pack` payload (per-repo `SRC/<repoId>.tar.gz`, sha256/bytes pinned in the
payload manifest and recomputed at validate; stub payloads are rejected for
delegation). The NIX side of this issue (flake archive / binary cache, as
built by `ops-src-runtime-pack`) is still not folded into the standard handoff
payload. Note: this issue names `repos/specs` as the contract home; specs is
being deleted — the v2 manifest shapes are currently enforced in-code by
`ops-handoff-pack validate`, and external contract placement (governance) is a
follow-up decision recorded in the adrs proposal 260612-handoff-pack-glue.
