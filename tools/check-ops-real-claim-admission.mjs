#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";

const ACTIVE = "organization-active";
const STRICT_ENV = "OPS_REAL_CLAIM_ADMISSION_STRICT";
const STRICT_FLAG = "--strict";

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function readJsonlIfExists(path) {
  if (!fs.existsSync(path)) return [];
  return fs.readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function digest(value) {
  return "sha256:" + crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
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

function isStrictMode() {
  return process.env[STRICT_ENV] === "1" || process.argv.includes(STRICT_FLAG);
}

function summarize(admissions) {
  return admissions.reduce((acc, row) => {
    acc[row.diagnosticClass] = (acc[row.diagnosticClass] || 0) + 1;
    return acc;
  }, {});
}

function main() {
  const spec = readJson("spec/implements.json");
  const claims = makeDownstreamClaims(spec);
  const receipts = makeReceipts(claims);
  const grants = readJsonlIfExists("claims/upstream-grants.jsonl");
  const admissions = compile(grants, claims, receipts);
  const allActive = admissions.every((row) => row.admissionResult === ACTIVE);
  const strict = isStrictMode();
  const summary = summarize(admissions);
  const report = {
    kind: "ops.realClaimAdmission.report.v1",
    status: allActive ? "pass" : strict ? "fail" : "warn",
    mode: strict ? "strict" : "staged-warning",
    strictEnv: STRICT_ENV,
    input: {
      downstreamClaimSource: "spec/implements.json",
      upstreamGrantSource: fs.existsSync("claims/upstream-grants.jsonl") ? "claims/upstream-grants.jsonl" : "missing",
      receiptSource: "ci:self-generated-from-current-claim",
    },
    summary,
    nextAction: allActive ? "none" : "add-ADRS-derived-upstream-grant-projection-or-narrow-selected-universe",
    admissions,
  };
  if (!allActive && !strict) {
    console.error(`::warning title=ops-real-claim-admission::staged warning; diagnostics=${JSON.stringify(summary)}`);
  }
  console.error(JSON.stringify(report, null, 2));
  if (report.status === "fail") process.exit(1);
}

main();
