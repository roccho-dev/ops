# jev-review

Shared semantic-evaluation boundary for ops consumers.

```text
deterministic hard filter
→ small declared state
+ targeted semantic questions
→ evaluate(...)
→ raw Noul judgments
→ optional rankJudgments(...)
→ LLM / human / runtime decides
→ effect
→ readback
```

## Core

`evaluate(state, { themes, items }, ask)` owns only:

- request budget;
- question/answer correspondence;
- Jev response validation;
- raw `{theme, subject, noul}` judgments;
- evaluated coverage and usage.

It does not own domain meaning, PASS/FAIL policy, accept/revise, authorization, effects, or readback.

## Ranking

`rankJudgments(judgments, {topK, themes, items})` is optional attention ordering.

- `topK` is a return/display limit, not a safety boundary.
- omitted items are not proven safe;
- different themes are not globally calibrated;
- a Noul value is not impact, severity, authority, or permission.

## Consumer rule

A consumer should normally add only:

```text
small state projection
+ subjects/candidates
+ one concern per semantic question
```

Hard facts such as IDs, SHA equality, exact sets, cycles, permissions, and merged state stay in ordinary code.

Evaluator failure or missing coverage must never become semantic success. Semantic false positives/false negatives remain possible; fixed-fixture ranking is not production accuracy.
