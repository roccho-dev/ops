# ADRS #322 real public effect proof

Bounded child of `roccho-dev/ops#341` and accepted `roccho-dev/adrs#322`.

This package proves only:

```text
accepted public-safe #322 meaning
→ deterministic public projection
→ candidate-scoped Cloudflare Worker/static assets
→ independent public byte readback
→ one real Chromium interaction
→ one immutable R2 observation
→ readback + deterministic re-projection
```

It reuses the exact shared kernel/Worker implementation from `../adrs-322-log-projected-application/`; this directory does not fork or promote that proof fixture into product ownership.

## Exact source

- acceptance: `roccho-dev/adrs#322#issuecomment-5448293184`
- status refinement: `roccho-dev/adrs#322#issuecomment-5448291210`
- shared kernel proof: `roccho-dev/ops#339` / PR `#340`

`public/projection.json` is a non-authority public-safe projection of the accepted meaning. The projection, HTML, Worker, R2 object, browser state, receipts, and provider responses are evidence/projections only.

## YAGNI boundary

No custom domain, current pointer, Queue, Durable Objects, D1, mail, identity/consent system, payment, CRM/CDP, generic event schema, generic workflow engine, or production cutover is introduced here.

The candidate-scoped `workers.dev` URL is used directly, so there is no mutable current pointer in this bounded proof.

## Observation classification

The one browser interaction is a **technical real-public-surface observation**, not a qualified market observation. It proves the physical return path only and must not be counted as demand, PMF, customer value, or revenue.
