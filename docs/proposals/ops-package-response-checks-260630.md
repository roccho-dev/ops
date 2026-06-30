# Ops package response and check adoption implementation

## Purpose

Open and complete the ops-side adoption PR for the package obligation system.

Ops emits package-level responses for its owned runtime and operational evidence
surfaces and runs governance-connected checks in CI.

## Implemented scope

This PR implements:

- `packages/ops-package-responses/bin/ops-package-responses.mjs`
- `packages/ops-package-responses/tests/e2e.mjs`
- `build/packages.jsonl` registration for `ops-package-responses`
- `.github/workflows/gov-package-validation.yml`
- `ci.intent.v1.jsonl` declaration for the workflow
- README output/check documentation

## Required ops outputs

`ops-package-responses emit --out-dir <dir>` produces:

- `ops-package-responses.jsonl`
- `ops-package-evidence.jsonl`
- `ops-package-receipts.jsonl`
- `ops-package-residuals.jsonl`
- `manifest.json`

Each package response row carries:

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

## Validation

`ops-package-responses validate --out-dir <dir>` checks:

- required response shape
- evidence freshness
- evidence linkage
- receipt linkage
- residual linkage/return
- non-authority boundary on manifest, evidence, receipt, and residual records
- negative fixture rejection through `ops-package-responses selftest`

## CI wiring

`gov-package-validation.yml` runs:

1. `nix flake check`
2. `ops-package-responses emit`
3. `ops-package-responses validate`
4. the currently exported governance checker selftest
5. artifact upload for `ops-package-response-out`

## Non-goals

- Do not define ADRS meaning in ops.
- Do not replace governance checks with ops-local shared authority.
- Do not claim runtime adoption without evidence.
- Do not claim governance #64's reusable package check export is complete from
  this repo; the residual is returned to governance #64.

## Acceptance

This PR is no longer a work-order-only PR. It implements the ops package
response emitter, validator, response packet CI wiring, and governance-connected
check adoption boundary for ops.
