builtins.fromJSON ''
{
  "kind": "ops.packageImplementationMetadata.v1",
  "package": "ops-runbook-checks",
  "repoId": "ops",
  "mission": "Verify that AGENTS.md is a small entrypoint into reusable specs/ops packages, FSM gates, and raw evidence locations.",
  "primaryTarget": "packages/ops-runbook-checks",
  "requiredOutputs": "packages.<system>.ops-runbook-checks",
  "requiredChecks": "ops-runbook-checks.sample-root",
  "responsibility": "Check minimum runbook paths, ops-thread-fsm paths, package/check wiring, and AGENTS.md navigation tokens so future gen0 can recover without memory.",
  "forbiddenResponsibility": "Does not duplicate long operational knowledge in AGENTS.md and does not promote raw evidence automatically."
}
''
