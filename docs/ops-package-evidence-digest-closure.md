# ops package evidence digest closure

This PR closes the ops-side evidence mapping required by `ops#28` on top of the govPackageOutput surface from `ops#31`.

## Post-merge state

After this PR stack is merged:

- selected ops package rows are exposed in a `govPackageOutput.v1` packet;
- selected assertions carry `decisionDigest` and `assertionDigest` fields;
- selected receipts carry `decisionDigest`, `assertionDigest`, `checkId`, `status`, and `evidenceDigest` fields;
- residuals and unregistered packages are emitted as non-authority findings instead of being hidden;
- all admission rows remain `selected-warning`, not `organization-active`.

## Completion audit impact

Contributes to:

- `packageAudit` for ops selected package rows;
- `assertionAudit` for ops selected package claims;
- `receiptAudit` for digest-linked ops evidence;
- `downstreamAudit` for ops participation.

## Boundary

This closes ops evidence production only. It does not perform local required-check cutover and does not claim final governance admission.

## Supersession

The selected five-package packet described above is historical. The current execution
contract is [`ops-exact-gov-package-obligation-receipts.md`](ops-exact-gov-package-obligation-receipts.md): it consumes one exact gov release, covers the complete ops package universe, and binds actual Nix output receipts. This note changes no historical claim or authority.
