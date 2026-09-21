# Jev design-lint contribution probe

Refs: roccho-dev/adrs#392, roccho-dev/ops#396/#397.

Question: does Jev add useful **semantic** findings to the existing deterministic boundary, before code is implemented?
This is one experiment inside repo-health, not another linter framework, registry, service, code parser, or scheduler.

## Contract

Input: a small **declared closed design** with purpose, acceptance, external inputs, required results, and units with id/kind/role/input/output/behavior.
Port IDs derive the dependency graph. Public outputs are explicitly listed as results, so absence of an internal caller does not make an API unused.
Package, directory, file, public function and shared-function examples use the same record shape. Containment is not duplicated as a second responsibility.

Output: structural findings, or typed per-rule PASS/FAIL/UNKNOWN with Noul probability and usage. Nothing is merged, deleted, dispatched or accepted by this tool.

| Owner | Responsibility |
|---|---|
| Ordinary code | IDs, producers, required inputs/results, cycles, unused outputs/units in the declared graph; no Jev call on a hard failure |
| Jev | Purpose, responsibility fulfillment, semantic input/output compatibility, responsibility duplication, scope, acceptance relevance |
| Caller | Thresholds, error handling, interpretation and any later authority |
| envs | Supply the existing Jev credential; no lint rules or expected labels |

`askJev` is shared with the existing repo-health CLI. It uses the existing exact model and request-budget rules. Live evaluation has an immutable official endpoint, no retry and no model fallback.

## Frozen experiment

20 fixtures: 16 semantic cases (8 valid / 8 defective, including Japanese), 4 structural negatives. Gold labels and case IDs are never supplied to Jev. Each case specifies the relevant atomic criterion; this is not a benchmark of discovering which criterion to ask.

The structural baseline is **UNKNOWN about semantics**, not proof of a good design. All 16 semantic cases pass that structural baseline. Eight deliberately introduced defects test extra detection; eight valid cases test false alarms.

Thresholds are fixed before the first live run: <=0.2 FAIL, >=0.8 PASS, middle UNKNOWN. A bounded PoC PASS requires all six semantic families to add a correct detection, zero false positives, zero false negatives, zero UNKNOWN, all four structural defects found, and zero Jev calls for those four cases. These strict fixture gates are not a population accuracy guarantee.

A failed model benchmark is a valid experimental result: retain it, do not relabel cases or relax thresholds to turn it green. Any later change requires a new version and a fresh evaluation set.

Run offline: `node packages/repo-health/design/test.mjs`.
Run live through envs credential injection: `node packages/repo-health/design/run.mjs OUTPUT_JSONL`.
The live runner makes at most 16 requests, each bounded at 15 seconds. It writes a manifest, every result and the final summary; no key, arbitrary provider response or private key is logged.

## Evidence limits

Synthetic fixtures and author-assigned labels demonstrate only bounded feasibility. This does not establish independent-review accuracy, coverage of real repositories, unobserved dependencies/effects, universal closure, a globally minimal PR cut, parallel development throughput, or cost savings. These require separate evidence; do not count this small suite as those results.

## Smallness

No new dependencies or package registration. Reuse the existing auth declaration, model pin, JSONL/digest, probability classification, budget validation, Nix check and report package. No HTML, database, AST adapters, generated code or LLM orchestration is added for the experiment.
