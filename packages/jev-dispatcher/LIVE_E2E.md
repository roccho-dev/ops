# Dispatcher query live Jev E2E

This is the manual PR-completion semantic-value check for `jev-dispatcher-query`.
It is executed from the existing `envs` authenticated runtime boundary against one
exact Ops commit. It must call the real Jev provider; injected or mock providers do
not satisfy this check.

## Scope

Included:

- the installed `jev-dispatcher-query` binary;
- the exact Git policy selector;
- real `jev-latest` calls through the existing `jev-api` binding;
- typed response validation and exact non-authority receipts;
- fixed natural cases, paraphrase/option-order stability, and a rule-meaning-only
  contrast;
- a retained JSON report bound to the exact Ops and envs commits.

Excluded:

- real OCI R/W sessions, same-actor reply delivery, and stage resume;
- operational 7B activation or assignment of the independent blind evaluator;
- work effects, adoption authority, old-D recovery/monitoring completion;
- economic value or total-cost improvement.

Those exclusions are not passes. They remain separate completion obligations.

## Pre-registered evaluation

The E2E runs six non-authority choice cases. It passes only when all of the following
are true:

1. every case makes exactly one successful real Jev request and returns model
   `jev-latest` with a valid raw-response digest;
2. unambiguous missing-evidence, complete-evidence, and repeated-ambiguity cases
   return the predeclared advisory action;
3. a paraphrased question with reordered options preserves the missing-evidence
   decision;
4. the same bounded state changes from `RETURN` to `CONTINUE` when only the selected
   rule is changed to recognize the explicit waiver;
5. every response remains `authority: false` and `effect: false`.

The fixture and expected outcomes are source-controlled before execution. If these
criteria cannot be fixed before the run, stop; do not run and label the result later.
A PASS is a developer-visible signal that the semantic query path has bounded value.
It is not an independent operational label and does not make D complete.

## Invocation

Use the envs `dispatcher-query-live-e2e` workflow with the exact Ops commit. The
envs workflow owns secret materialization and invokes the installed
`jev-dispatcher-live-e2e` binary through `envctl auth exec`. The report contains no
credential and is retained as a workflow artifact.

For a locally authorized runtime, the installed binary requires `JEV_API_KEY`,
`OPS_SHA`, `QUERY_BIN`, and `DISPATCHER_GIT_BIN`; the Nix wrapper supplies the latter
two. Do not place the key in arguments, input JSON, logs, or the report.
