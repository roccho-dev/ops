#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ui = resolve(process.argv[2] ?? "");
assert.ok(process.argv[2], "UI repository path is required");
const ops = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const formerPackage = "packages/jsonl-diagram-core";
const formerWorkflow = ".github/workflows/jsonl-diagram-core.yml";
const sourceCommit = "04569f23b42946776abbb208a1cd9bea954169be";
const sourceTree = "679a36c944d9081f069c1f8bd69575e93529c911";
const provenanceMerge = "3de1c6d6ecea5e53b856935052e923398d7c84a5";

const git = (cwd, args, options = {}) => execFileSync("git", args, { cwd, encoding: "utf8", ...options }).trim();
const tracked = git(ui, ["ls-files", "-z"]).split("\0").filter(Boolean);
const trackedSet = new Set(tracked);

assert.equal(existsSync(resolve(ui, formerPackage)), false);
assert.equal(existsSync(resolve(ui, formerWorkflow)), false);
assert.equal(tracked.some(path => path === formerPackage || path.startsWith(`${formerPackage}/`)), false);
assert.equal(trackedSet.has(formerWorkflow), false);
assert.equal(tracked.some(path => path.toLowerCase().endsWith(".drawio")), false);

const ciIntent = readFileSync(resolve(ui, "ci.intent.v1.jsonl"), "utf8");
assert.equal(ciIntent.includes("jsonl-diagram-core"), false);
const packageFiles = tracked.filter(path => /(^|\/)(package(?:-lock)?\.json|flake\.nix)$/u.test(path));
for (const path of packageFiles) {
  assert.equal(readFileSync(resolve(ui, path), "utf8").includes("jsonl-diagram-core"), false, `${path} still depends on retired package`);
}

execFileSync("git", ["merge-base", "--is-ancestor", sourceCommit, "HEAD"], { cwd: ui });
assert.equal(git(ui, ["cat-file", "-t", sourceTree]), "tree");
const mergeParents = git(ui, ["show", "-s", "--format=%P", provenanceMerge]).split(" ");
assert.equal(mergeParents.length, 2);
assert.equal(mergeParents[1], sourceCommit);

const receipt = JSON.parse(readFileSync(resolve(ui, "evidence/retirements/legacy-diagram-package/receipt.json"), "utf8"));
assert.equal(receipt.schema, "roccho.repository-retirement-receipt/1");
assert.equal(receipt.status, "PASS_LOCAL_RETIREMENT_HISTORY_RETAINED");
assert.equal(receipt.authority, false);
assert.equal(receipt.sourceCommit, sourceCommit);
assert.equal(receipt.sourceTree, sourceTree);
assert.equal(receipt.historyReachable, true);
assert.deepEqual(receipt.currentTree, {
  packagePresent: false,
  workflowPresent: false,
  ciIntentPresent: false,
  drawioArtifactsPresent: false,
});
assert.equal(receipt.replacement.owner, "mobile-agent");
assert.equal(receipt.replacement.acceptedStateOnlyByDefault, true);
assert.equal(receipt.replacement.proposalStateSeparate, true);
assert.deepEqual(receipt.replacement.sourceOutputs, ["stateJSONL", "decisionLogJSONL", "envelopeJSON"]);

const opsPackages = git(ops, ["ls-files", "packages"]);
assert.equal(opsPackages.split("\n").filter(Boolean).some(path => path.includes("jsonl-diagram-core")), false);

console.log(JSON.stringify({
  schema: "roccho.legacy-diagram-retirement-proof/2",
  status: "PASS",
  currentTree: {
    legacyPackage: "ABSENT",
    legacyWorkflow: "ABSENT",
    drawioArtifacts: 0,
    legacyCiIntent: "ABSENT",
    legacyWorkspaceDependency: "ABSENT",
    legacyNixEntry: "ABSENT"
  },
  history: { sourceCommit, sourceTree, provenanceMerge, status: "REACHABLE" },
  evidence: { authority: receipt.authority },
  ops: { transferredImplementation: 0 }
}));
