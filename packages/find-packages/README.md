# find-packages

Provisional package-home for the `find-packages` skill, CLI, reusable core, and DuckDB read-model templates.

This placement is intentionally temporary and follows the current repo convention of colocating package docs and implementation. The accepted direction is to define a `package.documentationSurface.v1` IR first, then generate or validate `SKILL.md`, README, CLI help, and man-style surfaces from that IR.

## Boundary

- `SKILL.md` is a thin discovery header/stub, not authority.
- `lib/find-packages-core.mjs` is the reusable search implementation.
- `bin/find-packages.mjs` is the CLI adapter.
- `sql/*.duckdb.sql` are read-model templates, not package truth.
- `adrs.git` owns the decision proposal for the documentation-surface IR.
- `eligible` and `missingGoalNonGoal` are projection fields from `adrs`.
- `find-packages --require-eligible` filters out `eligible=false` rows and exits non-zero when no eligible match remains.
- This is a discovery/consume gate for package reuse, not an approval to merge or fire work.
