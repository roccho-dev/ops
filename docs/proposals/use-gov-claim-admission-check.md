# Use governance claim admission checker

## Why

`ops` already has a staged real-claim admission check. It is useful for surfacing real input drift, but the admission join itself must not remain a second source of governance logic inside a feat repo.

## Decision

Add an ops-side adapter that can call a governance-exported claim admission checker when the export exists.

Ops keeps only repo-local port work:

- read `spec/implements.json`
- emit downstream assertions
- emit current CI receipts from those assertions
- pass ADRS-derived upstream grants as an input file

Governance owns the shared admission join:

- grant/assertion/receipt join
- `admissionResult`
- `diagnosticClass`
- official-view compatibility

## Implementation

`tools/check-ops-real-claim-admission.mjs` now accepts `--governance-checker`, `OPS_CLAIM_ADMISSION_CHECKER`, `--spec`, `--upstream-grants`, and `--admissions-out`.

When no governance checker is provided, the existing staged local adapter remains the fallback. When a checker is provided, ops writes downstream assertions and receipts to temporary JSONL files, passes them to the governance checker, and reports `checkerSource: external-governance`.

## Quality gate

Add `ops-real-claim-admission-governance-adapter-fixture` to prove that the ops adapter calls an external governance checker without losing the current report surface.

## Dependency

This PR is compatible with governance checker export. It does not require the export to be present in ordinary CI because the fallback remains staged.

## Boundary

This PR does not fabricate upstream grants, does not claim `organization-active` for real ops inputs, and does not remove the staged-warning fallback.

## Merge gate

Merge when `nix flake check` proves both the existing staged check and the governance-adapter fixture.
