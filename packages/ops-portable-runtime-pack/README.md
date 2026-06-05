# ops-portable-runtime-pack

`ops-portable-runtime-pack` creates a compact runtime payload for selected
Linux x86-64 command-line tools.

It is intentionally separate from `ops-src-runtime-pack`:

- `ops-portable-runtime-pack` bundles selected executables, declared runtime
  files, wrapper environment, smoke checks, and a runtime manifest.
- `ops-src-runtime-pack` bundles editable source plus Nix metadata and optional
  local binary cache.
- `ops-handoff-core` consumes this package's `MANIFEST.json` as a runtime
  manifest when generating role-aware handoff directories.

## Create

```sh
ops-portable-runtime-pack create \
  --target-system x86_64-linux \
  --tool-spec tool.json \
  --out-dir /tmp/portable-runtime
```

Tool specs are explicit. The tool does not guess plugin paths or claim runtime
completeness without evidence.

## Validate

```sh
ops-portable-runtime-pack validate --pack-dir /tmp/portable-runtime
```
