# ops

`ops` is the governance-first proofbed for the AI factory.

Accepted meaning remains in ADRS. An exact `gov*` release projects that meaning into
package obligations. `ops` is the first downstream repository that executes those
obligations, records positive and destructive proof, and emits reusable package
receipts before product repositories adopt the same contract.

## Purpose

- preserve intended operating behavior as executable evidence;
- implement reusable operational packages;
- keep package-owned examples as proven golden fixtures;
- execute exact governance obligations before wider rollout;
- expose every missing obligation, test, receipt, output, or residual as non-Green.

## Authority boundary

- ADRS owns accepted decisions and package-obligation meaning.
- `governance` owns deterministic projection and the final organization join.
- `ops` executes package obligations and emits non-authority evidence.
- package receipts, GitHub workflows, generated artifacts, and this README do not
  mint accepted meaning or `organization-active` admission.

## Inputs

- one content-addressed gov release manifest and readback receipt;
- the release-bound `gov-package-output` Nix tree;
- `package-obligations.jsonl` from that exact tree;
- the exact ops commit/tree, package sources, and Nix checks;
- pinned build and runtime dependencies.

## Outputs / artifacts

- operational package outputs;
- check outputs from `nix flake check`;
- one `ops.packageReceipt.v2` per package in the exact target universe;
- blocking residuals for absent obligations, packages, entrypoints, tests, outputs,
  receipts, or release identity;
- a non-authority `govPackageOutput.v1` projection for the governance final join;
- provider CI adapter receipts from GitHub Actions;
- repo-head Release Carrier retrieval and verification runbook:
  [`runbooks/repo-head-carrier.md`](runbooks/repo-head-carrier.md).

## Checks

The primary verification entrypoint is `nix flake check`.

`ops-package-responses` accepts only an exact locally materialized gov release. It
executes every required Nix check and binds actual output NAR hashes into package
receipts. There is no local fallback obligation list and no fixed package selection.
Structural validation preserves blocked packets; strict validation fails when any
package is blocked.

`ops-gov-package-output` projects those exact receipts without claiming final
admission. `.github/workflows/gov-package-validation.yml` runs contract selftests on
ordinary changes and executes a real exact release only through an explicit
content-addressed `workflow_dispatch` input.

GitHub workflows are replaceable compute/effect adapters, not authority.

## Ownership / handoff

`ops` owns operational implementation, package execution, destructive proof, and
receipt emission. `governance` owns reusable projection and final join behavior.

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
