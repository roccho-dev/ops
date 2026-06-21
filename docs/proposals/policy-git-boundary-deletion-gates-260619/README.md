# policy.git Boundary Deletion Gates for Ops

Status: proposal only.

This proposal does not delete policy.git and does not remove ops tools.

## Decision

Ops must support the policy.git boundary retirement by making transport,
handoff, and proof tooling detect active policy.git dependencies and route
failure recovery to the accepted adrs/governance projection instead of relying on
operator memory.

## Ops Cutover Gates

| Gate | Required state before deletion |
|---|---|
| Tool inventory | ops tools and docs that mention policy.git, policy-master, or local policy repo paths are inventoried. |
| Canonical route | Project Sources and handoff tools route reviewers to accepted artifacts, not base64 fallback or conversation memory. |
| Consumer scan | ops can report active policy.git references across repo inputs and generated handoff bundles. |
| Failure recovery | failed upload/readback routes show the canonical file-upload path and source inventory before fallback. |
| Evidence retention | reviewer verdicts, hashes, commands, and blocked gates are exported as evidence input to adrs. |
| No authority creep | ops tooling remains transport/evidence machinery and never grants semantic approval, merge approval, cutover, or deletion. |

## Non-Goals

- Do not remove ops-cdp-core or project transport packages.
- Do not make Project Sources canonical SSOT.
- Do not revive base64 chunk transport as a preferred route.
- Do not delete policy.git while active consumers remain.

## Verification

This proposal is documentation-only. Verification for this branch is:

- ops flake checks pass or the existing package check surface remains evaluable.
- project transport can still list/upload/read back sources through the file route.
- git diff whitespace check passes.

