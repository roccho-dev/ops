builtins.fromJSON ''
{
  "kind": "ops.packageImplementationMetadata.v1",
  "package": "ops-knowledge-intake",
  "repoId": "ops",
  "mission": "Turn non-structured operation evidence inventories into reusable knowledge candidates without making raw evidence normative.",
  "primaryTarget": "packages/ops-knowledge-intake",
  "requiredOutputs": "packages.<system>.ops-knowledge-intake",
  "requiredChecks": "ops-knowledge-intake.sample-extract",
  "responsibility": "Read zip inventory TSV, classify reusable knowledge candidates, and emit a small TSV with detection/recovery fields.",
  "forbiddenResponsibility": "Does not rewrite AGENTS.md, does not promote one-off evidence automatically, and does not treat raw reports as rules."
}
''
