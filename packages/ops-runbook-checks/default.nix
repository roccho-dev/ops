builtins.fromJSON ''
{
  "kind": "ops.packageImplementationMetadata.v2",
  "package": "ops-runbook-checks",
  "repoId": "ops",
  "mission": "Verify that AGENTS.md is a small navigation entrypoint into reusable ops/specs packages and safe-continue FSM gates.",
  "primaryTarget": "packages/ops-runbook-checks",
  "requiredOutputs": "packages.<system>.ops-runbook-checks",
  "requiredChecks": "checks.<system>.ops-runbook-checks",
  "responsibility": "Check package anchors, flake wiring, and FSM/gate tokens so future gen0 and subagents can discover ops-thread-fsm, ops-artifact-materialize, ops-tailnet-github-egress, ops-refs-vault, and review gates without relying on memory.",
  "forbiddenResponsibility": "Does not implement CDP, artifact materialization, push, refs-vault, canonical merge, local gates, thread FSM behavior, or external-thread mechanics.",
  "requiredAgentsTokens": [
    "ops-thread-fsm",
    "ops-runbook-checks",
    "ops-artifact-materialize",
    "ops-tailnet-github-egress",
    "ops-refs-vault",
    "delivery-verified",
    "impl-review",
    "impl-review-pass",
    "merge executor",
    "merge-candidate-ready",
    "ready-for-merge-review",
    "localizer",
    "localized-local-gate-pass",
    "remote-backup-verified",
    "role-override",
    "post-hoc-merge-review-required",
    "merge-review",
    "merge-review-pass",
    "merge-ready",
    "plan-accepted",
    "false-blocker",
    "insufficient-plan",
    "escalation-needed"
  ],
  "flakeTokens": [
    "ops-thread-fsm",
    "ops-runbook-checks",
    "ops-thread-fsm-check",
    "ops-runbook-checks-check",
    "writeShellApplication",
    "runCommand"
  ],
  "acceptance": [
    "AGENTS.md remains a small entrypoint, not a raw evidence dump",
    "abstract thread lifecycle anchors are discoverable",
    "explicit impl-review-pass and merge-review-pass are discoverable",
    "generic review-pass alone is insufficient",
    "ops/flake.nix wires ops-thread-fsm and ops-runbook-checks packages/checks"
  ]
}
''
