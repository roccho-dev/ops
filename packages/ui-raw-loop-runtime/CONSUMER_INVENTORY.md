# Initial consumer inventory

Inventory for `ops#374`, frozen before the semantic-log HTTP/Caddy cutover.

## Exact refs searched

| Repository | Ref |
|---|---|
| `roccho-dev/ops` | `proposals@7da6dc51cd53bb807447f4db053f7b1d31a7f0db` |
| `roccho-dev/ui` | `proposals@59ba7c0370de72a790c8828994d5b726ce4cd944` |

Search terms:

```text
/api/raw
owner.raw.input.v1
/read-model
ui-raw-loop-runtime
```

## Current executable consumers

| Surface | Exact consumers found |
|---|---|
| `POST /api/raw` | `lib/core.mjs`; package-local `tests/e2e.mjs` |
| `owner.raw.input.v1` | `lib/core.mjs`; package-local `tests/e2e.mjs` |
| `GET /read-model` | `lib/core.mjs`; package-local `tests/e2e.mjs` |
| `ui-raw-loop-runtime` binary | `build/packages.jsonl`; `build/checks.jsonl`; package-local test |

The OPS repository also contains README and historical evidence references.
No executable reference to `/api/raw`, `owner.raw.input.v1`, or `/read-model`
was found on the UI repository's exact default-branch ref.

## Decision for the initial PR

This inventory is enough to start the pure semantic/local core, but not enough
to delete or rename the active package surface. The initial PR therefore:

- keeps the existing package path and Node endpoint unchanged;
- introduces no second HTTP server;
- does not update `build/packages.jsonl` or the existing Node check;
- adds one independent Go/Nix core check only.

The next Caddy cutover phase in this same PR must re-run the inventory against
then-current exact refs and atomically handle the package registry, check
registry, UI wire contract, endpoint replacement, and Node retirement.
Deployment/runtime search outside these repositories remains a separate ENVS
proof; absence from code search is not treated as proof of absence from a
running host.
