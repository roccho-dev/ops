# Test-meaning inventory and Canon TDD RED

This proof inventories every assertion meaning in the canonical Node/MJS tests before any Go production change. The machine-readable complete list is partitioned by canonical source file under `test-meaning.inventory/*.jsonl`; the partition is organizational only and all rows share `hq.modelingRuntime.goTestMeaning.v1`.

## Coverage

- Canonical MJS test files: **16**
- Assertion call sites mapped exactly once: **540**
- Semantic behavior groups: **154**
- RED commit production Go changes: **0**

| Disposition | Meaning groups | Assertion sites | Rule |
|---|---:|---:|---|
| `canonical-node-package-only` | 8 | 54 | canonical Node package ownership/export topology; the proof must not impersonate or replace it. |
| `deferred-outside-proof` | 35 | 116 | CUE/local-root/CI/GitHub/canonical-promotion adapters outside the serialized Go proof. |
| `ported-required` | 80 | 330 | required serialized core/CLI meaning, executed by Go tests. |
| `retained-existing-parity` | 1 | 1 | already retained by the cross-runtime parity runner; no duplicate Go unit test. |
| `retained-node-only` | 24 | 30 | Proxy/getter/prototype/cycle and other JS-object meanings that cannot cross serialized bytes. |
| `selective-port` | 6 | 9 | one MJS assertion mixes serialized and JS-only meaning; only the representable part is ported. |

## Inventory contract

`TestCanonicalMJSMeaningInventoryIsComplete` fails unless:

- all 16 canonical MJS files are represented and their SHA-256 values still match;
- every one of the 540 `assert.*` call sites belongs to exactly one meaning row;
- all 154 meaning IDs are unique and use an allowed disposition;
- every `ported-required` or `selective-port` row names an existing Go test;
- the two high-risk RED meanings remain explicit.

## RED observations

1. `TestPromotionOutputIsDetachedFromCallerInput_RED`: promotion output aliases caller-owned proposal maps/slices.
2. `TestSerializedDeepNestingHasBoundedResourceGrowth_RED`: doubling depth from 512 to 1024 grows allocation near quadratically.

No production Go file changes in this commit. The next commit may change only the minimum implementation needed to turn these two observations green.
