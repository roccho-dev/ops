#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const ACTIVE = "organization-active";
const STRICT_ENV = "OPS_REAL_CLAIM_ADMISSION_STRICT";
const STRICT_FLAG = "--strict";
const CHECKER_ENV = "OPS_CLAIM_ADMISSION_CHECKER";
const LEGACY_CHECKER_ENV = "OPS_GOVERNANCE_CLAIM_ADMISSION_CHECKER";

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

function digest(value) {
  return "sha256:" + crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function parseArgs(argv) {
  const options = {
    specPath: process.env.OPS_REAL_CLAIM_SPEC || "spec/implements.json",
    upstreamGrantsPath: process.env.OPS_REAL_CLAIM_UPSTREAM_GRANTS || "claims/upstream-grants.jsonl",
    admissionsOutPath: null,
    governanceChecker: process.env[CHECKER_ENV] || process.env[LEGACY_CHECKER_ENV] || null,
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
    } else if (arg === "--admissions-out") {
      options.admissionsOutPath = requireValue(argv, ++i, arg);
    } else if (arg === "--governance-checker") {
      options.governanceChecker = requireValue(argv, ++i, arg);
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

function diagnosticClass(result) {
  return {
    "organization-active": "organization-active",
    "orphan-assertion": "adrs-lagging-feat",
    "unclaimed-grant": "feat-lagging-adrs",
    "asserted-but-unproven": "claim-unproven",
    "stale-assertion": "claim-stale",
    "conflict": "claim-conflict",
    "revoked-grant": "claim-revoked",
  }[result] || "claim-conflict";
}

function index(rows, label) {
  const map = new Map();
  const duplicates = new Set();
  for (const row of rows) {
    if (!row.subjectId) throw new Error(`${label}: subjectId is required`);
    if (map.has(row.subjectId)) duplicates.add(row.subjectId);
    map.set(row.subjectId, row);
  }
  return { map, duplicates };
}

function makeDownstreamClaims(spec) {
  const sourceDigest = digest(spec.implements || []);
  return (spec.implements || []).map((item) => {
    const packageName = item.package;
    const claimShape = {
      package: packageName,
      contractId: item.contractId,
      outputs: item.outputs || [],
      checks: item.checks || [],
    };
    return {
      kind: "governance.claimPort.downstreamAssertion.v1",
      subjectId: `repo:ops:${packageName}`,
      contractId: item.contractId,
      assertionId: `ops-implements:${packageName}`,
      acceptedBundleDigest: spec.governanceRev ? `rev:${spec.governanceRev}` : "missing-governance-rev",
      sourceClosureDigest: sourceDigest,
      claimDigest: digest(claimShape),
      lifecycle: "active",
    };
  });
}

function makeReceipts(claims) {
  return claims.map((claim) => ({
    kind: "governance.claimPort.receipt.v1",
    subjectId: claim.subjectId,
    contractId: claim.contractId,
    receiptId: `ci:self:${claim.assertionId}`,
    acceptedBundleDigest: claim.acceptedBundleDigest,
    sourceClosureDigest: claim.sourceClosureDigest,
    claimDigest: claim.claimDigest,
    status: "success",
  }));
}

function admission(subjectId, result, grant, claim, receipt, note) {
  return {
    kind: "governance.organizationAdmission.v1",
    subjectId,
    contractId: (claim && claim.contractId) || (grant && grant.contractId) || null,
    admissionResult: result,
    diagnosticClass: diagnosticClass(result),
    grantId: grant ? grant.grantId || null : null,
    assertionId: claim ? claim.assertionId || null : null,
    receiptId: receipt ? receipt.receiptId || null : null,
    diagnostic: note || result,
  };
}

function compile(grants, claims, receipts) {
  const grantIndex = index(grants, "upstream grants");
  const claimIndex = index(claims, "downstream claims");
  const receiptIndex = index(receipts, "receipts");
  const subjects = [...new Set([
    ...grantIndex.map.keys(),
    ...claimIndex.map.keys(),
    ...receiptIndex.map.keys(),
    ...grantIndex.duplicates,
    ...claimIndex.duplicates,
  ])].sort();
  return subjects.map((subjectId) => {
    const grant = grantIndex.map.get(subjectId);
    const claim = claimIndex.map.get(subjectId);
    const receipt = receiptIndex.map.get(subjectId);
    if (grantIndex.duplicates.has(subjectId) || claimIndex.duplicates.has(subjectId)) {
      return admission(subjectId, "conflict", grant, claim, receipt, "duplicate-subject");
    }
    if (!grant) return admission(subjectId, "orphan-assertion", grant, claim, receipt, "missing-upstream-grant-port");
    if (!claim) return admission(subjectId, "unclaimed-grant", grant, claim, receipt, "missing-downstream-claim-port");
    if ((grant.lifecycle || "active") === "revoked") return admission(subjectId, "revoked-grant", grant, claim, receipt, "revoked-grant");
    if (grant.acceptedBundleDigest !== claim.acceptedBundleDigest) return admission(subjectId, "stale-assertion", grant, claim, receipt, "accepted-bundle-mismatch");
    if (grant.sourceClosureDigest !== claim.sourceClosureDigest) return admission(subjectId, "stale-assertion", grant, claim, receipt, "source-closure-mismatch");
    if (!receipt) return admission(subjectId, "asserted-but-unproven", grant, claim, receipt, "missing-receipt-port");
    if (receipt.claimDigest !== claim.claimDigest) return admission(subjectId, "stale-assertion", grant, claim, receipt, "receipt-claim-mismatch");
    return admission(subjectId, ACTIVE, grant, claim, receipt, ACTIVE);
  });
}

function isStrictMode(options) {
  return process.env[STRICT_ENV] === "1" || options.strict;
}

function summarize(admissions) {
  return admissions.reduce((acc, row) => {
    acc[row.diagnosticClass] = (acc[row.diagnosticClass] || 0) + 1;
    return acc;
  }, {});
}

function runGovernanceChecker(options, claims, receipts, strict) {
  if (!options.governanceChecker) return null;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ops-claim-admission-"));
  const downstreamPath = path.join(tmpDir, "downstream-assertions.jsonl");
  const receiptsPath = path.join(tmpDir, "receipts.jsonl");
  const emptyGrantsPath = path.join(tmpDir, "upstream-grants.empty.jsonl");
  const admissionsPath = path.join(tmpDir, "admissions.jsonl");
  writeJsonl(downstreamPath, claims);
  writeJsonl(receiptsPath, receipts);
  fs.writeFileSync(emptyGrantsPath, "");
  const upstreamPath = fs.existsSync(options.upstreamGrantsPath) ? options.upstreamGrantsPath : emptyGrantsPath;
  const args = [
    "--upstream-grants", upstreamPath,
    "--downstream-assertions", downstreamPath,
    "--receipts", receiptsPath,
    "--out", admissionsPath,
  ];
  if (strict) args.push(STRICT_FLAG);
  const child = spawnSync(options.governanceChecker, args, { encoding: "utf8" });
  if (child.stdout) process.stdout.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);
  if (child.error) throw child.error;
  if (child.status !== 0) process.exit(child.status ?? 1);
  if (!fs.existsSync(admissionsPath)) {
    throw new Error("governance checker did not write --out admissions jsonl");
  }
  const admissions = readJsonlIfExists(admissionsPath);
  return { admissions, checkerSource: "external-governance" };
}

function reportFor(admissions, strict, options, checkerSource) {
  const allActive = admissions.every((row) => row.admissionResult === ACTIVE);
  const summary = summarize(admissions);
  const report = {
    kind: "ops.realClaimAdmission.report.v1",
    status: allActive ? "pass" : strict ? "fail" : "warn",
    mode: strict ? "strict" : "staged-warning",
    strictEnv: STRICT_ENV,
    checkerSource,
    checkerEnv: CHECKER_ENV,
    input: {
      downstreamClaimSource: options.specPath,
      upstreamGrantSource: fs.existsSync(options.upstreamGrantsPath) ? options.upstreamGrantsPath : "missing",
      receiptSource: "ci:self-generated-from-current-claim",
    },
    summary,
    nextAction: allActive ? "none" : "add-ADRS-derived-upstream-grant-projection-or-narrow-selected-universe",
    admissions,
  };
  return report;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const strict = isStrictMode(options);
  const spec = readJson(options.specPath);
  const claims = makeDownstreamClaims(spec);
  const receipts = makeReceipts(claims);
  const external = runGovernanceChecker(options, claims, receipts, strict);
  const admissions = external ? external.admissions : compile(readJsonlIfExists(options.upstreamGrantsPath), claims, receipts);
  const report = reportFor(admissions, strict, options, external ? external.checkerSource : "ops-local-staged-adapter");
  if (options.admissionsOutPath) writeJsonl(options.admissionsOutPath, admissions);
  if (report.status === "warn") {
    console.error(`::warning title=ops-real-claim-admission::staged warning; diagnostics=${JSON.stringify(report.summary)}`);
  }
  console.error(JSON.stringify(report, null, 2));
  if (report.status === "fail") process.exit(1);
}

main();
