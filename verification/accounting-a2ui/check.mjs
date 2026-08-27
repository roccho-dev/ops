#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readArtifactLock } from "../../packages/artifact-assembly/src/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const rows = readArtifactLock(path.join(root, "locks/accounting-a2ui.jsonl"));
assert.deepEqual(rows.map(row => row.id), ["a2ui-web-core", "accounting-a2ui-app"]);
const upstream = rows.find(row => row.id === "a2ui-web-core");
assert.equal(upstream.status, "pending-digest");
assert.equal(upstream.required, true);
assert.equal(upstream.name, "@a2ui/web_core");
const app = rows.find(row => row.id === "accounting-a2ui-app");
const semanticRows = readArtifactLock(path.join(root, "locks/semantic-map-a2ui.jsonl"));
const semanticApp = semanticRows.find(row => row.id === "semantic-map-a2ui-app");
assert.equal(app.status, "locked");
assert.equal(app.revision, semanticApp.revision, "UI-owned artifacts must be locked to the same UI revision");
assert.match(app.revision, /^[a-f0-9]{40}$/u);
assert.match(app.sha256, /^[a-f0-9]{64}$/u);
assert.equal(app.target, ".");
assert.equal(app.owner, "ui");
assert.equal(fs.existsSync(path.join(root, "packages/accounting")), false);
assert.equal(fs.existsSync(path.join(root, "packages/projections/accounting-a2ui")), false);
const verificationReadme = fs.readFileSync(path.join(here, "README.md"), "utf8");
for (const token of ["all-t-accounts", "bs-pl", "Button", "Range", "FinancialStatements", "TAccount", "TAccountGrid", "view.setTime"]) {
  assert.equal(verificationReadme.includes(token), true, `accounting verification README omitted implemented contract: ${token}`);
}
assert.equal(verificationReadme.includes("TimeNavigator"), false, "verification README must not claim the intentionally absent TimeNavigator type");

const assemblySource = fs.readdirSync(path.join(root, "packages/artifact-assembly/src"))
  .map(name => fs.readFileSync(path.join(root, "packages/artifact-assembly/src", name), "utf8"))
  .join("\n");
for (const token of [
  "TAccount",
  "TAccountGrid",
  "FinancialStatements",
  "urn:roccho:a2ui:catalog:accounting:1",
  "journal.jsonl",
  "projectAccountingToA2ui",
]) {
  assert.equal(assemblySource.includes(token), false, `generic assembly leaked accounting token: ${token}`);
}
console.log(JSON.stringify({
  appRevision: app.revision,
  appSha256: app.sha256,
  lockedInputs: rows.filter(row => row.status === "locked").length,
  pendingInputs: rows.filter(row => row.status !== "locked").length,
  status: "accounting-a2ui-lock-check-pass",
}));
