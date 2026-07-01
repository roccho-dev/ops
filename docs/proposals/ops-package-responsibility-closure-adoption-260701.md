# ops package responsibility closure adoption implementation

## Purpose

Adopt the package responsibility closure plane in `roccho-dev/ops` with machine-readable ops outputs.

The goal is to make real ops packages visible to ADRS/governance package closure without pretending that all packages already have ADRS obligations or covered package responses.

## Goal update

This PR is no longer only a work specification. It implements the selected ops-side closure packet in `packages/ops-package-responses`.

It still does not implement strict all-repo gating, production deploy checks, deploy approval, or authority changes.

## Implemented outputs

| Output | File | Role |
|---|---|---|
| repo-local responses | `ops-package-responses.jsonl` | existing selected `ops.packageResponse.v1` package responses |
| evidence | `ops-package-evidence.jsonl` | non-authority evidence rows linked from responses |
| receipts | `ops-package-receipts.jsonl` | non-authority receipt rows linked from responses |
| repo-local residuals | `ops-package-residuals.jsonl` | existing returned residual rows |
| canonical inventory | `package-inventory.jsonl` | `packageInventory.v1` rows for ops package reality |
| canonical responses | `package-responses.jsonl` | normalized `packageResponse.v1` rows for governance-readable joins |
| canonical residuals | `package-residuals.jsonl` | normalized `packageResidual.v1` rows |
| drift rows | `package-drifts.jsonl` | non-authority `packageDrift.v1` rows for unanswered ops package inventory |
| manifest | `manifest.json` | packet boundary and row counts |

## Inventory sources

`ops-package-responses emit` now classifies inventory from:

- `build/packages.jsonl` as `build-packages-jsonl`
- `build/checks.jsonl` as `build-checks-jsonl`
- generated flake package declarations as `flake-generated`
- explicit flake packages as `flake-explicit`
- source package directories under `packages/**` as `source-dir`
- generated packet files as `evidence-output`

`evidence-output` rows are deliberately not treated as source package reality when drift rows are computed.

## Response normalization

The selected `ops.packageResponse.v1` rows are emitted unchanged for repo-local compatibility and also normalized into canonical `packageResponse.v1` rows.

Minimum mapping covered:

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

## Drift handling implemented

`package-drifts.jsonl` emits `unregistered-package` rows for packages that exist in ops inventory but do not have selected ops package responses in this PR.

This is a non-authority diagnostic. ADRS still defines obligations and governance still performs reusable joins/gates.

## Validation

`ops-package-responses validate` verifies:

- all packet files exist
- manifest row counts match emitted files
- authority boundary remains false
- required inventory source kinds are present
- canonical responses match selected response claims
- canonical residuals match repo-local residuals
- drift rows do not target already-covered response packages
- `evidence-output` inventory is not treated as source package reality

`ops-package-responses selftest` runs a positive packet test and negative fixtures for missing freshness and missing source-dir inventory.

## PR work-order rule kept for later PRs

Each future ops package PR should be tied to one primary `packageDrift.v1` row or bounded drift batch.

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

## Remaining non-goals

- Do not claim all ops packages already have ADRS obligations.
- Do not claim all ops packages already emit covered responses.
- Do not make ops a shared meaning authority.
- Do not treat generated output as source package reality.
- Do not make deploy or production promotion decisions in this package closure work.
- Do not turn selected-warning into all-repo strict.

## Acceptance

This PR is complete when:

- `packages/ops-package-responses` emits inventory, canonical responses, canonical residuals, and drift rows.
- `packages/ops-package-responses` validates those rows.
- `build/checks.jsonl:ops-package-responses` passes.
- governance package validation passes.
- the packet remains a non-authority diagnostic and does not claim ADRS/governance authority.

Later implementation PRs close individual `packageDrift.v1` rows by adding selected obligations, selected responses, receipts, or returned residuals.
