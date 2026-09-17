---
name: gosh
description: Use the single ops-owned Codex skill to locate proven local capabilities and their placement contract. Use when Codex needs an ops capability or must verify how that capability is retained and materialized; current gosh query and ensure are not implemented.
---

# gosh

This is the single agent-facing skill owned by `roccho-dev/ops`. It is a thin discovery surface, not capability authority and not a replacement for the `gosh` executable contract.

Keep two facts reachable from this file:

1. The skill source and its observed-use evidence live in this repository under `packages/gosh/skill/`.
2. The repository's placement convention for local executable capabilities lives at `roccho-dev/ops:capabilities/README.md`.

## Current proven capability knowledge

For Windows host storage recovery backed by WSLC, read [references/wslc-storage-reclaim.md](references/wslc-storage-reclaim.md) before acting. Its bounded proof is [proof/wslc-storage-reclaim-20260917.json](proof/wslc-storage-reclaim-20260917.json).

Do not treat the reference as an admitted executable entry in `capabilities/index.jsonl`. It is a safety-sensitive runbook until a separately specified and proved executable contract exists.

## Boundary

- Do not invent `gosh query`, `ensure`, materialization, index authority, or generic schema behavior that the current repository does not implement.
- Do not search the web, install approximate packages, use `latest`, or resolve an executable through ambient `PATH` on behalf of a capability.
- Treat identities, paths, sizes, timestamps, and container sets in proof files as historical evidence only, never as defaults or execution inputs. Rediscover current values for every attempt.
- State-changing work still requires the capability's own current authorization and safety gates.
- If repository source, installed copy, or proof identity differs, report the mismatch instead of silently choosing one.
