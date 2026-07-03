#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoId = "roccho-dev/ops";
const repoClass = "effectful_executor";
const generatedAt = "2026-07-03T00:00:00Z";
const packetFiles = [
  "manifest.json",
  "repo.json",
  "packages.jsonl",
  "assertions.jsonl",
  "receipts.jsonl",
  "readmeProjectionReceipt.jsonl",
  "provider-ci.jsonl",
  "findings.jsonl",
  "admission.jsonl",
];
function usage() {
  return "usage: ops-gov-package-output emit --out-dir <dir> [--repo-root <dir>] [--json]\n       ops-gov-package-output validate --out-dir <dir> [--json]\n       ops-gov-package-output selftest [--repo-root <dir>] [--json]";
}
function parseArgv(input) {
  let args = [...input], command = "emit", outDir, repoRoot, json = false;
  if (args[0] && !args[0].startsWith("-")) command = args.shift();
  while (args.length) {
    let arg = args.shift();
    if (arg === "--json") json = true;
    else if (arg === "--out-dir") outDir = args.shift();
    else if (arg === "--repo-root") repoRoot = args.shift();
    else throw Error(`unknown argument: ${arg}`);
  }
  return { command, outDir, repoRoot, json };
}
function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex")}`;
}
function readJsonl(file) {
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch (error) { throw Error(`${file}:${index + 1}: ${error.message}`); }
  });
}
function writeJsonl(file, rows) {
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}
function up(start) {
  let out = [], current = path.resolve(start);
  for (;;) {
    out.push(current);
    let parent = path.dirname(current);
    if (parent === current) return out;
    current = parent;
  }
}
function hasBuild(root) {
  return fs.existsSync(path.join(root, "build/packages.jsonl")) && fs.existsSync(path.join(root, "build/checks.jsonl"));
}
function repoRootOf(given) {
  let here = path.dirname(fileURLToPath(import.meta.url));
  return [given, process.cwd(), ...up(here)].filter(Boolean).map((p) => path.resolve(p)).find(hasBuild) ?? path.resolve(given ?? process.cwd());
}
function packageResponsesCommand(repoRoot) {
  let sibling = path.join(repoRoot, "packages/ops-package-responses/bin/ops-package-responses.mjs");
  return fs.existsSync(sibling) ? [process.execPath, sibling] : ["ops-package-responses"];
}
function runPackageResponses(repoRoot, outDir) {
  let cmd = packageResponsesCommand(repoRoot);
  execFileSync(cmd[0], [...cmd.slice(1), "emit", "--out-dir", outDir, "--repo-root", repoRoot, "--json"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
}
function emit(outDir, repoRootInput) {
  if (!outDir) throw Error("--out-dir is required");
  let repoRoot = repoRootOf(repoRootInput);
  let tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ops-gov-package-output-src-"));
  try {
    let sourceDir = path.join(tmp, "ops-package-responses");
    runPackageResponses(repoRoot, sourceDir);
    fs.mkdirSync(outDir, { recursive: true });
    let responses = readJsonl(path.join(sourceDir, "package-responses.jsonl"));
    let receipts = readJsonl(path.join(sourceDir, "ops-package-receipts.jsonl"));
    let residuals = readJsonl(path.join(sourceDir, "package-residuals.jsonl"));
    let drifts = readJsonl(path.join(sourceDir, "package-drifts.jsonl"));
    let packageRows = responses.map((row) => ({
      kind: "govPackageRow.v1",
      repoId,
      packageId: row.packageId ?? row.package_id,
      packagePath: row.packagePath ?? row.package_path,
      packageClass: "ops_effectful_evidence_surface",
      purposeRef: row.adrsRef ?? row.adrs_ref,
      contractRefs: [row.obligationId ?? row.obligation_id],
      assertionRefs: [row.claimId ?? row.claim_id],
      receiptRefs: [row.receipt ?? row.receipt_ref],
      status: "selected-warning",
      nonAuthority: true
    }));
    let assertionRows = responses.map((row) => ({
      kind: "govPackageAssertion.v1",
      repoId,
      packageId: row.packageId ?? row.package_id,
      assertion: "ops package emits non-authority evidence for its selected ADRS obligation",
      adrsRef: row.adrsRef ?? row.adrs_ref,
      obligationId: row.obligationId ?? row.obligation_id,
      claimId: row.claimId ?? row.claim_id,
      decisionDigest: row.decisionDigest ?? row.decision_digest ?? digest({ adrsRef: row.adrsRef, obligationId: row.obligationId }),
      assertionDigest: row.assertionDigest ?? row.assertion_digest ?? digest(row),
      status: "selected-warning",
      authority: false
    }));
    let receiptRows = receipts.map((row) => ({
      kind: "govPackageReceipt.v1",
      repoId,
      packageId: row.package_id,
      receiptRef: row.receipt_id,
      receiptClass: "ops-package-response",
      checkId: row.checkId ?? row.check_id ?? "ops-package-responses",
      decisionDigest: row.decisionDigest ?? row.decision_digest ?? digest({ packageId: row.package_id, receipt: row.receipt_id }),
      assertionDigest: row.assertionDigest ?? row.assertion_digest ?? digest({ claim: row.response_claim_id, packageId: row.package_id }),
      evidenceDigest: row.evidenceDigest ?? row.evidence_digest ?? digest(row.evidence_refs ?? []),
      status: row.status,
      authority: false
    }));
    let findingRows = [
      ...residuals.map((row) => ({
        kind: "govPackageFinding.v1",
        repoId,
        packageId: row.packageId ?? row.package_id,
        diagnosticClass: "returned-residual",
        severity: "info",
        blocking: false,
        expected: "governance final join owns reusable strict admission",
        actual: row.reason,
        delta: row.status,
        likelyOwner: "governance",
        nextAction: "wait for governance reusable package check export before local cutover",
        authority: false
      })),
      ...drifts.map((row) => ({
        kind: "govPackageFinding.v1",
        repoId,
        packageId: row.packageId ?? row.package_id,
        diagnosticClass: row.driftType ?? row.drift_type,
        severity: row.severity,
        blocking: false,
        expected: "selected ops packet only claims packages with accepted selected obligations",
        actual: row.meaning,
        delta: "observed package is unregistered for selected package response coverage",
        likelyOwner: "adrs/governance",
        nextAction: "either add accepted obligation coverage or keep as explicit non-authority drift",
        authority: false
      }))
    ];
    let admissionRows = packageRows.map((row) => ({
      kind: "govPackageAdmission.v1",
      repoId,
      packageId: row.packageId,
      status: "selected-warning",
      active: false,
      reason: "ops emits joinable evidence, but governance final join has not admitted this package as organization-active",
      authority: false
    }));
    let repo = {
      kind: "govRepoOutput.v1",
      repoId,
      repoClass,
      purpose: "Emit ops effectful execution evidence as non-authority package-facing governance input.",
      authorityBoundary: "ADRS owns accepted meaning; governance joins; ops emits evidence and residuals only.",
      finalGateRef: "gov-final-scope-purpose-join / gate",
      nonGoals: [
        "do not make ops a meaning authority",
        "do not claim organization-active admission",
        "do not hide residual package or effectful gaps"
      ]
    };
    let readmeReceipt = [{ kind: "readmeProjectionReceipt.v1", repoId, surface: "README.md", projectionMode: "selected-warning", status: "not-final-authority", authority: false }];
    let providerCi = [
      { kind: "govProviderCiRow.v1", repoId, workflow: "nix-check", role: "receipt-producer", status: "declared", authority: false },
      { kind: "govProviderCiRow.v1", repoId, workflow: "gov package validation", role: "packet-validator", status: "declared", authority: false }
    ];
    let manifest = {
      kind: "govPackageOutput.v1",
      repoId,
      repoClass,
      projectionMode: "selected-warning",
      nonAuthority: true,
      status: "selected-warning",
      producer: "ops-gov-package-output",
      producerInput: "ops-package-responses",
      generatedAt,
      sourceDigest: digest({ packageRows, assertionRows, receiptRows, findingRows, admissionRows }),
      sourceRefs: ["roccho-dev/ops#27", "roccho-dev/ops#28"],
      packetFiles
    };
    fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    fs.writeFileSync(path.join(outDir, "repo.json"), JSON.stringify(repo, null, 2) + "\n");
    writeJsonl(path.join(outDir, "packages.jsonl"), packageRows);
    writeJsonl(path.join(outDir, "assertions.jsonl"), assertionRows);
    writeJsonl(path.join(outDir, "receipts.jsonl"), receiptRows);
    writeJsonl(path.join(outDir, "readmeProjectionReceipt.jsonl"), readmeReceipt);
    writeJsonl(path.join(outDir, "provider-ci.jsonl"), providerCi);
    writeJsonl(path.join(outDir, "findings.jsonl"), findingRows);
    writeJsonl(path.join(outDir, "admission.jsonl"), admissionRows);
    return { ok: true, kind: "ops.govPackageOutput.emit.v1", repoId, outDir, packetFiles, rowCounts: { packages: packageRows.length, assertions: assertionRows.length, receipts: receiptRows.length, findings: findingRows.length, admission: admissionRows.length } };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
function validate(outDir) {
  if (!outDir) throw Error("--out-dir is required");
  let errors = [];
  for (let file of packetFiles) if (!fs.existsSync(path.join(outDir, file)) || fs.statSync(path.join(outDir, file)).size === 0) errors.push({ code: "missing-packet-file", file });
  if (errors.length) return { ok: false, errors };
  let manifest = JSON.parse(fs.readFileSync(path.join(outDir, "manifest.json"), "utf8"));
  let repo = JSON.parse(fs.readFileSync(path.join(outDir, "repo.json"), "utf8"));
  let packages = readJsonl(path.join(outDir, "packages.jsonl"));
  let assertions = readJsonl(path.join(outDir, "assertions.jsonl"));
  let receipts = readJsonl(path.join(outDir, "receipts.jsonl"));
  let findings = readJsonl(path.join(outDir, "findings.jsonl"));
  let admission = readJsonl(path.join(outDir, "admission.jsonl"));
  if (manifest.kind !== "govPackageOutput.v1") errors.push({ code: "manifest-kind" });
  if (manifest.repoId !== repoId || repo.repoId !== repoId) errors.push({ code: "repo-id-mismatch" });
  if (manifest.nonAuthority !== true) errors.push({ code: "manifest-authority-boundary" });
  for (let row of [...packages, ...assertions, ...receipts, ...findings, ...admission]) {
    if (row.repoId !== repoId) errors.push({ code: "row-repo-id-mismatch", kind: row.kind, packageId: row.packageId });
    if (row.authority !== false && row.nonAuthority !== true) errors.push({ code: "row-authority-boundary", kind: row.kind, packageId: row.packageId });
  }
  for (let row of receipts) {
    for (let field of ["decisionDigest", "assertionDigest", "evidenceDigest"]) {
      if (!String(row[field] ?? "").startsWith("sha256:")) errors.push({ code: "missing-receipt-digest", packageId: row.packageId, field });
    }
  }
  if (admission.some((row) => row.active === true || row.status === "organization-active")) errors.push({ code: "overclaimed-active-admission" });
  return { ok: errors.length === 0, kind: "ops.govPackageOutput.validation.v1", repoId, counts: { packages: packages.length, assertions: assertions.length, receipts: receipts.length, findings: findings.length, admission: admission.length }, errors };
}
function selftest(repoRoot) {
  let tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ops-gov-package-output-"));
  try {
    let outDir = path.join(tmp, "packet");
    emit(outDir, repoRoot);
    let result = validate(outDir);
    if (!result.ok) return result;
    fs.rmSync(path.join(outDir, "receipts.jsonl"));
    let broken = validate(outDir);
    if (broken.ok) return { ok: false, errors: [{ code: "missing-receipts-fixture-passed" }] };
    return { ...result, negativeFixture: "pass" };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
try {
  let args = parseArgv(process.argv.slice(2));
  let result;
  if (args.command === "emit") result = emit(args.outDir, args.repoRoot);
  else if (args.command === "validate") result = validate(args.outDir);
  else if (args.command === "selftest") result = selftest(args.repoRoot);
  else throw Error(`unknown command: ${args.command}\n${usage()}`);
  if (args.json || args.command !== "emit") console.log(JSON.stringify(result, null, 2));
  else console.log(`emitted ops gov package output to ${args.outDir}`);
  process.exit(result.ok === false ? 1 : 0);
} catch (error) {
  console.error(error.message);
  console.error(usage());
  process.exit(2);
}
