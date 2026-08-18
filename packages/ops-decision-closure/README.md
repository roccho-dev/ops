# ops-decision-closure

Closes the executable and transferable Fact → Decision → Fact contract of Issue #115.

```text
immutable Fact / Condition / Claim JSONL Authority
→ fail-closed validation
→ SQLite-shard and Frozen-DuckLake candidates
→ same canonical query contract
→ one selected read model
→ Decision Packet + static Decision Room
→ five unaccepted human-action candidates
→ decision-economics receipts
→ proof Release + clean-room takeover receipt
```

The selected V1 engine applies only to this decision ledger. It does not replace the existing DuckDB production path or override Issue #90 / PR #91. Databases, Parquet, Packet, HTML, metrics, DD files, Release assets, and receipts remain disposable non-authority projections.

## Measurement boundary

Engine selection uses the exact eight-query contract repeated five times against real GitHub-backed operational records. It does not fabricate or claim production query telemetry; the decision is reopened when production telemetry or the ingress contract changes. G9 is a controlled deterministic replay of three decision families and records canonical evidence bytes, timings, asset counts, reuse provenance, quality gates, and outcomes.

## Selected normal runtime

`bin/query.py` is the normal read-only entry and accepts only `ops.sqliteShardProjection.v1`. It depends on Python standard-library SQLite, requires the expected manifest SHA-256, and verifies a closed set of manifest-declared SQLite assets before query. Duplicate names, path traversal, missing assets, extra files, and content mismatch are rejected. DuckDB remains only in the exact comparison/check path and is not a normal runtime dependency.
