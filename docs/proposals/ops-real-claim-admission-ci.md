# Ops real claim admission CI proposal

## Why

The claim-port route must show real input drift before it becomes a hard organization admission gate.

## Decision

Add `ops-real-claim-admission` to generated checks. The check reads real downstream claims from `spec/implements.json`, emits CI receipts from the current claim set, and looks for ADRS-derived upstream grants at `claims/upstream-grants.jsonl`.

If upstream grants are missing or do not match the downstream claims, the check emits `adrs-lagging-feat`, `feat-lagging-adrs`, `claim-stale`, or another diagnostic class.

The default CI mode is `staged-warning`: it surfaces the diagnostic report and passes without fabricating upstream grants. Strict failure is available by running the check with `OPS_REAL_CLAIM_ADMISSION_STRICT=1` or `--strict`.

## Boundary

This PR does not claim `organization-active` for real ops inputs. It does not fabricate upstream grants. It does not enable a branch-protection hard gate.

## Merge gate

Merge this PR only as a staged diagnostic gate. A follow-up may convert it to strict mode after the ADRS-derived upstream grant projection exists or after the selected universe is explicitly narrowed.
