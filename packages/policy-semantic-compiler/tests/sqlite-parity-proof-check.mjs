#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const out = process.env.out;
if (!out) throw new Error("Nix output path is missing");

const evidence = path.join(out, "evidence");
const work = path.join(process.env.TMPDIR || os.tmpdir(), "sqlite-parity-work");
fs.mkdirSync(evidence, { recursive: true });

const env = {
  ...process.env,
  PYTHONPATH: path.join(root, "packages/policy-semantic-compiler/src"),
};

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    encoding: "utf8",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`${command} exited ${result.status}`);
  }
}

run("python3", [
  "-m",
  "policy_semantic_compiler.sqlite_parity_proof_v2",
  "--base-fixture",
  "packages/policy-semantic-compiler/tests/adrs-projection-duckdb/accepted",
  "--candidate-fixture",
  "packages/policy-semantic-compiler/tests/adrs-projection-duckdb/candidate-disposition",
  "--repo-root",
  ".",
  "--usage-review",
  "evidence/duckdb-usage-review.jsonl",
  "--work-dir",
  work,
  "--evidence-dir",
  evidence,
  "--compiler",
  "policy-semantic-compiler",
]);

run("python3", [
  "-m",
  "policy_semantic_compiler.sqlite_parity_classify_v2",
  "--evidence-dir",
  evidence,
]);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const expectedPath = path.join(root, "evidence/ops-90-sqlite-parity.expected.json");
const expected = JSON.parse(fs.readFileSync(expectedPath, "utf8"));
const expectedHash = fs
  .readFileSync(path.join(root, "evidence/ops-90-sqlite-parity.expected.sha256"), "utf8")
  .trim()
  .split(/\s+/)[0];
const actualExpectedHash = crypto
  .createHash("sha256")
  .update(`${canonical(expected)}\n`)
  .digest("hex");
if (actualExpectedHash !== expectedHash) {
  throw new Error(`expected contract hash mismatch: ${actualExpectedHash}`);
}

const summary = JSON.parse(
  fs.readFileSync(path.join(evidence, "sqlite-parity.summary.json"), "utf8"),
);
const checks = [
  [summary.suiteVersion === expected.suiteVersion, "suiteVersion"],
  [summary.totalCases === expected.totalCases, "totalCases"],
  [canonical(summary.providerCaseIds) === canonical(expected.providerCaseIds), "providerCaseIds"],
  [canonical(summary.providerFixtureFailureCaseIds) === "[]", "providerFixtureFailureCaseIds"],
  [canonical(summary.mismatchCaseIds) === canonical(expected.expectedMismatchCaseIds), "mismatchCaseIds"],
  [summary.candidateStatus === expected.candidateStatus, "candidateStatus"],
  [summary.migrationClaimAllowed === expected.migrationClaimAllowed, "migrationClaimAllowed"],
  [summary.failClosedRegressionCount === expected.failClosedRegressionCount, "failClosedRegressionCount"],
  [summary.unknownUsageReferenceCount === expected.unknownUsageReferenceCount, "unknownUsageReferenceCount"],
  [summary.unclassifiedMismatchCount === expected.unclassifiedMismatchCount, "unclassifiedMismatchCount"],
  [summary.generatedIsAuthority === expected.generatedIsAuthority, "generatedIsAuthority"],
  [summary.databaseIsAuthority === expected.databaseIsAuthority, "databaseIsAuthority"],
];
for (const [ok, field] of checks) {
  if (!ok) throw new Error(`parity expectation failed: ${field}`);
}

const generatedDifferences = fs.readFileSync(
  path.join(evidence, "sqlite-parity.differences.jsonl"),
  "utf8",
);
const retainedDifferences = fs.readFileSync(
  path.join(
    root,
    "evidence/ops-90-sqlite-parity-v2/sqlite-parity.differences.jsonl",
  ),
  "utf8",
);
if (generatedDifferences !== retainedDifferences) {
  throw new Error("generated differences do not match retained exact evidence");
}

const resultsPath = path.join(evidence, "sqlite-parity.results.jsonl");
const results = fs
  .readFileSync(resultsPath, "utf8")
  .split(/\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));
if (results.length !== 54) throw new Error(`expected 54 result rows, got ${results.length}`);
for (const caseId of expected.providerCaseIds) {
  if (results.filter((row) => row.caseId === caseId).length !== 2) {
    throw new Error(`provider case lacks both engines: ${caseId}`);
  }
}

fs.copyFileSync(expectedPath, path.join(evidence, path.basename(expectedPath)));
fs.copyFileSync(
  path.join(root, "evidence/ops-90-sqlite-parity.expected.sha256"),
  path.join(evidence, "ops-90-sqlite-parity.expected.sha256"),
);
fs.writeFileSync(path.join(out, "ok"), "sqlite parity proof passed\n");
