# ops gov-package-output boundary

This repo emits exact, non-authority package execution evidence for governance
joins.

## Boundary

- ADRS owns accepted package-obligation meaning.
- the exact gov release owns the selected obligation projection identity;
- governance owns final joins and `organization-active` admission;
- ops executes every required package check and emits receipts and residuals;
- `ops-gov-package-output` never mints final admission.

## Input and output

`ops-gov-package-output execute --release-dir <dir>` first runs
`ops-package-responses` against the exact release. It then projects every response,
actual Nix-output receipt, blocking finding, and inactive admission row into a
`govPackageOutput.v1` packet with `projectionMode=exact-release-execution`.

A package is `candidate-pass` only when its exact obligation has a PASS receipt and
no blocking finding. All admission rows remain `active:false` until consumed by the
governance final join.

`validate` verifies structural closure. `validate --strict` fails when any package
is blocked. `selftest` proves exact projection, blocked propagation, missing receipt
rejection, and the no-final-admission boundary.
