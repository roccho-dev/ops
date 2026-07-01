# ops package responsibility closure adoption work order

## Purpose

Adopt the package responsibility closure plane in `roccho-dev/ops`.

The goal is to make the many real ops packages visible to ADRS/governance package closure without pretending that all of them already have ADRS obligations or package responses.

This PR is a work specification. It does not implement strict all-repo gating, production deploy checks, or authority changes.

## Primary gaps

| Gap | Current | Expected closure |
|---|---|---|
| ops has many real packages | `build/packages.jsonl` lists many package outputs | emit canonical `packageInventory.v1` rows |
| ops package responses cover only selected packages | `ops-package-responses` emits a bounded response packet | normalize responses and expose unanswered inventory as drift |
| ops response shape is repo-local | `ops.packageResponse.v1` differs from governance package response shape | add normalizer or emit canonical companion rows |
| residuals can be hidden if only in PR prose | residuals exist in response packet, but closure plane needs standard rows | return residuals as machine-readable closure input |

## Required ops outputs

### `packageInventory.v1`

Ops should emit inventory rows from:

- `build/packages.jsonl`
- `build/checks.jsonl`
- generated flake packages derived from package declarations
- explicit flake packages that are not represented by `build/packages.jsonl`
- source package directories under `packages/**`

Inventory rows must classify source kind:

| source_kind | Meaning |
|---|---|
| `build-packages-jsonl` | declared package output |
| `build-checks-jsonl` | declared check output |
| `flake-generated` | package/check generated from jsonl fold |
| `flake-explicit` | explicit flake package not in jsonl fold |
| `source-dir` | source directory with bin/test/lib content |
| `evidence-output` | generated evidence; must not be treated as source package |

### `packageResponse.v1`

Ops should normalize existing response packets into governance-readable rows.

Minimum mapping:

| ops field | canonical field |
|---|---|
| `adrs_ref` | `adrsRef` / `adrs_ref` |
| `obligation_id` | `obligationId` / `obligation_id` |
| `repo_locator` | `repo` / `repo_locator` |
| `package_id` | `packageId` / `package_id` |
| `package_path` | `packagePath` / `package_path` |
| `owner_role` | `ownerRole` / `owner_role` |
| `test_refs` | `tests` / `test_refs` |
| `receipt_ref` | `receipt` / `receipt_ref` |
| `residuals` | `residuals` |

## Required drift handling

| Drift | Meaning in ops |
|---|---|
| `unregistered-package` | package exists in ops but ADRS has no obligation |
| `claim-missing` | ADRS obligation exists but ops does not answer |
| `extra-response` | ops response exists without ADRS obligation |
| `required-test-missing` | response lacks required test evidence |
| `receipt-missing` | closure lacks receipt |
| `residual-hidden` | incomplete work lacks residual row |
| `package-path-drift` | stable package id moved path without receipt |

## PR work-order rule

Each future ops package PR should be tied to one primary drift row or bounded drift batch.

Required PR body sections:

| Section | Required value |
|---|---|
| Primary gap | selected `packageDrift.v1` row |
| Current | inventory, response, and obligation state |
| Ideal | expected drift result after PR |
| Proof | check name and output packet |
| Receipt | ops receipt row |
| Residual | returned residual row |
| Non-scope | no ADRS meaning authority, no deploy approval, no all-repo strict claim |

## Initial PR decomposition

| PR | Purpose |
|---|---|
| ops inventory emitter | emit canonical inventory rows from `build/packages.jsonl`, checks, flake, and source dirs |
| ops response normalizer | map existing `ops.packageResponse.v1` packet to canonical governance shape |
| ops unregistered package report | expose packages present in ops but absent from ADRS obligations |
| ops residual standardization | ensure residual rows are returned in canonical form |
| ops selected strict adoption | only after ADRS explicitly selects scope and governance implements drift join |

## Non-goals

- Do not claim all ops packages already have ADRS obligations.
- Do not claim all ops packages already emit responses.
- Do not make ops a shared meaning authority.
- Do not treat generated output as source package reality.
- Do not make deploy or production promotion decisions in this package closure work.
- Do not turn selected-warning into all-repo strict.

## Acceptance

This PR is complete as a work order when it defines how ops will emit package inventory, normalize package responses, return residuals, and let governance produce non-authority drift rows.

A later implementation PR is complete only when targeted ops drift rows disappear or are explicitly reduced with machine-readable residuals.
