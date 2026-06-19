# Policy Semantic Compiler

Status: candidate harness only.

This package inventories the current local policy repository, emits graph JSONL
skeleton records, and runs DuckDB-backed gates over the generated graph. It does
not approve cutover, deletion, or semantic migration.

The default source is `/home/nixos/repos/policy`. The source must exist; the
package does not fall back to an embedded corpus.

Allowed candidate claim: `semantic-authority-closure-ready-for-review`.

Forbidden claims:

- `cutover-ready`
- `policy.git may be deleted`
- `policy logic deleted`
- `semantic approval granted`
