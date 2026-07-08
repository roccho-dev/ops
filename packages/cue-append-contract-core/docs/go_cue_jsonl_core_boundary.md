# Go + CUE + JSONL core boundary

P11 fixes the package direction without changing the P0-P10 proof behavior.

- Core: Go packages plus `contracts/meta.cue` and canonical JSONL ledgers.
- Contract source: `contract.jsonl` style append-only ledgers checked by CUE/Go.
- TypeScript: optional static-check adapter for generated accessors/projections.
- JSON Schema: generated exchange/export adapter, not a second authority.
- Python: proof/helper runner under `proof/python`, not core.
- DuckDB: projection/read/scale adapter, not P0 admission or authority core.
- Generated scopes: `generated/core`, `generated/projections`, `generated/cache`.

The rule is: schema/type/compiler checks catch structural breakage first; only
receipt, authority, source/raw/extraction, lineage, and retention boundaries get
thin custom glue.
