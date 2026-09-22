# parallel-development Jev phase proof

Refs: roccho-dev/ops#401, roccho-dev/adrs#393, roccho-dev/adrs#392.

This package proves only the **three semantic review boundaries** needed by the parallel-development design:

```text
parallel cut proposal → Jev semantic comparison
parallel PR result    → Jev semantic comparison
Root Join result      → Jev semantic comparison
```

It does not prove chat.pro/chat.extrahigh execution, actual GitHub fan-out, merge/readback, Issue Close, or restart closure.

## Neutral proof contract

The previous fixture used candidate IDs `good` / `bad`. That run is retained as connectivity evidence only because those labels could reveal the expected class to the model.

The current corpus removes that leakage:

```text
tests/cases.jsonl      # neutral candidate IDs and model-visible state only
tests/expected.jsonl   # runner-only gold; loaded after all live requests
```

There are 18 isolated semantic comparisons:

- cut: 6 themes;
- PR: 6 themes;
- Join: 6 themes.

Each comparison is executed twice with candidate order reversed. Total live proof: **36 requests / 72 Noul judgments**.

The request guard rejects model-visible payloads containing the old class labels. The gold file is not loaded until all live model requests have completed.

## Semantics

All phases reuse the existing shared `packages/jev-review` surface:

```text
small declared state + one targeted theme + both neutral candidates
→ raw Noul answers
→ both candidates retained for comparison
```

Semantic thresholds remain zero. Preferred-higher / preferred-lower / tie and order stability are recorded as evidence. They never become accept/reject/merge authority.

Offline:

```sh
node packages/parallel-development/tests/run.mjs
```

Real API through the existing envs `jev-api` capability:

```sh
node packages/parallel-development/proof.mjs NEW_REPORT.jsonl
```

Missing phase/theme/candidate evaluation, malformed response, model mismatch, or explicit gold leakage is an execution error. A reversed or tied semantic ordering is still a valid observed model result and must not be hidden as execution failure.
