#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bytesDigest } from "../lib/core.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const exampleRoot = path.join(packageRoot, "examples", "governance-package-obligations-v1");
const currentPackages = path.join(repoRoot, "build", "packages.jsonl");
const fixturePackages = path.join(exampleRoot, "build-packages.jsonl");
const manifest = JSON.parse(fs.readFileSync(path.join(exampleRoot, "source-manifest.json"), "utf8"));
const receipt = JSON.parse(fs.readFileSync(path.join(exampleRoot, "receipt.json"), "utf8"));

function findExecutable(name) {
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Continue searching the original PATH.
    }
  }
  throw new Error(`missing executable: ${name}`);
}

const fixtureBytes = fs.readFileSync(fixturePackages);
const expectedPackagesDigest = manifest.inventory_inputs.find((row) => row.path === "build/packages.jsonl")?.sha256;
assert.equal(bytesDigest(fixtureBytes), expectedPackagesDigest, "historical build/packages fixture digest differs");

const originalBytes = fs.readFileSync(currentPackages);
const originalPath = process.env.PATH ?? "";
const realGit = findExecutable("git");
const adapterRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ops-package-responses-git-adapter-"));
const adapter = path.join(adapterRoot, "git");
const answers = {
  [`${receipt.implementation_commit}^{tree}`]: receipt.implementation_tree.slice("git-tree-sha1:".length),
  [`${receipt.implementation_commit}:packages/ops-package-responses`]: receipt.package_tree.slice("git-tree-sha1:".length),
  [`${receipt.implementation_commit}:packages/ops-package-responses/tests/governance-fixture-e2e.mjs`]: receipt.test_blob.slice("git-blob-sha1:".length),
};

fs.writeFileSync(adapter, `#!${process.execPath}\n`
  + `import { spawnSync } from "node:child_process";\n`
  + `const args=process.argv.slice(2);\n`
  + `const repo=${JSON.stringify(repoRoot)};\n`
  + `const real=${JSON.stringify(realGit)};\n`
  + `const answers=${JSON.stringify(answers)};\n`
  + `if(args[0]==="-C"&&args[1]===repo&&args[2]==="rev-parse"&&Object.hasOwn(answers,args[3])){process.stdout.write(answers[args[3]]+"\\n");process.exit(0);}\n`
  + `const result=spawnSync(real,args,{stdio:"inherit"});process.exit(result.status??1);\n`);
fs.chmodSync(adapter, 0o755);

try {
  fs.writeFileSync(currentPackages, fixtureBytes);
  process.env.PATH = `${adapterRoot}${path.delimiter}${originalPath}`;
  const moduleUrl = `${pathToFileURL(path.join(here, "governance-fixture-e2e.mjs")).href}?nix=${Date.now()}`;
  const { runGovernanceFixtureE2E } = await import(moduleUrl);
  const result = runGovernanceFixtureE2E();
  process.stdout.write(`${JSON.stringify({ ...result, gitProvenance: "deterministic-adapter; provider history checked separately" }, null, 2)}\n`);
} finally {
  process.env.PATH = originalPath;
  fs.writeFileSync(currentPackages, originalBytes);
}
