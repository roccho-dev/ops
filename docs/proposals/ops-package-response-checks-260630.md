# Ops package response and check adoption work order

## Purpose

Open the ops-side adoption PR for the package obligation system.

Ops must emit package-level responses for its owned runtime and operational evidence surfaces and run governance-provided package checks in CI.

## Scope

Define the work order for:

- `packages/ops-claims`
- `packages/ops-evidence`
- `packages/ops-receipts`
- `.github/workflows/gov-package-validation.yml`

## Required ops outputs

- `claim_id`
- `adrs_ref`
- `obligation_id`
- `repo_locator`
- `package_id`
- `package_path`
- `owner_role`
- `state`
- `covered_requirements[]`
- `test_refs[]`
- `evidence_refs[]`
- `receipt_ref`
- `residuals[]`
- `blocked_reason`
- `evidence_freshness`
- `overclaim_boundary`

## Non-goals

- Do not define ADRS meaning in ops.
- Do not replace governance checks with ops-local shared authority.
- Do not claim runtime adoption without evidence.

## Acceptance

Future implementation should produce ops package responses and run the exported governance checks from ops CI.
