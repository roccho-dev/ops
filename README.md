# ops

Operational packages for the canonical-core checkout.

## Authority boundary

`ops` implements and validates governance contracts; it is not the package/build authority itself. Final package/build authority is the JSONL record set under:

- `governance-records-main/records/specs/package-contract.v1.jsonl`
- `governance-records-main/records/specs/dependency-edge.v1.jsonl`
- `governance-records-main/records/specs/projection-digest.v1.jsonl`

Generated projections are replay evidence only. Final checks must be able to derive feat inputs from records when `governance-records-main/generated/` is absent.

The historical `spec` repository is retained as design context and skeleton history only. It is not an active package/build authority in final mode, and the retired `specs-main` alias is forbidden by `ops/workspace/aliases.v1.json`.

## Workspace replay

Materialize or check canonical aliases with:

```sh
python3 ops/workspace/materialize-aliases.py --root .
python3 ops/workspace/materialize-aliases.py --root . --check
```

Workspace-level CI entrypoints live under `ci/`, materialized as a symlink to `ops/ci/`. Required command paths must be executable from the checkout root.

## External tool boundary

`nix` and `qjs` validations are real external runtime gates. This repository records preflight/tool availability; it does not mark those gates as passed when the tool is missing from the sandbox.
