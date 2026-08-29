# ADRS #318 UI proposal ingress proof

This bounded proof avoids putting a GitHub write credential in a public Worker.

```text
browser UI
→ same-origin POST of one fixed non-authority canary
→ conditional immutable R2 proposal object
→ ADRS-owned GitHub Actions relay authenticated to Worker with GitHub OIDC
→ ADRS Issue comment through that repository's own GITHUB_TOKEN
→ exact comment readback
→ OIDC acknowledgement
→ immutable R2 recorded receipt
→ UI status becomes recorded
```

## Security boundary

- The Worker accepts only the fixed `adrs318-ui-proposal-oidc-canary-v1` payload.
- The Worker has no GitHub token, App private key, PAT, or Issues permission.
- Relay endpoints require a verified GitHub Actions OIDC JWT from the exact `roccho-dev/adrs` workflow on `refs/heads/proposals`.
- The ADRS workflow writes only to its own fixed Issue `#318` with its own short-lived `GITHUB_TOKEN`.
- Proposal and acknowledgement writes are R2 conditional appends with exact readback.
- `recorded` means GitHub comment append/readback only; gov materialization, current state, authority, and cutover remain false.

The prior direct credential probes are retained as evidence that the Ops Cloudflare environment has no suitable GitHub write credential and the existing `ADRS_READER` GitHub App is intentionally read-only.
