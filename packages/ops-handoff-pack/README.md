# ops-handoff-pack

`ops-handoff-pack` is the glue that issue 003 calls missing. It turns
"repos + branches + request" into a validated, self-contained handoff
directory, deriving everything that used to be hand-written.

It is intentionally layered on top of `ops-handoff-core`:

- `ops-handoff-core` stays a frozen v1 transport shell (role/thread layout,
  existence checks). It is not modified.
- `ops-handoff-pack` derives `source.manifest.v2` / `merge.target.v2` from
  git, builds tracked-files-only source packs, drives `ops-handoff-core`,
  and adds the semantic guarantees the shell does not provide.

## Create

```sh
ops-handoff-pack create \
  --repo board-view=/home/nixos/repos/board-view@main..claude/some-proposal \
  --repo webmcp=/home/nixos/repos/webmcp@main..claude/some-proposal \
  --role-catalog ROLE_CATALOG.md \
  --topology organization-topology.a2ui.jsonl \
  --command-board command-board.a2ui.jsonl \
  --request REQUEST.md \
  --thread-roster thread-roster.json \
  --out-dir /tmp/handoff-out \
  --json
```

`--repo` is `repoId=root@baseBranch[..candidateRef]` (repeatable; candidateRef
defaults to `HEAD`; refs containing `..` are unsupported). For each repo the
tool resolves `baseBranch` and `candidateRef` to full commit hashes via
`git rev-parse` and archives the candidate tree (tracked files only) into
`SRC/<repoId>.tar.gz`.

`create` then:

1. writes `source.manifest.v2` and `merge.target.v2` derived from the same
   rev-parse results (cross-consistent by construction),
2. writes a `src-pack` payload manifest carrying each pack's sha256/bytes,
3. runs `ops-handoff-core generate` + `validate`,
4. embeds the packs under `<out-dir>/handoff/SRC/`,
5. runs its own semantic validation (below).

The result in `<out-dir>/handoff/` is self-contained: zip it and upload.

## Validate

```sh
ops-handoff-pack validate --handoff-dir /tmp/handoff-out/handoff \
  --repo board-view=/home/nixos/repos/board-view
```

Checks beyond `ops-handoff-core validate`:

- digest recomputation: `REQUEST.md`, topology copy, every payload pack, and
  every source pack must match recorded sha256/bytes,
- `source.manifest.v2` / `merge.target.v2` shape (repos arrays, full 40-hex
  heads, `canonicalMergeAuthorized=false`, `pushAuthorized=false`),
- cross-check: merge-target and source-manifest must agree per repo on
  `baseBranch` and `baseHead`,
- stub payloads are rejected (`--allow-stub` only for transport proofs),
- optional live re-verification: `--repo repoId=root` re-resolves the base
  branch and fails on drift since pack creation.

## Boundary

`handoff-pack-valid` proves transport integrity and target clarity. It is not
semantic approval, completion approval, merge authorization, or push
authorization. Runbook: `runbooks/handoff.md`.

## Issue traceability

- `ops/issues/003-end-to-end-handoff-generator.md`
- `ops/issues/004-src-pack-offline-nix-cache-payload.md`
