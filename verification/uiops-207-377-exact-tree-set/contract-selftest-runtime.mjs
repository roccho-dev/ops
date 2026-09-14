import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fixtureRoot, mobile, ops, sourceVerifier, ui } from "./contract-selftest-repos.mjs";
import { artifactPath, inputPath, opsReceiptPath, providerPath, uiReceiptPath } from "./contract-selftest-data.mjs";

function gateArgs({
  verifier = join(ops.root, "verification/uiops-207-377-exact-tree-set/verify.mjs"),
  input = inputPath,
  provider = providerPath,
  artifact = artifactPath,
  uiReceiptFile = uiReceiptPath,
  opsReceiptFile = opsReceiptPath,
  workName,
} = {}) {
  const parent = join(fixtureRoot, "work");
  mkdirSync(parent, { recursive: true });
  return {
    verifier,
    args: [
      "--input", input,
      "--mobile-agent-root", mobile.root,
      "--ops-consumer-receipt", opsReceiptFile,
      "--ops-root", ops.root,
      "--provider-snapshot", provider,
      "--ui-artifact", artifact,
      "--ui-publication-receipt", uiReceiptFile,
      "--ui-root", ui.root,
      "--work-root", join(parent, workName),
    ],
  };
}

function runGate(options) {
  const { verifier, args } = gateArgs(options);
  return spawnSync(process.execPath, [verifier, ...args], { encoding: "utf8" });
}

function expectFailure(name, result, pattern) {
  assert.notEqual(result.status, 0, `${name} unexpectedly passed`);
  assert.match(`${result.stderr}\n${result.stdout}`, pattern, `${name} failed for the wrong reason`);
}

export { expectFailure, runGate };
