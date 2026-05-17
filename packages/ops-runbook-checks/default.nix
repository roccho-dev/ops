builtins.fromJSON ''
{
  "kind": "ops.packageImplementationMetadata.v1",
  "package": "ops-runbook-checks",
  "repoId": "ops",
  "mission": "Verify that AGENTS.md and .agents routes expose the current static policy surface without claiming live ChatGPT, review, merge, push, or completion success.",
  "primaryTarget": "packages/ops-runbook-checks",
  "requiredOutputs": "packages.<system>.ops-runbook-checks",
  "requiredChecks": "ops-runbook-checks.static-root-and-legacy-negative-fixture",
  "responsibility": "Check minimum policy router paths, schemas, package entrypoints, package/check wiring, and explicit not-proven boundaries so static checks cannot be mistaken for ChatGPT readback, artifact receipt, review, merge, push, or complete-approved.",
  "forbiddenResponsibility": "Does not prove live Project Source readback, artifact receipt, review pass, merge-review pass, route-gated push, or complete-approved; does not preserve legacy success tokens as pass conditions."
}
''
