#!/usr/bin/env node
// Validate a build receipt JSON and classify common failures.
//
// Blocking checks:
//   - authority field prohibition
//   - duplicate input IDs
//   - rawHash/proposalHash mismatch
//   - metadata.rawHash, metadata.treeHash, metadata.dirty always required
//   - dirty=true with empty treeHash
//   - missing required fields
//   - missing outputs.outputSpecAsserted or outputs.contentHash
//   - stale intentRev (when --intent-rev is supplied)
//
// Advisory checks:
//   - ADR linkage presence
//   - breaking-change marker when failure=true
//   - environment/toolchain metadata gaps

import fs from "node:fs";
import process from "node:process";
import { parseArgs } from "node:util";

process.on("unhandledRejection", (e) => {
  console.error(e);
  process.exit(1);
});

const { values } = parseArgs({
  options: {
    input: { type: "string" },
    "intent-rev": { type: "string", default: "" },
    json: { type: "boolean", default: false },
  },
  strict: true,
});

if (!values.input) {
  console.error("usage: ops-build-receipt-check --input <receipt.json> [--intent-rev <rev>] [--json]");
  process.exit(2);
}

const raw = fs.readFileSync(values.input, "utf-8");
const receipt = JSON.parse(raw);

const AUTHORITY_FIELDS = [
  "approved",
  "authorized",
  "signed_off",
  "deploy_allowed",
  "approved_by",
  "governance_override",
];

const REQUIRED_TOP_LEVEL = [
  "kind",
  "receiptId",
  "createdAt",
  "buildResult",
  "classification",
  "inputs",
  "outputs",
  "environment",
  "metadata",
];

const VALID_CLASSIFICATIONS = [
  "success",
  "unintended_breakage",
  "intended_breaking_change",
  "input_schema_projection_gap",
  "env_toolchain_cache",
  "governance_traceability_gap",
];

const errors = [];
const advisories = [];

// 1. Required top-level fields
for (const field of REQUIRED_TOP_LEVEL) {
  if (!(field in receipt)) {
    errors.push({ code: "missing-required-field", field, message: `missing required field: ${field}` });
  }
}

// 2. Kind check
if (receipt.kind !== "build.receipt.v1") {
  errors.push({ code: "invalid-kind", message: `kind must be 'build.receipt.v1', got '${receipt.kind}'` });
}

// 3. Authority field prohibition
for (const field of AUTHORITY_FIELDS) {
  if (field in receipt) {
    errors.push({ code: "authority-field-present", field, message: `authority field prohibited: ${field}` });
  }
}

// 4. Classification validity
if (receipt.classification && !VALID_CLASSIFICATIONS.includes(receipt.classification)) {
  errors.push({
    code: "invalid-classification",
    message: `classification '${receipt.classification}' is not valid; expected one of: ${VALID_CLASSIFICATIONS.join(", ")}`,
  });
}

// 5. Input ID uniqueness
if (Array.isArray(receipt.inputs)) {
  const ids = receipt.inputs.map((i) => i.inputId);
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) {
      errors.push({ code: "duplicate-input-id", inputId: id, message: `duplicate input ID: ${id}` });
    }
    seen.add(id);
  }
  // Input rawHash presence
  for (const inp of receipt.inputs) {
    if (!inp.rawHash) {
      errors.push({ code: "input-missing-rawHash", inputId: inp.inputId, message: `input '${inp.inputId}' missing rawHash` });
    }
  }
}

// 6. Metadata checks
if (receipt.metadata) {
  // rawHash always required
  if (!receipt.metadata.rawHash) {
    errors.push({ code: "metadata-missing-rawHash", message: "metadata.rawHash is required" });
  }

  // treeHash always required
  if (receipt.metadata.treeHash == null || receipt.metadata.treeHash === "") {
    errors.push({ code: "metadata-missing-treeHash", message: "metadata.treeHash is required" });
  }

  // dirty always required
  if (typeof receipt.metadata.dirty !== "boolean") {
    errors.push({ code: "metadata-missing-dirty", message: "metadata.dirty (boolean) is required" });
  }

  // rawHash/proposalHash mismatch
  if (receipt.metadata.rawHash && receipt.metadata.proposalHash) {
    if (receipt.metadata.rawHash !== receipt.metadata.proposalHash) {
      errors.push({
        code: "rawHash-proposalHash-mismatch",
        rawHash: receipt.metadata.rawHash,
        proposalHash: receipt.metadata.proposalHash,
        message: "rawHash and proposalHash do not match — input drift detected",
      });
    }
  }

  // dirty=true with empty treeHash
  if (receipt.metadata.dirty === true) {
    if (!receipt.metadata.treeHash) {
      errors.push({
        code: "dirty-without-treeHash",
        message: "dirty tree must have a non-empty treeHash",
      });
    }
  }

  // stale intentRev — blocking reject when --intent-rev is supplied
  if (values["intent-rev"] && receipt.metadata.intentRev) {
    if (receipt.metadata.intentRev !== values["intent-rev"]) {
      errors.push({
        code: "stale-intent-rev",
        expected: values["intent-rev"],
        actual: receipt.metadata.intentRev,
        message: `intentRev '${receipt.metadata.intentRev}' does not match expected '${values["intent-rev"]}'`,
      });
    }
  }

  // ADR linkage advisory
  if (!receipt.metadata.adrLinkage || receipt.metadata.adrLinkage.length === 0) {
    advisories.push({
      code: "no-adr-linkage",
      severity: "info",
      message: "no ADR linkage provided",
    });
  }

  // Breaking change marker advisory
  if (receipt.buildResult === "failure" && receipt.metadata.breakingChangeMarker !== true) {
    advisories.push({
      code: "failure-without-breaking-marker",
      severity: "warning",
      message: "build failed but breakingChangeMarker is not set",
    });
  }
}

// 7. Output checks: outputSpecAsserted and contentHash required
if (receipt.outputs) {
  if (receipt.outputs.outputSpecAsserted == null) {
    errors.push({
      code: "output-missing-outputSpecAsserted",
      message: "outputs.outputSpecAsserted is required",
    });
  } else if (receipt.outputs.outputSpecAsserted === false) {
    errors.push({
      code: "output-spec-not-asserted",
      message: "outputs.outputSpecAsserted is false — output content was not verified against spec",
    });
  }
  if (!receipt.outputs.contentHash) {
    errors.push({
      code: "output-missing-contentHash",
      message: "outputs.contentHash is required",
    });
  }
}

// 8. Environment metadata gaps advisory
if (receipt.environment) {
  if (!receipt.environment.toolchain || Object.keys(receipt.environment.toolchain).length === 0) {
    advisories.push({
      code: "env-toolchain-empty",
      severity: "info",
      message: "environment.toolchain is empty or missing",
    });
  }
}

const ok = errors.length === 0;
const classification = receipt.classification || "unknown";

const result = {
  ok,
  classification,
  receiptId: receipt.receiptId || null,
  errors,
  advisories,
};

if (values.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  if (ok) {
    console.log(`PASS: receipt ${result.receiptId} classification=${classification}`);
  } else {
    console.log(`FAIL: receipt ${result.receiptId || "(unknown)"} — ${errors.length} error(s)`);
    for (const e of errors) {
      console.log(`  [${e.code}] ${e.message}`);
    }
  }
  if (advisories.length > 0) {
    console.log(`  ${advisories.length} advisory(ies):`);
    for (const a of advisories) {
      console.log(`  [${a.code}] ${a.message}`);
    }
  }
}

process.exit(ok ? 0 : 1);
