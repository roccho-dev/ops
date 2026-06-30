# Ops package response and check adoption implementation

## Purpose

Open and complete the ops-side adoption PR for the package obligation system.

Ops emits package-level responses for its owned runtime and operational evidence surfaces and runs governance-connected checks in CI.

## Implemented scope

This PR implements:

- `packages/ops-package-responses/bin/ops-package-responses.mjs`
- `packages/ops-package-responses/tests/e2e.mjs`
- `build/packages.jsonl` registration for `ops-package-responses`
- `build/checks.jsonl` registration for `ops-package-responses`
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

Each package response row carries `claim_id`, `adrs_ref`, `obligation_id`, `repo_locator`, `package_id`, `package_path`, `owner_role`, `state`, `covered_requirements[]`, `test_refs[]`, `evidence_refs[]`, `receipt_ref`, `residuals[]`, `blocked_reason`, `evidence_freshness`, and `overclaim_boundary`.

## Validation

`ops-package-responses validate --out-dir <dir>` checks required response shape, evidence freshness, evidence linkage, receipt linkage, residual return, and non-authority boundaries.

`ops-package-responses selftest` includes a negative fixture that must fail when `evidence_freshness` is missing.

## CI wiring

`gov-package-validation.yml` runs `nix flake check`, emits and validates the response packet, runs the currently exported governance checker selftest, and uploads `ops-package-response-out`.

## Non-goals

- Do not define ADRS meaning in ops.
- Do not replace governance checks with ops-local shared authority.
- Do not claim runtime adoption without evidence.
- Do not claim the governance reusable package check export is complete from ops; the residual is returned to governance #64.

## Acceptance

This PR is no longer a work-order-only PR. It implements the ops package response emitter, validator, response packet CI wiring, generated check registration, and governance-connected check adoption boundary for ops.
