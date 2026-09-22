# Vercel deploy adapter

Provider implementation of the minimal deploy-adapter contract.

It invokes exact Vercel CLI `59.23.1`, deploys the caller-selected source root,
performs a public HTTP readback, and emits one non-authority receipt only after both
succeed.

## Inputs

Secret:

- `VERCEL_TOKEN`

Non-secret target identity:

- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

The adapter does not discover or create a project. Missing target identity fails
before the provider effect.

## Boundary

The adapter does not own application build semantics, project selection policy,
credentials, domains, promotion, or rollback policy.

Preview is the default target. Local and CI execute the same `deploy.mjs`.
