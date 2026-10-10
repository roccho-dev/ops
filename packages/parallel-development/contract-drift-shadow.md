# Lane B: accepted-contract drift shadow

Refs: ops#449, ops#451; reuse the merged PR-phase evaluator and shared Jev boundary.
This is a bounded proof adapter, not a CI selector, contract authority, or merge gate.

## Current correction boundary

Control `3ec15b2b473be9465fa32d94851c8ab09d1c62b9` permits offline corrections only,
under [P's exact path set](https://github.com/roccho-dev/ops/pull/450#issuecomment-5910294374).
[Product R's review](https://github.com/roccho-dev/ops/pull/451#pullrequestreview-5365254817)
identifies two unresolved limits of the implementation described below:

- Detached contract text plus a diff is not the structured input below. A matching
  digest does not make it admissible, and missing meaning must not be invented.
- `ranked[].findings` contains candidate-level theme scores, not source-position /
  contract-condition / correction-effect identities. Distinct inputs can retain
  different input/state digests while returning identical categories and scores.
  Neither hashing a category nor counting all six themes creates a unique drift ID.
  These scores alone cannot measure v2 recall, precision or accepted corrections.

There is also an offline maintenance boundary: `natural-case/check.mjs` compares
current evaluator module bytes against historical `question-contract.implementation`
pins in `natural-case/raws.jsonl`. Even appending a newline to the adapter invalidates
that check. Both historical files are outside the current mutable set. Do not update
those pins, bypass their import, mask the failure, or put runtime correction code in
tests to evade this boundary. Product R/P must resolve historical verification versus
current implementation testing before a functional adapter successor can stay Green.
The development checks added here expose these limits; they do not fix the adapter.

Existing offline checks and historical evidence remain intact. ROOT_001/v3 remains
consumed, BLOCK/UNKNOWN, NOT_COMPARABLE and RETIRED_FROM_CONFIRMATION. No command in
this document authorizes provider/root execution, a new projection/case/oracle,
credential changes, or retry. Executor authority and v2 completion evidence remain
separate unmet conditions; missing measurements are not zero.

## Input and binding

`reviewContractDrift(inputText, expectedDigest, ask)` consumes one UTF-8 JSON snapshot.
`expectedDigest` is `sha256:` plus the SHA-256 of the **exact input file bytes**, including
whitespace. Freeze it before evaluation. Do not silently recompute it after changing
an input. The snapshot has exactly these keys:

```text
contractRef     producer's retained exact contract-source reference
acceptanceRef   separately retained upstream acceptance observation
changeRef       https://github.com/OWNER/REPO/compare/BASE_SHA...HEAD_SHA
contract        existing PR-phase cut: id, goal, scope, in, out, acceptance
change          existing PR candidate: id, changed_scope, implementation, outputs, evidence
related         explicit array of existing related-cut records (empty is allowed)
```

BASE_SHA and HEAD_SHA are full 40-character commit IDs. The supplied contract,
change and related records retain the existing `phases.mjs` schemas. No missing
related context is silently defaulted to an empty set; unknown top-level fields,
including a comparison answer, are rejected.

The hash binds the entire supplied projection and all refs. It does **not** authenticate
GitHub, establish that the projection matches its source, or mint upstream acceptance.
A natural case needs separately retained source/acceptance readback and an exact real
diff. An arbitrary URL plus a recomputed hash is not that evidence. Keep full source
bytes/readback with the case; report omitted static/runtime context explicitly. The
adapter always says `sourceReadback: NOT_VERIFIED_BY_ADAPTER`. Synthetic test fixtures
are not natural accepted-contract evidence.

## One bounded proof run

Use the existing `parallel-development-jev-proof` artifact's envs `jev-api` capability;
this lane adds no secret store or auth acquisition path. The environment supplies
`JEV_API_KEY`, with no `SOPS_AGE_KEY*` decryption capability passed to the consumer.
Optional OPS_SHA/ENVS_SHA are producer-declared metadata, not authenticated readback.

```sh
node packages/parallel-development/contract-drift-shadow.mjs \
  FROZEN_INPUT.json sha256:FROZEN_INPUT_DIGEST NEW_REPORT.jsonl
```

One invocation makes at most one shared `askJev` request with six existing PR themes,
a 15-second timeout, the existing request budget and fixed JEV_MODEL. No retries,
truncation, fallback provider or semantic threshold is added. Output is a write-once
JSONL file (exclusive creation, mode 0600, flushed after result). Reusing the output
path fails before a call. The record retains input bytes/digest, exact model-visible
request, validated response/digests, coverage, observable model, module digests, Node
version, elapsed time and available usage. Invalid responses are not retained as
valid judgments. Arbitrary provider errors and auth material are not emitted.

`BLOCK` means input/binding/output preparation failed. `UNKNOWN` includes absent auth,
provider failure, wrong model, incomplete answers or budget exhaustion. `OBSERVED`
means a complete validated response only: even all-zero/all-one scores grant no
accept/reject/skip/effect authority. Injected test transport can also produce OBSERVED;
therefore an offline test or report shape does not establish live provider execution.
CLI exits nonzero on BLOCK/UNKNOWN; no live semantic verdict is wired into ordinary CI.
A process killed before the result leaves an incomplete report, never success.

## Independent comparison and closure

Before exposing the report's concerns, freeze R's independent observations for the
**same evaluation subject and exact head**, including their immutable content digest
and observation identity. R's review of this adapter is a different observation.
The CLI prints only execution status/digest, not findings. Do not publish the report
where the comparison reviewer will see it before the independent record is fixed.
Exposure already happened: record contamination / not comparable; never repair it by
calling a later review independent. R is a reference, not ground truth.

Later corrections need their own exact head, check and actual readback, linked as a
new observation rather than by rewriting a prior result. This adapter intentionally
never infers comparison, correction, useful effect or economics: these remain NOT_RUN
or UNMEASURED until the separate observations support them. Stop/UNKNOWN/BLOCK is a
valid bounded lane record, subject to independent R verification on #451; none is
silently promoted to lane completion or provider adoption.

## Offline checks

`node packages/parallel-development/contract-drift-shadow.test.mjs` exercises binding,
coverage, malformed responses, budget, secret-error sanitization, shared transport
serialization, write-once files and CLI non-Green readback. It is imported by the
existing `tests/run.mjs` / `parallel-development-jev-phases` Nix check. No workflow,
portfolio state, global score, other-lane dependency or new test runner is introduced.
