#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const STRICT_ENV = "OPS_REAL_CLAIM_ADMISSION_STRICT";
const STRICT_FLAG = "--strict";
const SELECTED_UNIVERSE_ENV = "OPS_REAL_CLAIM_SELECTED_UNIVERSE";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonlIfExists(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function writeJsonl(filePath, rows) {
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}

function parseArgs(argv) {
  const options = {
    specPath: process.env.OPS_REAL_CLAIM_SPEC || "spec/implements.json",
    upstreamGrantsPath: process.env.OPS_REAL_CLAIM_UPSTREAM_GRANTS || "claims/upstream-grants.jsonl",
    selectedUniversePath: process.env[SELECTED_UNIVERSE_ENV] || "claims/selected-universe.jsonl",
    strict: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === STRICT_FLAG) {
      options.strict = true;
    } else if (arg === "--spec") {
      options.specPath = requireValue(argv, ++i, arg);
    } else if (arg === "--upstream-grants") {
      options.upstreamGrantsPath = requireValue(argv, ++i, arg);
    } else if (arg === "--selected-universe") {
      options.selectedUniversePath = requireValue(argv, ++i, arg);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function isStrict(options) {
  return process.env[STRICT_ENV] === "1" || options.strict;
}

function readSelectedUniverse(filePath) {
  if (!fs.existsSync(filePath)) {
    return { subjectIds: [], diagnostics: [{ diagnostic: "missing-selected-universe", path: filePath }] };
  }
  const rows = readJsonlIfExists(filePath);
  const subjects = new Set();
  const diagnostics = [];
  rows.forEach((row, indexNumber) => {
    const rowNumber = indexNumber + 1;
    if (typeof row.subjectId === "string" && row.subjectId.trim()) {
      subjects.add(row.subjectId);
    } else if (typeof row.selectedSubjectId === "string" && row.selectedSubjectId.trim()) {
      subjects.add(row.selectedSubjectId);
    } else if (Array.isArray(row.subjectIds) && row.subjectIds.every((value) => typeof value === "string" && value.trim())) {
      row.subjectIds.forEach((subjectId) => subjects.add(subjectId));
    } else {
      diagnostics.push({ diagnostic: "selected-universe-row-without-subject", row: rowNumber });
    }
  });
  if (subjects.size === 0) diagnostics.push({ diagnostic: "empty-selected-universe", path: filePath });
  return { subjectIds: [...subjects].sort(), diagnostics };
}

function failReport(diagnostics, options) {
  console.error(JSON.stringify({
    kind: "ops.realClaimAdmission.strictClosure.report.v1",
    status: "fail",
    mode: "strict",
    input: {
      downstreamClaimSource: options.specPath,
      upstreamGrantSource: fs.existsSync(options.upstreamGrantsPath) ? options.upstreamGrantsPath : "missing",
      selectedUniverseSource: fs.existsSync(options.selectedUniversePath) ? options.selectedUniversePath : "missing",
    },
    diagnostics,
    nextAction: "add-ADRS-selected-universe-and-upstream-grant-projection",
  }, null, 2));
  process.exit(1);
}

function selectedPackageSubjects(spec) {
  return new Set((spec.implements || []).map((item) => `repo:ops:${item.package}`));
}

function strictInvocation(options) {
  const selected = readSelectedUniverse(options.selectedUniversePath);
  if (selected.diagnostics.length > 0) failReport(selected.diagnostics, options);

  const selectedSet = new Set(selected.subjectIds);
  const spec = readJson(options.specPath);
  const specSubjects = selectedPackageSubjects(spec);
  const missingFromSpec = selected.subjectIds.filter((subjectId) => !specSubjects.has(subjectId));
  if (missingFromSpec.length > 0) {
    failReport(missingFromSpec.map((subjectId) => ({ diagnostic: "selected-subject-missing-from-ops-claims", subjectId })), options);
  }

  const filteredSpec = {
    ...spec,
    implements: (spec.implements || []).filter((item) => selectedSet.has(`repo:ops:${item.package}`)),
  };
  const filteredGrants = readJsonlIfExists(options.upstreamGrantsPath).filter((row) => selectedSet.has(row.subjectId));
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ops-strict-claim-closure-"));
  fs.mkdirSync(path.join(tmpDir, "spec"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "claims"), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "spec/implements.json"), JSON.stringify(filteredSpec, null, 2));
  writeJsonl(path.join(tmpDir, "claims/upstream-grants.jsonl"), filteredGrants);
  return { args: ["--strict"], cwd: tmpDir };
}

function main() {
  const repoRoot = process.cwd();
  const options = parseArgs(process.argv.slice(2));
  const toolPath = path.join(repoRoot, "tools/check-ops-real-claim-admission.mjs");
  const invocation = isStrict(options)
    ? strictInvocation(options)
    : { args: [], cwd: repoRoot };
  const child = spawnSync(process.execPath, [toolPath, ...invocation.args], { encoding: "utf8", cwd: invocation.cwd });
  if (child.stdout) process.stdout.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);
  if (child.error) throw child.error;
  process.exit(child.status ?? 1);
}

main();
