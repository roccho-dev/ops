#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

function digest(value) {
  return "sha256:" + crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function json(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function jsonl(filePath, rows) {
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ops-claim-selected-"));
const specPath = path.join(dir, "implements.json");
const grantsPath = path.join(dir, "grants.jsonl");
const universePath = path.join(dir, "universe.jsonl");
const tool = path.join(process.cwd(), "tools/check-ops-real-claim-admission-strict-closure.mjs");
const item = {
  package: "selected-package",
  contractId: "spec.packages.selected-package.v1",
  outputs: ["packages.<system>.selected-package"],
  checks: ["checks.<system>.selected-package"]
};
const extra = {
  package: "unselected-package",
  contractId: "spec.packages.unselected-package.v1",
  outputs: ["packages.<system>.unselected-package"],
  checks: ["checks.<system>.unselected-package"]
};
const spec = { kind: "spec.implements.v1", governanceRev: "fixture-rev", implements: [item, extra] };
const subjectId = "repo:ops:selected-package";
json(specPath, spec);
jsonl(universePath, [{ subjectId }]);
jsonl(grantsPath, [{
  subjectId,
  contractId: item.contractId,
  grantId: "fixture-grant",
  acceptedBundleDigest: "rev:fixture-rev",
  sourceClosureDigest: digest([item]),
  claimDigest: digest({ package: item.package, contractId: item.contractId, outputs: item.outputs, checks: item.checks }),
  lifecycle: "active"
}]);

const pass = spawnSync(process.execPath, [tool, "--strict", "--spec", specPath, "--upstream-grants", grantsPath, "--selected-universe", universePath], { encoding: "utf8" });
if (pass.status !== 0 || !pass.stderr.includes('"status": "pass"')) {
  throw new Error(`selected universe pass fixture failed\n${pass.stderr}`);
}

const miss = spawnSync(process.execPath, [tool, "--strict", "--spec", specPath, "--upstream-grants", grantsPath], { encoding: "utf8" });
if (miss.status === 0 || !miss.stderr.includes("missing-selected-universe")) {
  throw new Error(`missing universe fixture failed\n${miss.stderr}`);
}

console.log(JSON.stringify({ ok: true, fixture: "selected-universe-strict-closure" }));
