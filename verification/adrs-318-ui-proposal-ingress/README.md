# ADRS #318 approved Semantic Map proposal ingress

The active browser surface is generated from an exact `ui` commit with the repository-owned Semantic Map generator. It opens in `map/1` and shows the nested `adrs / governance / ops → packages → package` sample. The previous fixed-form canary UI is retired and absent from the deployed assets.

```text
exact ui commit
→ Semantic Map generator
→ map/1 package map
→ select pkg.adrs318.canary
→ UI connectability prepares canonical non-authority proposal
→ same-origin POST
→ conditional immutable R2 proposal object
→ ADRS-owned GitHub Actions relay authenticated with GitHub OIDC
→ ADRS Issue comment through the repository's own short-lived GITHUB_TOKEN
→ exact comment readback
→ OIDC acknowledgement
→ conditional immutable R2 recorded receipt
→ Semantic Map status becomes recorded
```

## Active URL

```text
https://stg-adrs-ui-proposal-ingress.roccho.workers.dev/
```

The deployment proof must generate the expected UI and pass a real Chromium visual check before `wrangler deploy`. It then byte-compares every deployed static asset, selects the visible canary package in the live map, previews a geometry-free proposal, submits it, and observes exact Issue comment readback.

## Ownership boundary

- `ui/packages/semantic-map/**` owns the map runtime, `map/1` projection and maxGraph renderer.
- `ui/packages/connectability/**` owns canonical JSON preparation plus same-origin submit/observe.
- this Ops package owns the fixed proposal adapter, exact UI materialization, Worker ingress, R2 storage and deployment proof.
- the ADRS repository owns Issue write authority through its own GitHub Actions token.
- the Worker has no GitHub token, App private key, PAT or Issues permission.
- `recorded` means Issue append and exact readback only; it does not mean accepted, materialized or current.

## Bounded canary

```text
proposal_id: adrs318-ui-proposal-oidc-canary-v1
package_id: pkg.adrs318.canary
target: roccho-dev/adrs#318
authority: false
cutover: false
```

The Worker accepts only this fixed canary meaning. Same meaning is idempotent; the same ID with different meaning is rejected. Arbitrary package operations, arbitrary repositories or Issues, human authentication, governance materialization, semantic Release update and current-state mutation remain outside this proof.
