#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readArtifactLock, sha256File, sha256Tree } from "../../packages/artifact-assembly/src/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const [uiRevision, semanticDir, accountingDir, presentationFile] = process.argv.slice(2);
assert.match(uiRevision ?? "", /^[a-f0-9]{40}$/u, "final UI revision is required");
for (const value of [semanticDir, accountingDir, presentationFile]) assert.ok(value, "three final UI artifact paths are required");
const find = (lockName, id) => readArtifactLock(path.join(repo, "locks", lockName)).find(row => row.id === id);
const semantic = find("semantic-map-a2ui.jsonl", "semantic-map-a2ui-app");
const accounting = find("accounting-a2ui.jsonl", "accounting-a2ui-app");
const presentation = find("presentation-a2ui-one-html.jsonl", "presentation-a2ui-one-html");
for (const row of [semantic, accounting, presentation]) {
  assert.equal(row.owner, "ui");
  assert.equal(row.status, "locked");
  assert.equal(row.revision, uiRevision);
}
assert.equal(sha256Tree(semanticDir).sha256, semantic.sha256, "semantic artifact digest differs");
assert.equal(sha256Tree(accountingDir).sha256, accounting.sha256, "accounting artifact digest differs");
assert.equal(sha256File(presentationFile), presentation.sha256, "presentation artifact digest differs");
console.log(JSON.stringify({
  revision: uiRevision,
  artifacts: {
    semantic: semantic.sha256,
    accounting: accounting.sha256,
    presentation: presentation.sha256,
  },
  status: "final-ui-artifact-locks-pass",
}));
