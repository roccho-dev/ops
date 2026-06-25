builtins.fromJSON ''
{
  "kind": "ops.packageImplementationMetadata.v1",
  "package": "codex-app-browser-chatgpt-ops",
  "repoId": "ops",
  "mission": "Make ChatGPT proposal-session operation reproducible through the Codex in-app browser surface.",
  "primaryTarget": "packages/codex-app-browser-chatgpt-ops",
  "requiredOutputs": "packages.<system>.codex-app-browser-chatgpt-ops",
  "requiredChecks": "checks.<system>.codex-app-browser-chatgpt-ops",
  "responsibility": "Generate proposal prompts, branch slugs, PR body context, and Codex app browser helpers for ChatGPT project sessions.",
  "forbiddenResponsibility": "Does not replace ops-cdp-core, does not own Chromium CDP transport, does not approve merges, and does not run live ChatGPT browser mutations in CI."
}
''
