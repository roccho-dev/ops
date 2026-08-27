# Governance Release proxy

Bounded Cloudflare Worker transport for `roccho-dev/adrs#318` and `roccho-dev/ops#327`.

```text
Cloudflare Access
  -> Worker fixed route
  -> exact GitHub Release asset ID
  -> byte count + SHA-256 verification
  -> JSON response
```

## Current proof input

The public proof pins one existing `roccho-dev/governance` Release and two JSON assets. It does not use `latest`, accept arbitrary URLs, reduce decision meaning, or claim authority.

```text
/data/manifest
/data/accepted-decision
/health
/config
```

## Boundary

- `gov*` owns semantic reduction and Release assets.
- This package owns transport verification only.
- UI owns runtime fetch and view-only reduction.
- Access is enforced by Cloudflare before Worker execution.
- Public proof needs no GitHub credential.
- Private proof later sets `GITHUB_RELEASE_TOKEN`; no route or UI contract changes.
- No DB, KV, R2, D1, mirror, HTML generation, or current decision reduction.

## Cloudflare configuration

Required for public proxy deployment:

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN with Workers Scripts: Edit
```

Optional Access bootstrap:

```text
CF_ACCESS_ALLOWED_EMAILS_JSON=["person@example.com"]
CF_ACCESS_OTP_IDP_ID=<Cloudflare One-time PIN IdP UUID>
CLOUDFLARE_API_TOKEN additionally has Access: Apps and Policies Edit
```

Optional CI authenticated readback after creating a service token:

```text
CF_ACCESS_CLIENT_ID
CF_ACCESS_CLIENT_SECRET
```

The Access bootstrap never creates an Everyone, domain-wide, or bypass policy. It binds an exact Worker hostname, exact email addresses, and the selected OTP IdP.

## Local checks

```sh
cd packages/gov-release-proxy
npm run check
npm run check:dry-run
```

## Completion labels

- Unit and dry-run only: `PROXY_CANDIDATE_GREEN`
- Deployed public asset exact readback: `PUBLIC_PROXY_PASS`
- Anonymous request blocked by Access: `ACCESS_BOUNDARY_PASS`
- Service token exact body readback: `ACCESS_AUTHENTICATED_READBACK_PASS`
- Private Release readback: not part of the public proof
- Cutover: false
