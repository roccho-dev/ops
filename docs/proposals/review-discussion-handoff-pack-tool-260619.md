# Review Discussion Handoff Pack Tool Proposal

Status: corrected candidate
Date: 2026-06-19

## Claim

`policy.git` defines the handoff package protocol, but ops may provide a purpose-fit generator for minimal `review-discussion` packages. The generator is transport/projection machinery only and must never decide or infer authority.

## Required Behavior

- Read the manifest schema and protocol from an immutable `policy.git` ref.
- Accept explicit source refs and selected source paths.
- Emit `HANDOFF_MANIFEST.json`, `REQUEST.md`, `BACKGROUND.md`, evidence hashes, and selected snapshots.
- Set all authority flags to `false`.
- Write archive digest outside the archive and reference it through `container.externalDigestRef`.
- Treat unknown JSONL and generated catalogs as non-authority evidence.
- Resolve authority only from an accepted non-governance decision or exact registry row supplied as explicit input.
- Return INDETERMINATE/report-only when that input is absent; never fall back to governance, path names, recency, or generated catalogs.

## Non-Goals

- Do not create approval, authorization, or route decisions.
- Do not own the exact registry or any domain facts.
- Do not use governance as catalog authority.
- Do not require role-catalog, topology, command-board, or thread-roster inputs for a discussion-only package.

## Acceptance

- A fresh reviewer can validate the manifest against the pinned policy schema.
- The package can be consumed without conversation history.
- Exact refs are recorded for all supplied repositories.
- Drift files are evidence only.
- A destructive test confirms that missing authority input yields INDETERMINATE and that governance/path inference never produces a blocking verdict.
