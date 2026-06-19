---
name: find-packages
description: Find reusable SSOT packages, tools, adapters, skills, and projection assets for a task. Use when Codex must choose an existing package/tool instead of inventing one, connect a task to package definitions in adrs or SSOT repos, report package proof state, or create a schema/package request when no reusable package exists.
---

# Find Packages

Use this skill only as a discovery header. It is not the package catalog and it must not hardcode package lists.

Route to the owning package:

- package: `ops:packages/find-packages`
- core: `lib/find-packages-core.mjs`
- CLI adapter: `bin/find-packages.mjs`
- read-model templates: `sql/*.duckdb.sql`
- docs: `README.md`

Search adrs projection outputs first, then owning repo package surfaces. Treat adrs raw/proposal rows and generated projections as inputs/evidence, not accepted package truth.
