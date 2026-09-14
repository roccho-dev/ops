#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { bytesDigest } from "../lib/core.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const exampleRoot = path.join(packageRoot, "examples", "governance-package-obligations-v1");

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const gitText = (...args) => execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" }).trim();
const gitBytes = (...args) => execFileSync("git", ["-C", repoRoot, ...args]);
const sortedLines = (text) => text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).sort();

const manifest = readJson(path.join(exampleRoot, "source-manifest.json"));
const projection = readJson(path.join(exampleRoot, "inventory-projection.json"));
const receipt = readJson(path.join(exampleRoot, "receipt.json"));

assert.equal(gitText("rev-parse", "--is-inside-work-tree"), "true");
assert.equal(
  gitText("rev-parse", `${receipt.implementation_commit}^{tree}`),
  receipt.implementation_tree.slice("git-tree-sha1:".length),
);
assert.equal(
  gitText("rev-parse", `${receipt.implementation_commit}:packages/ops-package-responses`),
  receipt.package_tree.slice("git-tree-sha1:".length),
);
assert.equal(
  gitText("rev-parse", `${receipt.implementation_commit}:packages/ops-package-responses/tests/governance-fixture-e2e.mjs`),
  receipt.test_blob.slice("git-blob-sha1:".length),
);

for (const input of manifest.inventory_inputs) {
  if (input.path === "packages/<directory-name-set>") {
    const names = sortedLines(gitText("ls-tree", "-d", "--name-only", `${manifest.target_commit}:packages`));
    assert.deepEqual(names, projection.source_directory_ids);
    assert.equal(bytesDigest(Buffer.from(names.join("\n") + "\n")), input.sha256);
    continue;
  }
  assert.equal(bytesDigest(gitBytes("show", `${manifest.target_commit}:${input.path}`)), input.sha256);
}

process.stdout.write(`${JSON.stringify({
  authority: false,
  implementationCommit: receipt.implementation_commit,
  kind: "ops.packageObligationGoldenGitProvenance.v1",
  status: "PASS",
  targetCommit: manifest.target_commit,
})}\n`);
