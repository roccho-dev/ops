# parallel-development Jev phase proof

Refs: roccho-dev/ops#401, roccho-dev/adrs#393.

This package proves only the **three semantic review boundaries** needed by the parallel-development design:

```text
parallel cut proposal → Jev ranked review
parallel PR result    → Jev ranked review
Root Join result      → Jev ranked review
```

It does not prove chat.pro/chat.extrahigh execution, GitHub fan-out/Join, merge/readback, Issue Close, or production ranking accuracy.

## Contract

All three phases reuse `packages/jev-review`:

```text
small declared state + phase themes + topK
→ one Jev request
→ validated raw Noul rankings
```

There are no semantic thresholds and Jev owns no accept/merge authority.

Fixed proof corpus:
- cut: 6 themes × good/bad candidate
- PR: 6 themes × good/bad candidate
- Join: 6 themes × good/bad candidate

Total: 3 requests, 18 themes, 36 Noul judgments.

Offline:
```sh
node packages/parallel-development/tests/run.mjs
```

Real API:
```sh
node packages/parallel-development/proof.mjs NEW_REPORT.jsonl
```

The real API key is supplied by envs through the existing SOPS/age → envctl `jev-api` capability path. No key is stored here.

A reversed/tied ranking is recorded as evidence, not converted into a hidden Boolean gate. Missing phase/theme/candidate evaluation or a malformed Jev response is an execution error.
