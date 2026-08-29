# Governance Release always-Worker delivery

Bounded Cloudflare Worker transport for `roccho-dev/adrs#318` and `roccho-dev/ops#327`.

```text
Human / CI
  -> Cloudflare Access
  -> one fixed-route Worker
  -> one bounded GitHub read credential
  -> exact public or private Release asset ID
  -> byte count + SHA-256 verification
  -> JSON response
```

## Single delivery model

The browser always uses the Worker. It never selects between GitHub and Worker and never falls back between them.

```text
public repository  -> same Worker -> credentialed GitHub API -> exact asset
private repository -> same Worker -> credentialed GitHub API -> exact asset
```

A public governance Release is the initial fixture for the common delivery path, not a public-only production route.

## Production routes

```text
/data/manifest
/data/accepted-decision
/health
/config
```

Private fixture routes exist only while the short-lived proof flag is installed:

```text
/proof/private/manifest
/proof/private/events
```

The provider workflow removes the proof credential and flags after the proof, then verifies that private routes return `404` and public transport remains available.

## Boundary

- `gov*` owns semantic reduction and Release assets.
- This package owns transport/authentication verification only.
- UI owns runtime fetch and view-only reduction.
- Worker routes are allowlisted; arbitrary URL/repository/Release input is rejected.
- GitHub credentials are server-side only and never enter a browser response, receipt, or error.
- No DB, KV, R2, D1, mirror, HTML generation, or current decision reduction.

## Provider proof

The proof uses one short-lived bounded GitHub credential to read:

- exact public `roccho-dev/governance` Release assets;
- exact private `roccho-dev/adrs` Release fixture assets.

It also creates a temporary Cloudflare Access service token and exact-domain Access application, proves anonymous blocking and authenticated exact-body readback, then deletes both.

Human email OTP remains a separate persistent configuration. `bootstrap-access.mjs` permits only exact emails plus a selected OTP IdP; it forbids Everyone, domain-wide, and bypass policy shapes.

## Required Environment values

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
```

Cloudflare token permissions required by the complete provider proof:

```text
Workers Scripts: Edit
Access: Apps and Policies Edit
Access: Service Tokens Edit
```

One GitHub credential source is required:

```text
preferred:
ADRS_READER_CLIENT_ID
ADRS_READER_PRIVATE_KEY

bounded fallback:
GITHUB_RELEASE_TOKEN
```

The GitHub credential must read only the selected `adrs` and `governance` repositories with `Contents: read`.

## Local checks

```sh
cd packages/gov-release-proxy
npm run check
npm run check:dry-run
```

## Truth labels

```text
PROXY_CANDIDATE_GREEN
PUBLIC_PROXY_PASS
AUTHENTICATED_PUBLIC_UPSTREAM_PASS
PRIVATE_UPSTREAM_PASS
ACCESS_BOUNDARY_PASS
ACCESS_AUTHENTICATED_READBACK_PASS
```

None of these labels imply semantic authority, Human UI completion, production cutover, or legacy retirement.
