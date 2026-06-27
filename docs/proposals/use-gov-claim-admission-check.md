# Use governance claim admission checker proposal

## Why

`ops` currently has a local staged real-claim admission check. That was useful to surface real input drift quickly, but duplicated governance admission logic should not remain in the feat repo long term.

## Decision

Move ops toward calling a governance-exported claim admission checker.

Ops should keep only repo-local adapters:

- `spec/implements.json` to downstream assertion port
- current CI/build evidence to receipt port
- ADRS-derived upstream grants as an input file

Governance should own:

- admission join logic
- `diagnosticClass` mapping
- official-view gate compatibility

## Dependency

Depends on governance exporting a stable claim admission checker surface.

## Boundary

This PR does not remove the staged-warning check yet. It records the cutover requirement and merge gate for replacing local join logic once governance export exists.

## Merge gate

Merge only after the ops check can call the governance checker without losing the current staged diagnostics.
