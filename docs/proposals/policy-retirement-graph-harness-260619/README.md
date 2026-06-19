# Policy Retirement Graph Harness

Status: proposal only.

This proposal does not delete policy.git and does not make ops semantic
authority.

## Decision

Ops should provide tooling and runbooks that extract graph inputs, run
counterexample loops, and preserve reviewer evidence for policy.git retirement.
Ops tools may report evidence and blockers, but never grant semantic approval,
merge approval, cutover approval, or deletion approval.

## Harness Responsibilities

| Harness function | Required behavior |
|---|---|
| source inventory | list policy source files, digests, modes, and candidate normative spans |
| edge inventory | list active policy.git consumer refs across repos and generated bundles |
| counterexample runner | execute negative cases and require fail-closed outcomes |
| refreshed-agent runner | hand a fixed accepted entry plus graph projection to a fresh agent and capture readback |
| evidence export | export commands, hashes, verdicts, failures, and reviewer readbacks to adrs inputs |
| transport route | prefer Project Sources/file route and report fallback as fallback, not canonical |

## Completion Blocking Results

The harness must block completion when it sees:

- active policy.git refs;
- prose-only normative source spans without typed semantic nodes;
- projection mismatch or non-reproducible artifact;
- stale or moving entry route;
- fallback success where fail-closed was expected;
- fresh agent using private task context rather than accepted entry/projection.

## Non-Goals

- Do not make ops the policy source of truth.
- Do not make Project Sources or conversation history canonical SSOT.
- Do not revive base64 transport as preferred route.
- Do not delete or mutate external services without explicit owner approval.

## Verification

Documentation-only proposal verification:

- ops flake check passes.
- git diff whitespace check passes.

