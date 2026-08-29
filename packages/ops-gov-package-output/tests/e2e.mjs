#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPackageResponseFixture } from "../../ops-package-responses/lib/selftest.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const siblingBin = path.join(here, "..", "bin", "ops-gov-package-output.mjs");
const cmd = fs.existsSync(siblingBin) ? [process.execPath, siblingBin] : ["ops-gov-package-output"];
function run(args, expectFailure = false) {
  try {
    const output = execFileSync(cmd[0], [...cmd.slice(1), ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (expectFailure) throw new Error("expected command to fail");
    return JSON.parse(output);
  } catch (error) {
    if (!expectFailure) throw error;
    return JSON.parse(String(error.stdout));
  }
}
function readJsonl(file) {
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

const passFixture = createPackageResponseFixture({ includeBeta: true, suffix: "gov-output-pass" });
const blockedFixture = createPackageResponseFixture({ includeBeta: false, suffix: "gov-output-blocked" });
try {
  const passOut = path.join(passFixture.tmp, "gov-output");
  const emitted = run([
    "execute",
    "--release-dir", passFixture.releaseDir,
    "--out-dir", passOut,
    "--repo-root", passFixture.repo,
    "--governance-source", passFixture.governanceSource,
    "--nix-bin", passFixture.fakeBin,
    "--json",
  ]);
  assert.equal(emitted.ok, true);
  assert.equal(emitted.kind, "govPackageOutput.v1");
  assert.equal(emitted.projectionMode, "exact-release-execution");
  assert.equal(emitted.status, "pass");
  assert.equal(emitted.rowCounts.packages, 2);
  assert.equal(emitted.rowCounts.receipts, 2);

  const receipts = readJsonl(path.join(passOut, "receipts.jsonl"));
  assert.equal(receipts.length, 2);
  assert.ok(receipts.every((row) => row.status === "pass"));
  assert.ok(receipts.every((row) => row.evidence.length === 1));
  assert.ok(receipts.every((row) => row.evidence[0].outputs.length === 1));
  assert.ok(receipts.every((row) => row.governanceReleaseDigest === emitted.governanceReleaseDigest));
  assert.ok(receipts.every((row) => fs.existsSync(path.join(passOut, row.evidence[0].log_refs.stdout))));
  const admissions = readJsonl(path.join(passOut, "admission.jsonl"));
  assert.ok(admissions.every((row) => row.active === false));
  assert.ok(admissions.every((row) => row.status === "candidate-pass"));

  const passValidation = run(["validate", "--out-dir", passOut, "--strict", "--json"]);
  assert.equal(passValidation.ok, true, JSON.stringify(passValidation.errors));
  assert.equal(passValidation.status, "pass");
  fs.appendFileSync(path.join(passOut, receipts[0].evidence[0].log_refs.stdout), "tamper\n");
  const tamperedLog = run(["validate", "--out-dir", passOut, "--strict", "--json"], true);
  assert.equal(tamperedLog.ok, false);
  assert.ok(tamperedLog.errors.some((row) => row.code === "receipt-evidence-log-digest"));

  const blockedOut = path.join(blockedFixture.tmp, "gov-output");
  const blocked = run([
    "execute",
    "--release-dir", blockedFixture.releaseDir,
    "--out-dir", blockedOut,
    "--repo-root", blockedFixture.repo,
    "--governance-source", blockedFixture.governanceSource,
    "--nix-bin", blockedFixture.fakeBin,
    "--json",
  ]);
  assert.equal(blocked.status, "blocked");
  const structural = run(["validate", "--out-dir", blockedOut, "--json"]);
  assert.equal(structural.ok, true, JSON.stringify(structural.errors));
  assert.equal(structural.status, "blocked");
  const strict = run(["validate", "--out-dir", blockedOut, "--strict", "--json"], true);
  assert.equal(strict.ok, false);
  assert.ok(strict.errors.some((row) => row.code === "blocking-package-output"));

  const selftest = run(["selftest", "--json"]);
  assert.equal(selftest.ok, true);
  assert.equal(selftest.organization_active_minted, false);
  process.stdout.write("ops-gov-package-output: exact release receipts projected without minting final admission\n");
} finally {
  passFixture.cleanup();
  blockedFixture.cleanup();
}
