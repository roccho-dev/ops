# ops-decision-closure

Bounded executable proof for Issue #115.

```text
immutable facts / conditions / claims JSONL
→ validate
→ SQLite catalog + immutable shards
→ Frozen DuckLake candidate (immutable Parquet + exact DuckDB runtime)
→ same query contract / canonical results
→ Decision Packet
→ static Decision Room
→ receipts
```

The proof intentionally returns `HOLD_JSONL_AUTHORITY_ONLY` when the evidence is insufficient to select one production engine. Generated databases, Parquet, packets, HTML, metrics, and receipts remain non-authoritative projections.
