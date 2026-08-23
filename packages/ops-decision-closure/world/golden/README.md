# Canonical research-ledger golden

Aliases:

```text
調査基盤
調査台帳
research ledger
world log
```

This is the only user-facing golden for accumulating research. Extra fixtures are tests, not alternative instructions.

## Fresh-chat request

Use `request.txt` as the complete request. It intentionally names no package path. Discovery must resolve the request to this package and this guide.

## What is fixed

```text
source JSONL
→ schema-specific mapper
→ item + claim
→ identity / relation / unit / scale
→ source-line mapping receipt
→ read-only SQLite views
→ verification receipt
```

The authoring schema may vary by domain. This golden uses the existing reversible Fact / Condition / Claim mapper because it is the smallest proven source format.

## Input

| File | Use |
|---|---|
| `input/facts.jsonl` | Confirmed observations, executions, and outcomes |
| `input/conditions.jsonl` | Scope, goals, constraints, thresholds, and freshness |
| `input/claims.jsonl` | Inferences, proposals, decisions, supersession, contradiction, and dependencies |

Rules:

1. Append new rows; do not edit or delete prior rows.
2. Give every row a stable `id`.
3. Keep source, observation time, and record time distinct.
4. Use `rel[]` for explicit support, contradiction, replacement, dependency, and result links.
5. Do not force a domain fact into this source shape when its meaning differs. Add or select a mapper instead.
6. Do not write generated `item`, `claim`, SQLite, or view rows back as source authority.

## Execute

From the repository root:

```text
python3 packages/ops-decision-closure/bin/world-core.py from-fcc \
  --facts packages/ops-decision-closure/world/golden/input/facts.jsonl \
  --conditions packages/ops-decision-closure/world/golden/input/conditions.jsonl \
  --claims packages/ops-decision-closure/world/golden/input/claims.jsonl \
  --out-dir <output>
```

Then verify:

```text
python3 packages/ops-decision-closure/bin/world-core.py verify \
  --items <output>/items.jsonl \
  --claims <output>/claims.jsonl \
  --mappings <output>/mappings.jsonl \
  --relations <output>/relations.jsonl
```

Reverse reconstruction must equal `input/` byte for byte:

```text
python3 packages/ops-decision-closure/bin/world-core.py to-fcc \
  --items <output>/items.jsonl \
  --claims <output>/claims.jsonl \
  --out-dir <reverse>
```

## Expected

`expected.json` binds the complete readable result:

- input line counts and SHA-256;
- the exact verification receipt;
- hashes for every generated JSONL, receipt, and SQLite projection;
- read-only SQLite view results;
- byte-identical reverse reconstruction.

Generated world rows are not copied into this directory. Their closed schemas already define shape, and duplicate snapshots would create a second maintenance surface.

`world.sqlite3` is also not committed. It is a disposable binary projection; `expected.json` records its digest and query-visible contract.

## Done

The accumulation is complete only when:

- source rows were appended without rewriting prior rows;
- every source line has a mapping receipt;
- unresolved subject, target, relation, and mapping output counts are zero;
- generated hashes and view results equal `expected.json` for the golden;
- two clean runs produce identical JSONL, receipt, and SQLite bytes;
- reverse reconstruction is byte-identical;
- SQLite opens read-only and `integrity_check=ok`;
- `preserved` rows are not promoted into semantic views;
- the final report names source identity, mapper identity, output digests, view results, limitations, and verification status.

No new CLI, package, database engine, service, or alternate golden is needed unless this exact sequence fails for a real consumer.
