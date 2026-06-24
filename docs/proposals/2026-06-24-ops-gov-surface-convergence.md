# Proposal: converge ops shared rules on gov* input

Status: Proposed
Date: 2026-06-24
Scope: ops, gov*, flakes-equivalent completion path
Type: consumer-boundary-proposal

## 1. Purpose lineage

| Generation | Purpose | Proposal contribution |
|---:|---|---|
| O0 | Keep ops useful without making it shared rule authority. | Reclassifies ops patterns as evidence, candidates, facts, or local proof. |
| O1 | Let ops and flakes reach the same completed shape. | Both consume gov* for shared mechanical rules. |
| O2 | Preserve existing ops JSONL-to-Nix value. | Retains package/runtime/check facts and local proof. |
| O3 | Move shared semantics upstream. | Package role, naming, effect, source, generated authority, and receipt rules go through ADRS/gov*. |
| O4 | Reduce duplicated governance logic. | Replaces copied local shared checks with gov* helpers after shadow comparison. |
| O5 | Keep package implementation moving. | Local package-specific checks remain allowed. |
| O6 | Improve audit and handoff. | A reviewer can separate ops facts from shared rules. |
| O7 | Support low-cost package factory. | Ops becomes a reusable evidence source and consumer of the same gov* surface. |
| O8 | Reduce migration risk. | Shadow mode precedes blocking mode. |
| O9 | Increase sale readiness. | Rule execution becomes central and inspectable instead of repo-local. |

## 2. Decision

Ops should converge on gov* as its direct shared-rule surface.

The completed state is not that other repos copy ops. The completed state is:

```text
ops    -> gov*
flakes -> gov*
other feature repos -> gov*
```

Ops continues to own implementation facts and package-specific proof. Shared rule meaning is ADRS. Shared mechanical enforcement is gov*.

## 3. Classification of existing ops data

| Existing ops element | Final classification |
|---|---|
| `build/runtime.jsonl` | repo fact / runtime fact. |
| `build/packages.jsonl` | repo fact / package fact. |
| `build/checks.jsonl` | local proof declaration until gov* schema exists. |
| package entry paths | repo fact. |
| package dependencies | repo fact to be checked by gov*. |
| package-specific test scripts | local proof. |
| package role taxonomy | shared rule -> ADRS/gov*. |
| naming rules | shared rule -> ADRS/gov*. |
| effect classes | shared rule -> ADRS/gov*. |
| source policy | shared rule -> ADRS/gov*. |
| generated-output authority boundary | shared rule -> ADRS/gov*. |
| proof receipt schema | shared rule -> ADRS/gov*. |

## 4. Migration path

1. Inventory ops local checks as either fact, package proof, or shared rule.
2. Preserve fact/proof lines locally.
3. Propose missing shared rules upstream when gov* cannot represent them.
4. Add gov* input and run helper checks in shadow mode.
5. Compare old local shared checks against gov* output.
6. Make gov* checks blocking when equivalent or explicitly accepted.
7. Remove duplicated local shared-rule checks.
8. Keep package-specific tests and receipts in ops.

## 5. What remains local

Ops may keep:

- package implementation;
- runtime wrappers;
- fixture data;
- package-specific e2e checks;
- receipts;
- source facts;
- counterexamples and evidence bundles.

## 6. What moves upstream

Ops must not keep local authority for:

- repo/package role rules;
- effect class rules;
- naming rules;
- source provider policy;
- build receipt schema;
- generated authority policy;
- feature repo direct-dependency policy;
- package promotion or waiver policy.

## 7. Non-goals

This proposal does not:

- delete existing ops checks;
- block DuckDB/Grafeo package work in flakes;
- make ops depend on flakes;
- make ops a governance authority;
- require a flag-day migration;
- authorize remote mutation;
- make generated outputs authoritative.

## 8. Acceptance gates

| Gate | Required result |
|---|---|
| classification | Existing local checks can be classified as fact/proof/shared rule. |
| gov* boundary | Shared mechanical rules are expected to come from gov*. |
| no flakes dependency | Ops does not depend on flakes for rules. |
| shadow safety | Migration starts in shadow mode. |
| package proof retained | Package-specific checks remain local. |
| upstream gap path | Missing shared rules become ADRS/gov* proposals. |

## 9. Final formulation

> Ops remains an implementation and evidence repo. Its proven patterns may seed ADRS/gov* proposals, but the completed shared-rule state is reached only when ops consumes gov* directly and removes duplicated local shared-rule authority.
