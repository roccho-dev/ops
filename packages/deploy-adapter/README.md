# deploy-adapter

Minimal provider-effect contract for deployment adapters.

## Purpose

Keep deployment providers replaceable without inventing a deployment framework.

An adapter owns only the provider effect:

1. deploy one already-selected source root;
2. obtain the deployment URL;
3. perform one public HTTP readback;
4. emit one non-authority receipt.

Policy, application build semantics, project selection, credentials, DNS, promotion, and
business meaning stay outside this package.

## Adapter interface

Every provider adapter is directly executable. There is no generic dispatcher.

Required arguments:

- --root PATH: source root to deploy
- --source-revision REV: immutable source identity supplied by the caller
- --probe-path PATH: public readback path, beginning with /
- --target preview|production

Provider credentials and provider target identifiers are environment inputs.

Success:

- stdout contains exactly one JSON object followed by a newline;
- the object satisfies contract.jsonl and verify.py;
- exit status is 0 only after provider deployment and public readback both pass.

Failure:

- exit status is non-zero;
- no PASS receipt may be emitted.

Logs belong on stderr so stdout remains machine-readable.

## Receipt

The success receipt is intentionally small and contains only directly observed facts:

- schema = ops.deploy-effect.receipt/1
- authority = false
- status = PASS
- provider
- target
- sourceRevision
- deploymentUrl
- probe.path
- probe.status

This receipt is evidence only. It does not authorize a deployment.

## Local and CI

Local and CI call the same provider adapter. Authentication is the only expected
difference: interactive/local credentials may be supplied by the operator, while CI
materializes bounded credentials from its secret store.
