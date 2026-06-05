# ops-portable-runtime-pack implementation proposal

## Purpose

Add the first implementation slice for `ops-portable-runtime-pack`.

The implementation creates and validates compact Linux x86-64 portable runtime
payloads from explicit tool specs.

## Added surface

- `packages/ops-portable-runtime-pack/bin/ops-portable-runtime-pack.py`
- `packages/ops-portable-runtime-pack/README.md`
- `packages/ops-portable-runtime-pack/tests/test_ops_portable_runtime_pack.py`
- `packages.x86_64-linux.ops-portable-runtime-pack`
- `checks.x86_64-linux.ops-portable-runtime-pack`

## Current behavior

The CLI supports:

- `create --target-system x86_64-linux --tool-spec <json> --out-dir <dir>`
- `validate --pack-dir <dir>`

It writes:

- `MANIFEST.json`
- `START_HERE.txt`
- `bin/<tool>`
- `bin/<tool>.real`

The implementation intentionally requires explicit tool specs. It does not
guess plugin paths or claim full ELF closure completeness yet.

## Handoff generation proof

The package check creates a fixture portable runtime pack, validates it, then
passes its `MANIFEST.json` to `ops-handoff-core generate` as
`--runtime-manifest`. It then validates the generated handoff.

This proves that the new runtime payload shape can be consumed by the existing
handoff generator.

Gate result:

```text
nix build .#checks.x86_64-linux.ops-portable-runtime-pack --no-write-lock-file --print-out-paths
/nix/store/rl7n4qsbg3v5sqjsi5819jqih1bl0li5-ops-portable-runtime-pack-check
```

## Non-goals

This proposal does not implement Project Source upload, ChatGPT thread
creation, artifact fetch, source archive generation, Nix binary cache creation,
merge approval, push, or completion approval.
