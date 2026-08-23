# Test-meaning inventory and Canon TDD GREEN

This proof inventories every assertion meaning in the canonical Node/MJS tests. The complete machine-readable list is partitioned by canonical source file under `test-meaning.inventory/*.jsonl`; the partition is organizational only and all rows use `hq.modelingRuntime.goTestMeaning.v1`.

## Coverage

- Canonical MJS test files: **16**
- Assertion call sites mapped exactly once: **540**
- Semantic behavior groups: **154**
- RED commit production Go changes: **0**
- GREEN closure: **detached promotion output** and **bounded deep-nesting resource growth** pass
- Exact deep-nesting proof: **20,000 levels**

| Disposition | Meaning groups | Assertion sites | Rule |
|---|---:|---:|---|
| `canonical-node-package-only` | 8 | 54 | canonical Node ownership/export topology; this proof does not impersonate or replace it. |
| `deferred-outside-proof` | 35 | 116 | CUE/local-root/CI/GitHub/canonical-promotion adapters outside this serialized proof. |
| `ported-required` | 80 | 330 | required serialized core/CLI meaning executed by Go tests. |
| `retained-existing-parity` | 1 | 1 | retained by the cross-runtime runner; no duplicate Go unit test. |
| `retained-node-only` | 24 | 30 | Proxy/getter/prototype/cycle and other JS-object meanings that cannot cross serialized bytes. |
| `selective-port` | 6 | 9 | a mixed assertion; only the serialized representable meaning is ported. |

## Inventory contract

`TestCanonicalMJSMeaningInventoryIsComplete` fails unless:

- all 16 canonical MJS files are represented and their SHA-256 values match;
- every one of the 540 `assert.*` call sites belongs to exactly one meaning row;
- all 154 meaning IDs are unique and use an allowed disposition;
- every `ported-required` or `selective-port` row names an existing Go test;
- the two high-risk RED meanings remain explicit and no `_RED` test remains.

## Canon TDD closure

1. RED proved promotion output aliasing caller-owned proposal maps and slices.
2. GREEN snapshots validated proposal data before constructing queue and receipt output.
3. RED proved near-quadratic allocation growth when serialized JSON nesting doubled.
4. GREEN uses mutable push/pop path stacks and copies paths only when emitting findings.
5. The exact 20,000-level canonical nesting case now executes directly.

Production changes are limited to `proposal.go`, `validate_data.go`, and `validate_authority.go`.
