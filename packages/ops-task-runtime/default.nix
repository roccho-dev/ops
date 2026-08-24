builtins.fromJSON ''
{
  "kind": "ops.packageImplementationMetadata.v1",
  "package": "ops-task-runtime",
  "repoId": "ops",
  "mission": "Materialize the portable task runtime accepted by roccho-dev/adrs#317.",
  "primaryTarget": "packages/ops-task-runtime",
  "requiredOutputs": "packages.<system>.ops-task-runtime",
  "requiredChecks": "checks.<system>.ops-task-runtime",
  "responsibility": "Bind exact actrun, gosh and go-task identities, produce one verified Linux amd64 Carrier closure, and prove the Taskfile entry through direct and actrun adapters.",
  "forbiddenResponsibility": "Does not own task DAG meaning, add a scheduler, compile JSONL to YAML, or claim GitHub provider effects from local execution."
}
''
