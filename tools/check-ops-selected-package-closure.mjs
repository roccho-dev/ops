#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const repo = "roccho-dev/ops";
const adrsRef = "roccho-dev/adrs#134";
const parentRef = "roccho-dev/governance#125";
const issueRef = "roccho-dev/ops#30";
const selected = [
  ["ops-build-receipt-check", "package-obligation.ops.receipts", "packages/ops-build-receipt-check"],
  ["ops-handoff-pack", "package-obligation.ops.handoff", "packages/ops-handoff-pack"],
  ["ops-artifact-materialize", "package-obligation.ops.artifact-materialization", "packages/ops-artifact-materialize"],
  ["ops-knowledge-intake", "package-obligation.ops.knowledge-intake", "packages/ops-knowledge-intake"],
  ["ops-package-responses", "package-obligation.ops.package-response-adoption", "packages/ops-package-responses"],
];
const selectedIds = new Set(selected.map(([id]) => id));
const sourceKinds = new Set(["build-packages-jsonl", "flake-generated", "source-dir"]);

function readJsonl(file) {
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line, i) => {
    try { return JSON.parse(line); } catch (error) { throw Error(`${file}:${i + 1}: ${error.message}`); }
  });
}
function writeJsonl(file, rows) {
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}
function pid(row) { return row.package_id || row.packageId || row.packageIdCandidate || ""; }
function receiptOf(id) { return `receipt.${id}`; }
function byPackage(rows) {
  const out = new Map();
  for (const row of rows) if (pid(row)) out.set(pid(row), row);
  return out;
}
function normalizeResponse(row, id, obligation, packagePath) {
  const tests = row.tests || row.test_refs || row.requiredTests || row.required_tests || [];
  const receipt = receiptOf(id);
  return {
    kind: "packageResponse.v1",
    claimId: row.claimId || row.claim_id || `ops-package-response.${id}`,
    claim_id: row.claim_id || row.claimId || `ops-package-response.${id}`,
    adrsRef,
    adrs_ref: adrsRef,
    obligationId: obligation,
    obligation_id: obligation,
    repo,
    repo_locator: repo,
    packageId: id,
    package_id: id,
    packagePath: packagePath,
    package_path: packagePath,
    ownerRole: "ops",
    owner_role: "ops",
    requiredTests: tests,
    required_tests: tests,
    tests,
    test_refs: tests,
    receipt,
    receipt_ref: receipt,
    receipts: [receipt],
    residuals: [],
    status: "implemented",
    state: "covered",
    authority: false,
    source_kind: "ops.selectedPackageClosureResponse.v1",
  };
}
function drift(code, id, current, ideal) {
  return { kind: "ops.selectedPackageClosureDrift.v1", repo_locator: repo, package_id: id, diagnostic: code, current, ideal, issue_ref: issueRef, authority: false };
}
export function run(outDir) {
  const inventory = readJsonl(path.join(outDir, "package-inventory.jsonl"));
  const responses = readJsonl(path.join(outDir, "package-responses.jsonl"));
  const receipts = readJsonl(path.join(outDir, "ops-package-receipts.jsonl"));
  const invRows = inventory.filter((row) => selectedIds.has(pid(row)) && (sourceKinds.has(row.source_kind) || sourceKinds.has(row.sourceKind)));
  const sourceIds = new Set(invRows.map(pid));
  const responseById = byPackage(responses);
  const receiptById = byPackage(receipts);
  const selectedResponses = [];
  const selectedReceipts = [];
  const drifts = [];
  for (const [id, obligation, packagePath] of selected) {
    if (!sourceIds.has(id)) drifts.push(drift("selected-inventory-missing", id, "no selected source inventory row", "emit selected package inventory"));
    const response = responseById.get(id);
    if (!response) drifts.push(drift("selected-response-missing", id, "no selected package response", "emit packageResponse.v1"));
    else selectedResponses.push(normalizeResponse(response, id, obligation, packagePath));
    const receipt = receiptById.get(id);
    if (!receipt) drifts.push(drift("selected-receipt-missing", id, "no selected receipt", "emit closure receipt"));
    else selectedReceipts.push({ ...receipt, kind: "ops.selectedPackageClosureReceipt.v1", issue_ref: issueRef, parent_ref: parentRef, authority: false });
  }
  const report = {
    kind: "ops.selectedPackageClosure.report.v1",
    status: drifts.length === 0 ? "closure-pass" : "closure-fail",
    blocking_drifts: drifts.length,
    repo_locator: repo,
    adrs_ref: adrsRef,
    parent_ref: parentRef,
    issue_ref: issueRef,
    selected_package_ids: [...selectedIds].sort(),
    authority: false,
    boundary: "ops selected closure evidence only; ADRS/governance retain meaning authority and final strict-gate ownership",
  };
  writeJsonl(path.join(outDir, "selected-package-inventory.jsonl"), invRows);
  writeJsonl(path.join(outDir, "selected-package-responses.jsonl"), selectedResponses);
  writeJsonl(path.join(outDir, "selected-package-receipts.jsonl"), selectedReceipts);
  writeJsonl(path.join(outDir, "selected-package-drifts.jsonl"), drifts);
  fs.writeFileSync(path.join(outDir, "selected-package-closure.json"), JSON.stringify(report, null, 2) + "\n");
  return report;
}
function selftest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ops-selected-closure-"));
  try {
    const out = path.join(tmp, "out");
    fs.mkdirSync(out, { recursive: true });
    writeJsonl(path.join(out, "package-inventory.jsonl"), selected.flatMap(([id,, packagePath]) => [
      { kind: "packageInventory.v1", package_id: id, package_path: packagePath, source_kind: "build-packages-jsonl", authority: false },
      { kind: "packageInventory.v1", package_id: id, package_path: packagePath, source_kind: "source-dir", authority: false },
    ]));
    writeJsonl(path.join(out, "package-responses.jsonl"), selected.map(([id, obligation, packagePath]) => ({ kind: "packageResponse.v1", package_id: id, obligation_id: obligation, package_path: packagePath, tests: ["fixture-test"], receipt: receiptOf(id), authority: false })));
    writeJsonl(path.join(out, "ops-package-receipts.jsonl"), selected.map(([id]) => ({ kind: "ops.packageReceipt.v1", package_id: id, receipt_id: receiptOf(id), status: "pass", authority: false })));
    const pass = run(out);
    if (pass.status !== "closure-pass" || pass.blocking_drifts !== 0) throw Error(JSON.stringify(pass));
    writeJsonl(path.join(out, "ops-package-receipts.jsonl"), []);
    const fail = run(out);
    if (fail.status !== "closure-fail" || fail.blocking_drifts !== selected.length) throw Error(JSON.stringify(fail));
    return { kind: "ops.selectedPackageClosure.selftest.v1", status: "pass", authority: false };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const cmd = args.find((arg) => !arg.startsWith("-")) || "check";
  const outDir = args[args.indexOf("--out-dir") + 1] || "ops-package-response-out";
  const report = cmd === "selftest" ? selftest() : run(outDir);
  console.log(json ? JSON.stringify(report, null, 2) : `ops-selected-package-closure:${report.status}`);
  return report.status === "closure-fail" ? 1 : 0;
}
if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
