# Issues #114 / #115 current-thread executable proof

## Verdict

`PASS_EXECUTABLE_SCOPE`

This proof incorporates Issue #117 as the exact-byte ingress prerequisite. It does not treat direct Release download as mandatory.

| Scope | Result |
|---|---|
| #117 Release → Actions artifact → active sandbox replay | PASS |
| Exact `proposals` base | `59457a5667488da34d4ba977fa32c3a101a4a38e` |
| Exact-base artifact | ID `9306467781`, SHA-256 `61738286…eee9c0` |
| DuckDB artifact | ID `9306467628`, SHA-256 `bd7ff157…26cbe0` |
| DuckDB payload | SHA-256 `3d33b1df…55788` |
| #114 local prepare / verify | PASS |
| #114 unchanged tracked base blob | 24 MiB; not included in effect plan |
| #114 fail-closed cases | 7 PASS |
| #114 Connector branch/file/draft-PR effect | PASS via PR #118 |
| #114 raw blob/tree/commit/ref sequence | separate live sequence still required for Issue #114 terminal close |
| #115 authority types | Fact / Condition / Claim only |
| #115 projections compared | raw JSONL, one SQLite, SQLite shards, immutable Parquet + DuckDB |
| #115 canonical queries | 8 |
| #115 semantic mismatches | 0 |
| #115 fail-closed mismatches | 0 |
| #115 negative cases | 43 PASS |
| Decision Packet / static Decision Room | PASS; same canonical meaning digest |
| Direct UI write to Authority | 0; actions emit unaccepted JSONL candidates |

## Correct terminal states

```text
#114 local core
= PASS

#114 Connector contents effect
= PASS

#114 raw Git object adapter
= PENDING_LIVE_OBJECT_SEQUENCE

#115 L1 semantic parity
= PASS

#115 engine selection
= BLOCKED_REAL_DATA_LOCALITY

#115 L2 Human/AI contract
= PASS_LOCAL_CONTRACT

#115 G9
= HOLD_INSUFFICIENT_ECONOMIC_BASELINE

#115 G10
= BLOCKED_INDEPENDENT_OPERATOR_REQUIRED
```

The result does not authorize merge, production engine selection, public proof Release, existing DuckDB replacement, or issue closure beyond the terminal states above.
