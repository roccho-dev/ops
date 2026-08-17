# ops

Operational packages implemented against `repos/specs`.

This repo starts as an empty implementation target. Worker threads must add
package outputs according to the `specs` package catalog and keep check outputs
package-backed.

## Purpose

`ops` builds operational packages and checks that implement accepted governance
contracts as package-backed, reproducible Nix outputs.

## Authority boundary

README.md is a checked artifact. It may be handwritten, partially managed, or
generated according to readme_mode. README.md is not an independent authority.

`ops` performs effectful implementation work through package and check outputs.
Governance inputs provide non-authority policy/check implementation; accepted
decisions remain outside this README and outside GitHub provider workflows.

## Inputs

- `governance`: non-authority governance source used by existing package checks.
- `conventionGovernance`: repo convention check helper.
- `nixpkgs`, package build declarations, and pinned source inputs.

## Outputs / artifacts

- operational package outputs.
- check outputs from `nix flake check`.
- provider CI adapter receipts from GitHub Actions.
- repo-head Release Carrier retrieval and verification runbook:
  [`runbooks/repo-head-carrier.md`](runbooks/repo-head-carrier.md).
- package response packet emitted by `ops-package-responses`, including responses,
  evidence, receipts, residuals, and a non-authority manifest.

## Checks

The primary verification entrypoint is `nix flake check`.

`.github/workflows/*.yml` files are checked-in provider adapter artifacts. They
are executable by GitHub, but they are not authority. GitHub provider workflows
are declared by `ci.intent.v1.jsonl`.

`gov-package-validation.yml` additionally emits and validates the ops package
response packet and runs the currently exported governance checker selftest. This
keeps ops wired to governance diagnostics without making ops a shared meaning
authority.

## Ownership / handoff

`ops` owns operational package implementation and repo-local check wiring.
`governance` owns reusable convention check implementation, not this repo's
policy acceptance.
