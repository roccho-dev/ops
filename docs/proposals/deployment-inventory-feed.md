# Deployment inventory feed

## Why

ADRS defines expected deploy log route policy. ops must provide deployed revision facts as non-authority evidence so governance can check coverage later.

## Scope

This PR defines the ops-side deployment inventory feed contract.

The feed records what revision is deployed where. It does not record log observation and does not decide closure.

## Record fields

- recordKind
- deploymentId
- serviceRef
- environment
- targetKind
- targetRef
- revisionRef
- repoCommit
- artifactDigest
- providerRevisionId
- deployedAt
- observedAt
- sourceDigest
- authority

## Boundary

- No ADRS policy authority.
- No log route observed receipt.
- No governance join check.
- No provider-specific adapter in this PR.

## Merge gate

The feed must remain non-authority. Provider-specific VPS, serverless, container, and worker adapters are follow-up PRs.
