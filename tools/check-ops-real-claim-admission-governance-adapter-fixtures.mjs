#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function makeFakeChecker(filePath) {
  fs.writeFileSync(filePath, `#!/usr/bin/env node
const fs = require("node:fs");
function take(flag) {
  const i = process.argv.indexOf(flag);
  if (i === -1 || !process.argv[i + 1]) throw new Error(flag + " is required");
  return process.argv[i + 1];
}
const upstream = take("--upstream-grants");
const downstream = take("--downstream-assertions");
const receipts = take("--receipts");
const out = take("--out");
for (const p of [upstream, downstream, receipts]) {
  if (!fs.existsSync(p)) throw new Error("missing input " + p);
}
const claims = fs.readFileSync(downstream, "utf8").trim().split(/\\r?\\n/).filter(Boolean).map(JSON.parse);
if (claims.length !== 1) throw new Error("expected one downstream assertion");
fs.writeFileSync(out, JSON.stringify({
  kind: "governance.organizationAdmission.v1",
  subjectId: claims[0].subjectId,
  contractId: claims[0].contractId,
  admissionResult: "organization-active",
  diagnosticClass: "organization-active",
  grantId: "fixture-grant",
  assertionId: claims[0].assertionId,
  receiptId: "fixture-receipt",
  diagnostic: "fixture-external-checker"
}) + "\\n");
`, { mode: 0o755 });
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ops-claim-adapter-fixture-"));
const specPath = path.join(tmpDir, "implements.json");
const missingGrantsPath = path.join(tmpDir, "missing-upstream-grants.jsonl");
const fakeCheckerPath = path.join(tmpDir, "fake-governance-checker.cjs");
writeJson(specPath, {
  kind: "spec.implements.v1",
  governanceRev: "fixture-rev",
  implements: [
    {
      package: "fixture-package",
      contractId: "spec.packages.fixture-package.v1",
      outputs: ["packages.<system>.fixture-package"],
      checks: ["checks.<system>.fixture-package"]
    }
  ]
});
makeFakeChecker(fakeCheckerPath);

const result = spawnSync(process.execPath, [
  path.join(process.cwd(), "tools/check-ops-real-claim-admission.mjs"),
  "--spec", specPath,
  "--upstream-grants", missingGrantsPath,
  "--governance-checker", fakeCheckerPath,
], { encoding: "utf8" });

assert(result.status === 0, `external governance adapter fixture failed\nstdout=${result.stdout}\nstderr=${result.stderr}`);
assert(result.stderr.includes('"checkerSource": "external-governance"'), "report must show external governance checker source");
assert(result.stderr.includes('"status": "pass"'), "external checker active admission should pass");
console.log(JSON.stringify({ ok: true, fixture: "ops-real-claim-admission-governance-adapter" }));
