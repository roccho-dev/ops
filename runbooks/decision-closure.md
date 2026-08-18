# Decision closure runbook

## Boundary

```text
Authority
  Git accepted immutable JSONL segments

Projection
  catalog.sqlite + immutable domain shards

Public checkpoint
  exact-tag GitHub Release

Human view
  static Decision Packet / Decision Room

Write admission
  ops-git-write-closure → proposal branch → PR → accepted merge
```

Release, SQLite, Parquet, DuckDB, HTML and receipts are not meaning Authority.

## 1. Verify Authority

```text
ops-decision-closure verify --root <accepted-worktree> --out authority.receipt.json
```

Stop on duplicate ID, stream/type mismatch, missing source evidence, dangling relation, dependency cycle, unresolved contradiction, incomplete Decision, or public private-data record.

## 2. Build the selected checkpoint

```text
ops-decision-closure build \
  --root <accepted-worktree> \
  --out <checkpoint-dir> \
  --checkpoint-id <content-addressed-id> \
  --parent-checkpoint-id <optional-parent>
```

Normal runtime is one SQLite catalog plus immutable domain shards. Every asset is content-checked and opened with `mode=ro&immutable=1`. Runtime write, network install and secret use are forbidden.

## 3. Query

Use only the names in `decision-ledger/query-contract/v1.json`:

```text
current_decisions
trace_decision
impact_by_fact
missing_outcomes
unresolved_conflicts
research_gaps
decision_timeline
full_history_aggregate
```

Inputs, ordering and canonical JSON are engine-neutral. A result digest mismatch is not Green.

## 4. Generate the human/AI contract

```text
ops-decision-closure packet \
  --checkpoint <checkpoint-dir> \
  --decision-id <id> \
  --out <packet-dir>
```

The packet and static room must identify one checkpoint and one Decision. JavaScript, Wasm, SQL and a database explorer are not required for the main view.

## 5. Human action

```text
ops-decision-closure action \
  --packet decision-packet.json \
  --action ADOPT|HOLD|REJECT|RESEARCH|CHANGE_CONDITIONS_AND_REEVALUATE \
  --actor <actor-id> \
  --at <timestamp> \
  --out candidate.jsonl
```

The output is `accepted=false`. It is not current state until the normal Git branch, check, PR and accepted-merge path succeeds.

## 6. Release proof

A production checkpoint job may run only after explicit owner authorization. It must:

1. pin the accepted commit and tree;
2. verify Authority;
3. rebuild the selected projection cleanly;
4. regenerate Decision Packets and the static room;
5. create an exact immutable-by-name Release;
6. download every public asset independently;
7. compare bytes and SHA-256;
8. rerun all named queries from the downloaded checkpoint;
9. reject `latest`, checkpoint mixing, missing assets and writer-response-only success.

No Cloudflare deployment, DuckDB replacement, live multiwriter, secret database, or customer-private data is authorized by this runbook.

## 7. Independent takeover

A clean runner with no Chat history, owner explanation, local worktree or runtime secret must use only the accepted repository and exact Release. It restores/rebuilds the checkpoint, replays an old checkpoint, explains the current Decision from the static room, adds a synthetic Fact in an isolated branch/worktree, runs `impact_by_fact`, creates a next-checkpoint candidate, serves the same room through local HTTP, and emits one receipt.

Owner intervention, undocumented steps or secrets make the run invalid.

## Terminal states

```text
PASS_SQLITE_SHARDS
PASS_FROZEN_DUCKLAKE
BLOCKED_SEMANTIC_PARITY
BLOCKED_FAIL_CLOSED_PARITY
BLOCKED_INCREMENTAL_REPLAY
BLOCKED_RELEASE_READBACK
BLOCKED_PUBLIC_DATA_POLICY
HOLD_INSUFFICIENT_ECONOMIC_BASELINE
BLOCKED_HUMAN_ADOPTION
BLOCKED_INDEPENDENT_OPERATOR_REQUIRED
PASS_META_PURPOSE_READINESS
```
