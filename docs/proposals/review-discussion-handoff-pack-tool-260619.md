# Review Discussion Handoff Pack Tool Proposal

Status: proposal
Date: 2026-06-19

## Claim

`policy.git` defines the handoff package protocol, but this repository does not yet provide a purpose-fit tool for building a minimal `review-discussion` handoff package for an external Gen1 discussion.

## Proposed Role

Add an ops-owned generator that assembles a schema-valid `handoff.package.v1` zip from explicit repo refs and selected paths. The tool must not decide authority, approve content, or replace policy.

## Required Behavior

- Read the manifest schema and protocol from `policy.git`.
- Accept explicit source refs and source paths.
- Emit `HANDOFF_MANIFEST.json`, `REQUEST.md`, `BACKGROUND.md`, evidence hashes, and selected repo snapshots.
- Set all `authorityFlags` to `false`.
- Write archive digest outside the archive and reference it through `container.externalDigestRef`.
- Treat unknown JSONL and generated catalogs as non-authority evidence unless an external authority says otherwise.

## Non-Goals

- Do not create approval.
- Do not infer SSOT authority from path names.
- Do not use `bootstrap#handoff-entry` while it still routes through governance as catalog authority.
- Do not require role-catalog, topology, command-board, or thread-roster inputs for a discussion-only package.

## Acceptance

- A fresh reviewer can validate the manifest against `policy/schemas/handoff-package-manifest.v1.schema.json`.
- The generated package can be consumed without conversation history.
- The package records exact refs for `policy.git`, `adrs.git`, `bootstrap.git`, and any task-specific repos.
- The package includes drift files as evidence only, not as truth.
