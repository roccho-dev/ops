builtins.fromJSON ''
{
  "kind": "ops.packageImplementationMetadata.v1",
  "mission": "CDP automation is operational implementation. repos/ops is the canonical runtime home.",
  "package": "ops-cdp-core",
  "primaryTarget": "packages/ops-cdp-core",
  "repoId": "ops",
  "requiredChecks": "checks.<system>.ops-cdp-core",
  "requiredOutputs": "packages.<system>.ops-cdp-core, packages.<system>.chromium-cdp-*, and packages.<system>.project-transport-* wrappers",
  "responsibility": "Own the ChatGPT CDP, Project Source, thread creation, thread send/readback, artifact fetch, Project handoff preflight, project transport-only wrappers, and host git workflow command surface migrated from flakes.",
  "forbiddenResponsibility": "Does not make flakes a second canonical CDP implementation. flakes is migration source, compatibility shim, or deprecation marker only.",
  "migrationSource": {
    "repo": "flakes",
    "branch": "task/0-9-cdp-access-check",
    "head": "e468c5ffbbdefe8d650fe18e91752184da52e8fd",
    "path": "parts/cdp"
  }
}
''
