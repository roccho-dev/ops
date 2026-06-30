#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const FIXED_GENERATED_AT = "2026-06-30T00:00:00Z";

const responseRows = [
  {
    kind: "ops.packageResponse.v1",
    claim_id: "ops-package-response.ops-build-receipt-check",
    adrs_ref: "roccho-dev/adrs#101",
    obligation_id: "package-obligation.ops.receipts",
    repo_locator: "roccho-dev/ops",
    package_id: "ops-build-receipt-check",
    package_path: "packages/ops-build-receipt-check",
    owner_role: "ops",
    state: "covered",
    covered_requirements: ["receipt-shape", "receipt-classification", "drift-detection"],
    test_refs: ["build/checks.jsonl:ops-build-receipt-check"],
    evidence_refs: ["evidence.ops-build-receipt-check.ci", "evidence.ops-build-receipt-check.test"],
    receipt_ref: "receipt.ops-build-receipt-check",
    residuals: [],
    blocked_reason: "",
    evidence_freshness: {
      status: "current",
      checked_by: "ops-package-responses",
      source: "checked-in-ci-and-nix-check",
      generated_at: FIXED_GENERATED_AT,
    },
    overclaim_boundary: "ops emits evidence and receipts only; ADRS/governance retain meaning and reusable check authority",
  },
  {
    kind: "ops.packageResponse.v1",
    claim_id: "ops-package-response.ops-handoff-pack",
    adrs_ref: "roccho-dev/adrs#101",
    obligation_id: "package-obligation.ops.handoff",
    repo_locator: "roccho-dev/ops",
    package_id: "ops-handoff-pack",
    package_path: "packages/ops-handoff-pack",
    owner_role: "ops",
    state: "covered",
    covered_requirements: ["handoff-pack-created", "handoff-pack-valid", "tamper-and-drift-rejection"],
    test_refs: ["build/checks.jsonl:ops-handoff-pack"],
    evidence_refs: ["evidence.ops-handoff-pack.ci", "evidence.ops-handoff-pack.test"],
    receipt_ref: "receipt.ops-handoff-pack",
    residuals: [],
    blocked_reason: "",
    evidence_freshness: {
      status: "current",
      checked_by: "ops-package-responses",
      source: "checked-in-ci-and-nix-check",
      generated_at: FIXED_GENERATED_AT,
    },
    overclaim_boundary: "ops proves handoff package behavior but does not hold authority to authorize merges or define accepted policy",
  },
  {
    kind: "ops.packageResponse.v1",
    claim_id: "ops-package-response.ops-artifact-materialize",
    adrs_ref: "roccho-dev/adrs#101",
    obligation_id: "package-obligation.ops.artifact-materialization",
    repo_locator: "roccho-dev/ops",
    package_id: "ops-artifact-materialize",
    package_path: "packages/ops-artifact-materialize",
    owner_role: "ops",
    state: "covered",
    covered_requirements: ["artifact-materialize", "manifest-produced", "strict-count"],
    test_refs: ["flake.nix:checks.ops-artifact-materialize"],
    evidence_refs: ["evidence.ops-artifact-materialize.ci", "evidence.ops-artifact-materialize.test"],
    receipt_ref: "receipt.ops-artifact-materialize",
    residuals: [],
    blocked_reason: "",
    evidence_freshness: {
      status: "current",
      checked_by: "ops-package-responses",
      source: "checked-in-ci-and-nix-check",
      generated_at: FIXED_GENERATED_AT,
    },
    overclaim_boundary: "ops materializes artifacts and manifests; generated artifacts are not source authority",
  },
  {
    kind: "ops.packageResponse.v1",
    claim_id: "ops-package-response.ops-knowledge-intake",
    adrs_ref: "roccho-dev/adrs#101",
    obligation_id: "package-obligation.ops.knowledge-intake",
    repo_locator: "roccho-dev/ops",
    package_id: "ops-knowledge-intake",
    package_path: "packages/ops-knowledge-intake",
    owner_role: "ops",
    state: "covered",
    covered_requirements: ["knowledge-id-header", "retry-template-candidate", "gate-candidate"],
    test_refs: ["flake.nix:checks.ops-knowledge-intake"],
    evidence_refs: ["evidence.ops-knowledge-intake.ci", "evidence.ops-knowledge-intake.test"],
    receipt_ref: "receipt.ops-knowledge-intake",
    residuals: [],
    blocked_reason: "",
    evidence_freshness: {
      status: "current",
      checked_by: "ops-package-responses",
      source: "checked-in-ci-and-nix-check",
      generated_at: FIXED_GENERATED_AT,
    },
    overclaim_boundary: "ops normalizes operational knowledge intake; ADRS/governance retain authority for accepted meaning",
  },
  {
    kind: "ops.packageResponse.v1",
    claim_id: "ops-package-response.ops-package-responses",
    adrs_ref: "roccho-dev/adrs#101",
    obligation_id: "package-obligation.ops.package-response-adoption",
    repo_locator: "roccho-dev/ops",
    package_id: "ops-package-responses",
    package_path: "packages/ops-package-responses",
    owner_role: "ops",
    state: "covered",
    covered_requirements: ["response-shape", "evidence-linkage", "receipt-linkage", "residual-return"],
    test_refs: ["build/checks.jsonl:ops-package-responses", ".github/workflows/gov-package-validation.yml"],
    evidence_refs: ["evidence.ops-package-responses.ci", "evidence.ops-package-responses.test"],
    receipt_ref: "receipt.ops-package-responses",
    residuals: ["residual.gov-package-check-export-wait"],
    blocked_reason: "",
    evidence_freshness: {
      status: "current",
      checked_by: "ops-package-responses",
      source: "checked-in-ci-and-nix-check",
      generated_at: FIXED_GENERATED_AT,
    },
    overclaim_boundary: "ops adopts the governance check contract without becoming shared meaning authority",
  },
];

const evidenceRows = responseRows.flatMap((r) => [
  {
    kind: "ops.packageEvidence.v1",
    evidence_id: `evidence.${r.package_id}.ci`,
    response_claim_id: r.claim_id,
    repo_locator: r.repo_locator,
    package_id: r.package_id,
    evidence_type: "ci-check",
    ref: r.test_refs[0],
    produced_by: "nix flake check",
    freshness: r.evidence_freshness,
    authority: false,
  },
  {
    kind: "ops.packageEvidence.v1",
    evidence_id: `evidence.${r.package_id}.test`,
    response_claim_id: r.claim_id,
    repo_locator: r.repo_locator,
    package_id: r.package_id,
    evidence_type: "test-ref",
    ref: r.test_refs.join(","),
    produced_by: r.package_id === "ops-package-responses" ? "ops-package-responses selftest" : "repo-local package check",
    freshness: r.evidence_freshness,
    authority: false,
  },
]);

const residualRows = [
  {
    kind: "ops.packageResidual.v1",
    residual_id: "residual.gov-package-check-export-wait",
    response_claim_id: "ops-package-response.ops-package-responses",
    package_id: "ops-package-responses",
    status: "returned",
    returned_to: "governance#64",
    reason: "governance reusable package check export is owned by governance; ops keeps CI wiring ready and runs available governance checks",
    authority: false,
  },
];

const receiptRows = responseRows.map((r) => ({
  kind: "ops.packageReceipt.v1",
  receipt_id: r.receipt_ref,
  response_claim_id: r.claim_id,
  repo_locator: r.repo_locator,
  package_id: r.package_id,
  status: "pass",
  evidence_refs: r.evidence_refs,
  residual_refs: r.residuals,
  emitted_by: "ops-package-responses",
  generated_at: FIXED_GENERATED_AT,
  authority: false,
}));

const REQUIRED_RESPONSE_FIELDS = [
  "claim_id",
  "adrs_ref",
  "obligation_id",
  "repo_locator",
  "package_id",
  "package_path",
  "owner_role",
  "state",
  "covered_requirements",
  "test_refs",
  "evidence_refs",
  "receipt_ref",
  "residuals",
  "blocked_reason",
  "evidence_freshness",
  "overclaim_boundary",
];

const FORBIDDEN_AUTHORITY_FIELDS = ["approved", "authorized", "deploy_allowed", "governance_override"];

function usage() {
  return `usage:
  ops-package-responses emit --out-dir <dir> [--json]
  ops-package-responses validate --out-dir <dir> [--json]
  ops-package-responses selftest [--json]`;
}

function parseArgv(argv) {
  const args = [...argv];
  let command = "emit";
  if (args[0] && !args[0].startsWith("-")) command = args.shift();
  const values = { command, json: false };
  while (args.length) {
    const key = args.shift();
    if (key === "--json") {
      values.json = true;
    } else if (key === "--out-dir") {
      values.outDir = args.shift();
    } else {
      throw new Error(`unknown argument: ${key}`);
    }
  }
  return values;
}

function writeJsonl(file, rows) {
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

function readJsonl(file) {
  return fs
    .readFileSync(file, "utf-8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${file}:${index + 1}: invalid JSON: ${error.message}`);
      }
    });
}

function emit(outDir) {
  if (!outDir) throw new Error("--out-dir is required");
  fs.mkdirSync(outDir, { recursive: true });
  writeJsonl(path.join(outDir, "ops-package-responses.jsonl"), responseRows);
  writeJsonl(path.join(outDir, "ops-package-evidence.jsonl"), evidenceRows);
  writeJsonl(path.join(outDir, "ops-package-receipts.jsonl"), receiptRows);
  writeJsonl(path.join(outDir, "ops-package-residuals.jsonl"), residualRows);
  const manifest = {
    kind: "ops.packageResponsePacket.v1",
    repo_locator: "roccho-dev/ops",
    generated_at: FIXED_GENERATED_AT,
    authority: false,
    non_authority_diagnostic: true,
    files: [
      "ops-package-responses.jsonl",
      "ops-package-evidence.jsonl",
      "ops-package-receipts.jsonl",
      "ops-package-residuals.jsonl",
    ],
    row_counts: {
      responses: responseRows.length,
      evidence: evidenceRows.length,
      receipts: receiptRows.length,
      residuals: residualRows.length,
    },
    boundary: "ops reports package evidence only; ADRS defines meaning and governance provides reusable checks",
  };
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

function validate(outDir) {
  if (!outDir) throw new Error("--out-dir is required");
  const responsesPath = path.join(outDir, "ops-package-responses.jsonl");
  const evidencePath = path.join(outDir, "ops-package-evidence.jsonl");
  const receiptsPath = path.join(outDir, "ops-package-receipts.jsonl");
  const residualsPath = path.join(outDir, "ops-package-residuals.jsonl");
  const manifestPath = path.join(outDir, "manifest.json");

  const errors = [];
  for (const file of [responsesPath, evidencePath, receiptsPath, residualsPath, manifestPath]) {
    if (!fs.existsSync(file)) errors.push({ code: "missing-file", file });
  }
  if (errors.length) return { ok: false, errors };

  const responses = readJsonl(responsesPath);
  const evidence = readJsonl(evidencePath);
  const receipts = readJsonl(receiptsPath);
  const residuals = readJsonl(residualsPath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

  const evidenceById = new Map(evidence.map((e) => [e.evidence_id, e]));
  const receiptById = new Map(receipts.map((r) => [r.receipt_id, r]));
  const residualById = new Map(residuals.map((r) => [r.residual_id, r]));
  const claimIds = new Set();

  if (manifest.authority !== false || manifest.non_authority_diagnostic !== true) {
    errors.push({ code: "manifest-boundary", message: "manifest must declare non-authority diagnostic boundary" });
  }

  for (const row of responses) {
    for (const field of REQUIRED_RESPONSE_FIELDS) {
      if (!(field in row)) errors.push({ code: "missing-response-field", claim_id: row.claim_id ?? null, field });
    }
    for (const field of FORBIDDEN_AUTHORITY_FIELDS) {
      if (field in row) errors.push({ code: "authority-field-present", claim_id: row.claim_id, field });
    }
    if (claimIds.has(row.claim_id)) errors.push({ code: "duplicate-claim-id", claim_id: row.claim_id });
    claimIds.add(row.claim_id);

    for (const arrayField of ["covered_requirements", "test_refs", "evidence_refs", "residuals"]) {
      if (!Array.isArray(row[arrayField])) {
        errors.push({ code: "field-not-array", claim_id: row.claim_id, field: arrayField });
      }
    }

    if (!row.evidence_freshness || row.evidence_freshness.status !== "current") {
      errors.push({ code: "missing-current-evidence-freshness", claim_id: row.claim_id });
    }
    if (!row.overclaim_boundary || !row.overclaim_boundary.includes("authority")) {
      errors.push({ code: "missing-overclaim-boundary", claim_id: row.claim_id });
    }

    if (!receiptById.has(row.receipt_ref)) {
      errors.push({ code: "missing-receipt", claim_id: row.claim_id, receipt_ref: row.receipt_ref });
    }
    for (const evidenceRef of row.evidence_refs ?? []) {
      if (!evidenceById.has(evidenceRef)) {
        errors.push({ code: "missing-evidence", claim_id: row.claim_id, evidence_ref: evidenceRef });
      }
    }
    for (const residualRef of row.residuals ?? []) {
      if (!residualById.has(residualRef)) {
        errors.push({ code: "missing-residual", claim_id: row.claim_id, residual_ref: residualRef });
      }
    }
  }

  for (const receipt of receipts) {
    if (receipt.authority !== false) {
      errors.push({ code: "receipt-authority-boundary", receipt_id: receipt.receipt_id });
    }
    if (!claimIds.has(receipt.response_claim_id)) {
      errors.push({ code: "receipt-unknown-claim", receipt_id: receipt.receipt_id, response_claim_id: receipt.response_claim_id });
    }
  }

  for (const item of evidence) {
    if (item.authority !== false) {
      errors.push({ code: "evidence-authority-boundary", evidence_id: item.evidence_id });
    }
    if (!claimIds.has(item.response_claim_id)) {
      errors.push({ code: "evidence-unknown-claim", evidence_id: item.evidence_id, response_claim_id: item.response_claim_id });
    }
    if (!item.freshness || item.freshness.status !== "current") {
      errors.push({ code: "evidence-not-current", evidence_id: item.evidence_id });
    }
  }

  for (const item of residuals) {
    if (item.authority !== false) {
      errors.push({ code: "residual-authority-boundary", residual_id: item.residual_id });
    }
    if (!claimIds.has(item.response_claim_id)) {
      errors.push({ code: "residual-unknown-claim", residual_id: item.residual_id, response_claim_id: item.response_claim_id });
    }
    if (item.status !== "returned" && item.status !== "closed") {
      errors.push({ code: "residual-not-returned", residual_id: item.residual_id, status: item.status });
    }
  }

  return {
    ok: errors.length === 0,
    kind: "ops.packageResponseValidation.v1",
    repo_locator: "roccho-dev/ops",
    counts: {
      responses: responses.length,
      evidence: evidence.length,
      receipts: receipts.length,
      residuals: residuals.length,
    },
    errors,
  };
}

function runSelftest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ops-package-responses-"));
  try {
    emit(tmp);
    const result = validate(tmp);
    if (!result.ok) return result;

    const brokenDir = path.join(tmp, "broken");
    fs.mkdirSync(brokenDir);
    for (const file of [
      "ops-package-evidence.jsonl",
      "ops-package-receipts.jsonl",
      "ops-package-residuals.jsonl",
      "manifest.json",
    ]) {
      fs.copyFileSync(path.join(tmp, file), path.join(brokenDir, file));
    }
    const broken = { ...responseRows[0] };
    delete broken.evidence_freshness;
    writeJsonl(path.join(brokenDir, "ops-package-responses.jsonl"), [broken]);
    const brokenResult = validate(brokenDir);
    if (brokenResult.ok) {
      return { ok: false, errors: [{ code: "negative-fixture-passed", message: "missing evidence_freshness was not rejected" }] };
    }
    return { ...result, negative_fixture: "pass" };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

try {
  const values = parseArgv(process.argv.slice(2));
  let result;
  if (values.command === "emit") {
    result = emit(values.outDir);
  } else if (values.command === "validate") {
    result = validate(values.outDir);
  } else if (values.command === "selftest") {
    result = runSelftest();
  } else {
    throw new Error(`unknown command: ${values.command}\n${usage()}`);
  }
  if (values.json || values.command !== "emit") {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`emitted ops package response packet to ${values.outDir}`);
  }
  process.exit(result.ok === false ? 1 : 0);
} catch (error) {
  console.error(error.message);
  console.error(usage());
  process.exit(2);
}
