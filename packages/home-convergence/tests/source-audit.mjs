import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditRuntimeSource } from "../lib/source-audit.mjs";

const OPS = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePaths = [
  "bin/home-convergence.mjs",
  "lib/home-convergence.mjs",
  "lib/signed-convergence.mjs",
  "lib/source-audit.mjs",
];

const positive = auditRuntimeSource({ root: packageRoot, exactOpsRevision: OPS });
assert.equal(positive.summary.status, "pass");
assert.equal(positive.summary.desired_state_redefined_in_ops, 0);
assert.equal(positive.summary.product_package_duplicates, 0);
assert.equal(positive.summary.raw_secret_schema_fields, 0);
assert.equal(positive.summary.unclassified_effects, 0);
assert.equal(positive.evidence.source_files.length, sourcePaths.length);
assert.equal(positive.evidence.source_files.filter((file) => file.scan).length, 3);
assert.deepEqual(
  auditRuntimeSource({ root: packageRoot, exactOpsRevision: OPS }),
  positive,
  "source audit must be deterministic",
);

const challenge = (needle, field) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "home-convergence-source-"));
  try {
    for (const relativePath of sourcePaths) {
      const destination = path.join(root, relativePath);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(packageRoot, relativePath), destination);
    }
    fs.appendFileSync(path.join(root, "lib/home-convergence.mjs"), `\n${needle}\n`);
    const audit = auditRuntimeSource({ root, exactOpsRevision: OPS });
    assert.equal(audit.summary.status, "fail");
    assert.ok(audit.summary[field] > 0, `${field} must detect ${needle}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

challenge("const desired_state_id: = 'forbidden';", "desired_state_redefined_in_ops");
challenge("fetch('https://example.invalid/package');", "product_package_duplicates");
challenge("const secret_value = 'forbidden';", "raw_secret_schema_fields");
challenge("import 'node:child_process';", "unclassified_effects");

console.log("home convergence runtime source audit: PASS");
