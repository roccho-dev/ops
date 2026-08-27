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

## Locked browser artifacts

`packages/artifact-assembly` composes browser artifacts from canonical JSONL locks without owning domain meaning or renderer implementation.

Current locks:

- `locks/semantic-map-a2ui.jsonl`
- `locks/accounting-a2ui.jsonl`

The accounting lock pins the UI-owned directory artifact by Git revision and SHA-256 tree digest. The official `@a2ui/web_core` package remains a required external input and is fail-closed until its exact digest and bytes are available. OPS does not contain accounting reducers, `TAccount` rendering, or A2UI projection code.

## Cross-repository retirement gate

`verification/legacy-diagram-retirement/verify.mjs` rejects a merged bundle set when the UI current tree still contains the retired diagram package, its dedicated workflow, or `.drawio` artifacts. The old source commit/tree must remain reachable through Git history.

`verification/url-source-roundtrip/verify.mjs` proves that both inline and reference semantic-map URLs decompile through the public codec into canonical State JSONL, accepted DecisionLog JSONL, and complete Envelope JSON, with Proposal preview state kept separate.

## Large URL continuation

`verification/publisher-continuation/verify.mjs` independently proves the oversized update path: side-effect-free preflight, explicit POST, validated storage receipt, atomic runtime commit, digest-reference GET, and fresh State/DecisionLog reopen. A missing publisher fails closed; Local Draft rejection keeps the current URL without network writes.
