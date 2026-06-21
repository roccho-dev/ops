# policy.git Retirement Without Deletion Proof

Status: proposal evidence.

This evidence pack proves the repo-executable parts of policy.git retirement
except actual deletion approval.

## Result

- legacy policy obligation rows: `1896`
- projected policy rules: `1896`
- projected rules cover legacy obligations: `true`
- active runtime policy.git references in projected consumer root: `0`
- absent-policy consumer proof: `PASS`
- explicit projected-consumer proof: `PASS`
- deletion approval gate: `BLOCKED`
- refreshed Codex as Gen2 verification: `PASS`

## Key files

| File | Purpose |
|---|---|
| `legacy_policy_obligation_table.jsonl` | Full machine-readable table of legacy policy obligations extracted from policy.git |
| `legacy_policy_obligation_table.md` | Human-readable table for audit review |
| `projected_policy_entry_manifest.json` | Accepted-source projected policy/law/runtime entry manifest |
| `accepted_projected_policy_entry_source.json` | Accepted-source record used to authorize the projection, without deletion approval |
| `deletion_readiness_gates.jsonl` | Gate results showing non-deletion gates pass and deletion approval remains blocked |
| `without_deletion_proof_summary.json` | Compact summary for downstream ADRS packaging |
| `gen2_refreshed_codex_verification.jsonl` | Fresh Gen2 verification result for the legacy obligation table, projection, and gates |

## Boundary

This pack does not approve:

- policy.git deletion
- policy.git retirement
- cutover
- canonical write
- SSOT adoption
- merge

It proves that the remaining executable work can be replayed from repo evidence:

1. compile the fixed policy input into semantic/native rows,
2. project those rows into policy entry artifacts,
3. accept the projection source without making generated output authority,
4. verify no active runtime policy.git references in the projected consumer root,
5. verify projected consumers pass with policy.git absent,
6. keep deletion approval blocked.
