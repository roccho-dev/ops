# ADRS #318 UI proposal ingress

This bounded path avoids putting any GitHub write credential in a public Worker.

```text
browser UI
→ same-origin POST of one fixed non-authority proposal
→ conditional immutable R2 proposal object
→ ADRS-owned GitHub Actions relay authenticated to Worker with GitHub OIDC
→ ADRS Issue comment through that repository's own short-lived GITHUB_TOKEN
→ exact comment readback
→ OIDC acknowledgement
→ conditional immutable R2 recorded receipt
→ UI status becomes recorded
```

## Proven canary

```text
Worker:
https://stg-adrs-ui-proposal-ingress.roccho.workers.dev/

proposal_id:
adrs318-ui-proposal-oidc-canary-v1

ADRS comment:
https://github.com/roccho-dev/adrs/issues/318#issuecomment-5462452549
```

The Worker, R2 queue, real browser submit, ADRS-owned relay, comment append, exact readback, acknowledgement, recorded status, duplicate suppression and unauthenticated relay rejection have all executed against the real providers.

## Security boundary

- The Worker accepts only the fixed `adrs318-ui-proposal-oidc-canary-v1` payload in this proof.
- The Worker has no GitHub token, App private key, PAT or Issues permission.
- Relay endpoints require a verified GitHub Actions OIDC JWT from the exact `roccho-dev/adrs/.github/workflows/adrs-318-ui-proposal-relay.yml@refs/heads/proposals` workflow.
- The ADRS workflow writes only to its own fixed Issue `#318` using its own short-lived `GITHUB_TOKEN` with `issues: write`.
- Proposal and acknowledgement writes are R2 conditional appends with exact readback.
- Same proposal meaning is idempotent; the same ID with different meaning is rejected.
- Cross-origin UI submission and relay access without the exact OIDC identity fail closed.
- `recorded` means GitHub comment append/readback only.

## Claim ceiling

```json
{
  "claim_ceiling": "UI_TO_ADRS_COMMENT_OIDC_RELAY_PROVEN",
  "ui_submit": true,
  "r2_proposal_append": true,
  "automatic_oidc_relay": true,
  "adrs_comment_recorded": true,
  "exact_comment_readback": true,
  "worker_github_write_credential": false,
  "gov_materialized": false,
  "current_changed": false,
  "authority_changed": false,
  "cutover": false
}
```

The final generic editor contract, arbitrary target Issues, human authentication, gov materialization, semantic Release update and reappearance in the decision UI remain outside this bounded canary.
