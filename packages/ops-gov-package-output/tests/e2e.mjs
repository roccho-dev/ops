#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const siblingBin = path.join(here, "..", "bin", "ops-gov-package-output.mjs");
const cmd = fs.existsSync(siblingBin) ? [process.execPath, siblingBin] : ["ops-gov-package-output"];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ops-gov-package-output-e2e-"));
const packetFiles = ["manifest.json", "repo.json", "packages.jsonl", "assertions.jsonl", "receipts.jsonl", "readmeProjectionReceipt.jsonl", "provider-ci.jsonl", "findings.jsonl", "admission.jsonl"];

function run(argv) {
  return execFileSync(cmd[0], [...cmd.slice(1), ...argv], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
}
function readJsonl(file) {
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

try {
  const outDir = path.join(tmp, "packet");
  const emit = JSON.parse(run(["emit", "--out-dir", outDir, "--repo-root", repoRoot, "--json"]));
  assert.equal(emit.ok, true);
  assert.equal(emit.kind, "ops.govPackageOutput.emit.v1");
  assert.equal(emit.repoId, "roccho-dev/ops");
  for (const file of packetFiles) assert.ok(fs.statSync(path.join(outDir, file)).size > 0, `${file} should be non-empty`);

  const manifest = JSON.parse(fs.readFileSync(path.join(outDir, "manifest.json"), "utf8"));
  assert.equal(manifest.kind, "govPackageOutput.v1");
  assert.equal(manifest.repoId, "roccho-dev/ops");
  assert.equal(manifest.nonAuthority, true);
  assert.equal(manifest.projectionMode, "selected-warning");

  const packages = readJsonl(path.join(outDir, "packages.jsonl"));
  const assertions = readJsonl(path.join(outDir, "assertions.jsonl"));
  const receipts = readJsonl(path.join(outDir, "receipts.jsonl"));
  const findings = readJsonl(path.join(outDir, "findings.jsonl"));
  const admission = readJsonl(path.join(outDir, "admission.jsonl"));
  assert.equal(packages.length, 5);
  assert.equal(assertions.length, 5);
  assert.equal(receipts.length, 5);
  assert.ok(findings.length > 0);
  assert.equal(admission.length, 5);
  assert.ok(receipts.every((row) => row.decisionDigest?.startsWith("sha256:")));
  assert.ok(receipts.every((row) => row.assertionDigest?.startsWith("sha256:")));
  assert.ok(receipts.every((row) => row.evidenceDigest?.startsWith("sha256:")));
  assert.ok(admission.every((row) => row.active === false && row.status === "selected-warning"));

  const validation = JSON.parse(run(["validate", "--out-dir", outDir, "--json"]));
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
  const selftest = JSON.parse(run(["selftest", "--repo-root", repoRoot, "--json"]));
  assert.equal(selftest.ok, true, JSON.stringify(selftest.errors));
  assert.equal(selftest.negativeFixture, "pass");
  process.stdout.write("ops-gov-package-output: selected warning packet verified\n");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
