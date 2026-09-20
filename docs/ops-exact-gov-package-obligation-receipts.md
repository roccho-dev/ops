# Exact gov package obligations to actual ops receipts

## Decision implemented

The former fixed five-package response list is removed.

```text
exact gov release
→ NAR-verified gov-package-output/package-obligations.jsonl
→ complete ops package inventory
→ actual required Nix checks
→ one response and receipt per package
→ strict governance-facing packet
```

The implementation reuses the existing `packageObligation.v1`,
`packageResponse.v1`, `govReleaseManifest.v1`, `govNixOutputDescriptor.v1`, and
governance packet families. It introduces no accepted meaning or new authority.

## Receipt binding

Each package receipt binds:

- exact gov release, accepted decision, and governance engine commit;
- exact obligation ID and digest;
- ops commit and tree;
- exact package Git source objects and declared entrypoint byte digests;
- every required check command;
- actual Nix output NAR hashes, file counts, and byte counts;
- retained stdout/stderr bytes and their digests;
- returned residuals when closure is incomplete.

## Fail-closed rules

- a package without an exact obligation is blocked;
- an obligation without a package is blocked;
- path or entrypoint drift is blocked;
- a required claim without required tests is blocked;
- a failed check or check without a materialized output is blocked;
- a dirty ops worktree is rejected before execution;
- a missing or modified execution log is rejected;
- tampered release output is rejected before package execution;
- a blocked packet may be retained as evidence, but strict validation fails;
- ops never marks a package `organization-active`.

## Provider boundary

GitHub Actions is only a compute and artifact adapter. Every PR/push first runs
the deterministic contract selftests, then resolves the newest compatible
published content-addressed gov release and executes its exact package obligations
against the exact candidate SHA. An explicit workflow dispatch may pin an exact
release tag instead. A compatible release must include `gov-package-output.tar.gz`
and its digest; absence of a compatible published release is blocking, not Green.
The exact governance engine commit is read from that release and the extracted
NAR hash must match its descriptor.
