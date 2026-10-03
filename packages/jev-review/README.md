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

## One reusable entry

Normal consumers do not need to build Jev HTTP or response handling.

Input:

```json
{
  "state": {"purpose": "what is being judged", "candidates": [{"id": "a"}, {"id": "b"}]},
  "themes": ["scope"],
  "items": [
    {"theme": "scope", "subject": ["candidate", "a"], "concern": "The candidate may exceed the declared scope."},
    {"theme": "scope", "subject": ["candidate", "b"], "concern": "The candidate may exceed the declared scope."}
  ],
  "topK": 1
}
```

Run through the existing `jev-api` capability:

```sh
jev-review input.json result.jsonl
```

`topK` is optional. Without it, only raw judgments are emitted.

The command writes standard JSONL and immediately reads the produced file back. A malformed or incomplete output is an execution failure, not semantic success.

The input rule stays small:

```text
state = only the material needed for the judgment
items = subject + one concern
Jev   = semantic evidence
caller = decision / effect / readback
```

## Bounded semlint contract — implementation pending

Refs: ops#471 body, append5962211453, C2/5966152566 and C2-R/5966263702. This section is the bounded specification under this PR, not completion of all #471 design rules, operating adoption or semantic-quality proof. External understanding agreement is not GitHub source review.

### Boundary and entry

The intended `semlint(input, ask)` export in `semlint.mjs` is a thin consumer of existing `evaluate(state, {themes, items}, ask)`. CI artifacts and append-only log entries use the same input and output. It returns evidence under Aligned, Closed, Unique, Minimal, Measurable and Improving. Existing generic CLI/APIs stay unchanged. No new CLI, provider HTTP, link fetching, actor launch, registry or persistent store is introduced. The supplied callback belongs to caller composition; this consumer reads no credentials.

`domain_effect_authority(semlint)=0`: lint results grant no merge/block/dispatch/accepted-write/credential authority. A separately authorized evaluator may incur provider HTTP, computation, usage and cost. Noul is concern-hypothesis evidence, not a verified finding, calibrated cross-axis score or clean/violation verdict.

### Exact input

Finite candidate schema `ops.semlint.input.v1`:
```
{schema,
 subject:{kind,ref,revision,scope,content,sha256},
 context:[{role,ref,revision,content,sha256}],
 checks:[ruleId]}
```
Kind is `ci-artifact` or `log-entry`. Content is the entire string in the declared scope. No summary/truncation, fetching or inferred missing material replaces it. Plain data records/dense arrays/exact fields and well-formed JavaScript strings are required; unpaired surrogates are rejected, with no Unicode normalization. Each digest binds UTF-8 bytes, not authenticity, freshness or acceptance. Duplicate check IDs and duplicate context identity `(role,ref,revision)` are rejected, including conflicting digests. Different records with the same role, such as base plus separate authority grant, are allowed. Snapshot the validated input before await. Invalid input throws a closed code before callback; caller/tests must still account for that attempted invocation.

Context may contain normative accepted constraints and observed evidence. This is a caller provenance declaration, not a new accepted source of truth. Independent gold, grading and expected labels belong to test/operator records outside provider state/questions, not dedicated input fields. Their absence from arbitrary prose is not mechanically guaranteed; the caller has that duty, and finite tests inspect actual payloads for their own independent labels.

### Limited rule catalog

One initial rule belongs primarily to each question. These are not the full #471 rules or exhaustive defect discovery. `checks` is caller request selection, not a semantic applicability proof.

- `aligned.authority-grant`: required `authorityContract`; concern that the artifact attributes authority unsupported by the declared accepted contract. An exact separately authorized consumer grant is legitimate.
- `closed.feedback-completion`: required `completionContract`; concern that actor/work/reentry completion is claimed without its required observations. Honest DELIVERED-only reporting is legitimate; unread refs do not prove absence. Measurable is a cross-link, not a second counted finding.
- `unique.canonical-responsibility`: required `responsibilityContract`; concern that a second incompatible canonical meaning/owner is introduced. Legitimate aliases/views, independent review and authorized delegation/update are not duplication merely because they coexist.
- `minimal.necessary-layer`: required `requiredContracts`, `dependencyDescription`; concern that added structure is unnecessary. Removal must retain scope, authority, failure/terminal protection and neighboring replaceability; distinct judgment/admission responsibilities cannot be collapsed just because both look safe.
- `measurable.attempt-accounting`: required `accountingContract`, `registeredCases`; concern that failed/missing/invalid attempts disappear or receive semantic-success credit. Empty/unknown required coverage is not success. Invalid evidence cannot erase an observed wrong decision.
- `improving.comparable-evidence`: required `qualityContract`, `baselineEvidence`; concern that improvement lacks a comparable failure→cause→metric→regression→evidence chain. Explicit justified tradeoffs and identified multiple causes are allowed.

A selected rule missing absent/empty required context is INCOMPLETE and is not sent. Other selected supported checks remain eligible and retain their evidence. Unselected rules are NOT_SELECTED: uninspected in this request, not defect-free or N/A. This consumer has no semantic applicability adjudicator. Optional non-claimed evidence can be N/A under an external accepted contract, but selection alone does not establish it. No selected/sendable questions means zero callback calls and no clean proof. Required coverage and independent purpose expectations are not manufactured from the request.

### Output and accounting

Finite candidate result `ops.semlint.result.v1` binds input and question-contract digests and contains six fixed records, one per question/catalog rule:
```
{question,rule,subject,status,noul,contextRefs,missingRoles,crossLinks,cause}
```
Status is NOT_SELECTED, INCOMPLETE, OBSERVED, EXECUTION_ERROR or EVIDENCE_INVALID. A Noul score exists only for OBSERVED validated responses; otherwise null. Context pointers are supplied refs/digests, not proof that a model actually read them or used them as reasons. No model-created concern prose/finding identity is trusted. Cause and claim ceiling remain explicit. Missing/failed/invalid records do not remove other observations. Invalid input is a closed exception, not an artifact verdict.

Retain selected/sendable/evaluated/missing counts, callback attempts, validated calls, usage and evaluation time. Callback count is not authenticated HTTP count; missing usage/cost is unknown, not zero. Existing evaluator/model/budgets remain unchanged (`JEV_MODEL=jev-1.13.0` is an existing source fact). Wrong model/answer evidence is not valid semantic UNKNOWN. Return bounded safe codes, not arbitrary response bodies, raw exceptions or credentials. Callback-based results require external mode/source/authorization evidence to distinguish fixture from real provider runs. Synthetic canary tests cover specified output surfaces only, not universal secret absence.

Rule accounting is not purpose↔responsibility Coverage, lint precision/recall, or an aggregate score. No score threshold or automatic finding/clean classification is introduced.

### Mechanical proof and claim ceiling

CI pair: concern-only/no-separate-grant accepted contract versus an automatic merge/block proposal; normal controls are annotation-only and an exact separately authorized consumer grant. Log pair: DELIVERED≠actor/work/reentry accepted contract versus receipt-only C3-complete claim; normal control reports DELIVERED and leaves work unobserved. The same API binds both, with independent expectations kept outside model input.

Tests add finite catalog/source/rule/question correspondence, legal/broken material, missing/empty context, unselected/zero-question, invalid input/response/model, execution error, snapshot, accounting and canary controls to the existing test entry. Identical mock scores for legal/broken material can test preserved payload distinctions; they do not test semantic classification. Mock success proves composition/refusal/accounting, not correct concern discovery, all-concern avoidance, FP/FN or quality improvement.

Existing generated `checks.jev-review` and full exact-head Nix CI run the existing test entry. The repo-health-specific workflow alone is not proof that jev-review tests ran. Machine completion requires this bounded API/docs, existing API regression, registered mechanical checks, actual supplied module bytes/source closure and independent exact-head source review. No unauthorized provider call is needed for that mechanical terminal.

Real availability/semantic quality/usefulness/improvement remain NOT_RUN/NOT_PROVEN until a separate finite prospective plan adopts exact inputs/questions/source/context/model, independent expectations, approved target, budget and all-attempt human/provider cost/time accounting. The existing model validator is already fixed; future real-run permission, availability, comparison criteria and budget are separate and currently unadopted. Do not inherit consumed or old proof. This PR does not close #471, expand #453, adopt a gate, implement D/Adapter/wake, or prove business value.
