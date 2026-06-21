# Gen1 operation surface validator

Validates that Gen1 Codex organizes Gen2 operations as bounded operation
surfaces, not as implicit actor assignments or authority grants.

The ADRS law seed is:

- `adrs.git:proposal/gen1-codex-gen2-operation-model-260621`
- head `b1394e4fd6af9c2305fc27deabc554d6c391b8e2`

This package does not approve policy.git deletion, cutover, canonical writes,
or SSOT adoption. A PASS report only means the operation-surface record obeys
the Gen1 handoff model.

## Required invariants

- `orchestratedBy` must be `gen1-codex`.
- Gen2 is an operation layer, not an actor assignment.
- ChatGPT/Codex/browser/call-js/GitHub mirror are surfaces or transports.
- SSOT must remain `adrs.git` and/or `ops.git`.
- `policy.git` hardcoded law writes are rejected.
- Approval flags must remain false.

## Usage

```bash
packages/gen1-operation-surface-validator/bin/validate-gen1-operation-surface.sh \
  packages/gen1-operation-surface-validator/fixtures/pass/good-chatgpt-github.jsonl \
  /tmp/report.json
```
