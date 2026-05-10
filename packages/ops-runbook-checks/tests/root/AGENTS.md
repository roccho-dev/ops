# AGENTS.md

Small entrypoint only. Long operational evidence and raw artifacts stay out of AGENTS.md.

Use packages and specs instead of memory:
- ops-thread-fsm
- ops-runbook-checks
- ops-artifact-materialize
- ops-tailnet-github-egress
- ops-refs-vault

FSM and gate vocabulary:
- plan-accepted
- false-blocker
- insufficient-plan
- escalation-needed
- delivery-verified
- impl-review
- impl-review-pass
- ready-for-merge-review
- merge-review
- merge-review-pass
- merge-ready

Generic `review-pass` is not sufficient; use explicit gate pass tokens above.

State/evidence:
- events.jsonl is the source of truth
- status.md is generated
