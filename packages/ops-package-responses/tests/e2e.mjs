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
const siblingBin = path.join(here, "..", "bin", "ops-package-responses.mjs");
const cmd = fs.existsSync(siblingBin) ? [process.execPath, siblingBin] : ["ops-package-responses"];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ops-package-responses-e2e-"));

const canonicalFiles = [
  "package-inventory.jsonl",
  "package-responses.jsonl",
  "package-residuals.jsonl",
  "package-drifts.jsonl",
];
const allPacketFiles = [
  "ops-package-responses.jsonl",
  "ops-package-evidence.jsonl",
  "ops-package-receipts.jsonl",
  "ops-package-residuals.jsonl",
  ...canonicalFiles,
  "manifest.json",
];
const requiredInventoryKinds = [
  "build-packages-jsonl",
  "build-checks-jsonl",
  "flake-generated",
  "flake-explicit",
  "source-dir",
  "evidence-output",
];

function run(argv) {
  return execFileSync(cmd[0], [...cmd.slice(1), ...argv], { encoding: "utf-8", maxBuffer: 16 * 1024 * 1024 });
}
function readJsonl(file) {
  return fs.readFileSync(file, "utf-8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

try {
  const outDir = path.join(tmp, "packet");
  const emit = JSON.parse(run(["emit", "--out-dir", outDir, "--repo-root", repoRoot, "--json"]));
  assert.equal(emit.kind, "ops.packageResponsePacket.v1");
  assert.equal(emit.authority, false);
  assert.equal(emit.non_authority_diagnostic, true);
  assert.equal(emit.row_counts.responses, 5);
  assert.equal(emit.row_counts.canonical_responses, 5);
  assert.equal(emit.row_counts.canonical_residuals, 1);
  assert.ok(emit.row_counts.inventory >= emit.row_counts.responses);
  assert.ok(emit.row_counts.drifts > 0);

  for (const file of allPacketFiles) assert.ok(fs.statSync(path.join(outDir, file)).size > 0, `${file} should be non-empty`);
  for (const file of canonicalFiles) assert.ok(emit.files.includes(file), `manifest must list ${file}`);

  const inventory = readJsonl(path.join(outDir, "package-inventory.jsonl"));
  const sourceKinds = new Set(inventory.map((row) => row.source_kind));
  for (const kind of requiredInventoryKinds) assert.ok(sourceKinds.has(kind), `inventory must include ${kind}`);
  assert.ok(inventory.some((row) => row.package_id === "ops-package-responses" && row.source_kind === "source-dir"));
  assert.ok(inventory.filter((row) => row.source_kind === "evidence-output").every((row) => row.item_kind === "evidence-output"));

  const canonicalResponses = readJsonl(path.join(outDir, "package-responses.jsonl"));
  assert.ok(canonicalResponses.every((row) => row.kind === "packageResponse.v1"));
  assert.ok(canonicalResponses.every((row) => row.authority === false));
  assert.ok(canonicalResponses.every((row) => row.adrsRef && row.obligationId && row.packageId && row.packagePath));
  assert.ok(canonicalResponses.every((row) => Array.isArray(row.tests) && Array.isArray(row.residuals)));
  assert.ok(canonicalResponses.some((row) => row.package_id === "ops-package-responses" && row.residuals.length === 1));

  const canonicalResiduals = readJsonl(path.join(outDir, "package-residuals.jsonl"));
  assert.equal(canonicalResiduals.length, 1);
  assert.equal(canonicalResiduals[0].kind, "packageResidual.v1");
  assert.equal(canonicalResiduals[0].authority, false);
  assert.equal(canonicalResiduals[0].status, "returned");

  const drifts = readJsonl(path.join(outDir, "package-drifts.jsonl"));
  assert.ok(drifts.some((row) => row.package_id === "ops-issue-ledger"));
  assert.ok(!drifts.some((row) => row.package_id === "ops-package-responses"));
  assert.ok(drifts.every((row) => row.kind === "packageDrift.v1"));
  assert.ok(drifts.every((row) => row.authority === false));
  assert.ok(drifts.every((row) => row.drift_type === "unregistered-package"));
  assert.ok(drifts.every((row) => !row.source_kinds.includes("evidence-output")));

  const validation = JSON.parse(run(["validate", "--out-dir", outDir, "--json"]));
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
  assert.equal(validation.counts.responses, 5);
  assert.equal(validation.counts.canonical_responses, 5);
  assert.equal(validation.counts.inventory, emit.row_counts.inventory);
  assert.equal(validation.counts.drifts, emit.row_counts.drifts);

  const selftest = JSON.parse(run(["selftest", "--repo-root", repoRoot, "--json"]));
  assert.equal(selftest.ok, true, JSON.stringify(selftest.errors));
  assert.equal(selftest.negative_fixture, "pass");

  const brokenDir = path.join(tmp, "broken");
  fs.cpSync(outDir, brokenDir, { recursive: true });
  fs.rmSync(path.join(brokenDir, "ops-package-receipts.jsonl"));
  let failed = false;
  try { run(["validate", "--out-dir", brokenDir, "--json"]); }
  catch (error) {
    failed = true;
    const result = JSON.parse(String(error.stdout));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.code === "missing-file"));
  }
  assert.equal(failed, true, "missing receipt file must fail validation");
  process.stdout.write("ops-package-responses: canonical closure outputs verified\n");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
