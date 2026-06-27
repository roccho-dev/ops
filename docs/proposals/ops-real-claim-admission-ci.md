# Ops real claim admission CI proposal

## Why

The claim-port route must eventually fail on real inputs when ADRS-derived upstream grants and downstream feat claims do not match.

## Decision

Add `ops-real-claim-admission` to generated checks. The check reads real downstream claims from `spec/implements.json`, emits CI receipts from the current claim set, and looks for ADRS-derived upstream grants at `claims/upstream-grants.jsonl`.

If upstream grants are missing or do not match the downstream claims, the check emits `adrs-lagging-feat`, `feat-lagging-adrs`, `claim-stale`, or another diagnostic class and exits non-zero.

## Boundary

This PR intentionally introduces a strict real-input gate. It does not fabricate upstream grants. If the check is red, the next fix is to add the ADRS-derived upstream grant projection or narrow the selected universe.

## Merge gate

Merge only after the selected real input set reaches `organization-active`, or consciously convert this strict check into a staged warning gate in a follow-up decision.
