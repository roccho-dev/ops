#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  GATE_ID,
  RECEIPT_BASENAME,
  RECEIPT_SCHEMA,
  assertExternalFreshWorkRoot,
  parseCli,
  validateGateInput,
} from "./contract.mjs";

const options = parseCli(process.argv.slice(2));
const inputBytes = readFileSync(options.input);
const input = validateGateInput(JSON.parse(inputBytes.toString("utf8")));

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();

function repositoryFromRemote(remote) {
  const match = remote.replace(/\.git$/u, "").match(/github\.com(?::|\/)([^/]+\/[^/]+)$/u);
  return match?.[1] ?? null;
}

function assertRepository(root, spec, label) {
  assert(statSync(root).isDirectory(), `${label} root must be a directory`);
  assert.equal(repositoryFromRemote(git(root, "remote", "get-url", "origin")), spec.repository, `${label} origin mismatch`);
  assert.equal(git(root, "status", "--porcelain", "--untracked-files=all"), "", `${label} checkout must be clean`);
  const head = git(root, "rev-parse", "HEAD");
  const tree = git(root, "rev-parse", "HEAD^{tree}");
  assert.equal(head, spec.head, `${label} head mismatch`);
  assert.equal(tree, spec.tree, `${label} tree mismatch`);
  if (spec.base) execFileSync("git", ["-C", root, "merge-base", "--is-ancestor", spec.base, spec.head]);
  return { head, tree };
}

assertExternalFreshWorkRoot(options.workRoot, {
  mobileAgent: options.mobileAgentRoot,
  ops: options.opsRoot,
  ui: options.uiRoot,
});
assert.equal(existsSync(options.workRoot), false, "work root must not already exist");
assert(statSync(dirname(options.workRoot)).isDirectory(), "work root parent must exist");
assert(statSync(options.uiArtifact).isFile(), "UI artifact must be a file");
assert(statSync(options.opsReceipt).isFile(), "OPS consumer receipt must be a file");

const observed = {
  mobileAgent: assertRepository(options.mobileAgentRoot, input.mobileAgent, "mobileAgent"),
  ops: assertRepository(options.opsRoot, input.ops, "ops"),
  ui: assertRepository(options.uiRoot, input.ui, "ui"),
};

for (const [name, verifier] of Object.entries(input.verifiers)) {
  assert.equal(
    git(options.opsRoot, "rev-parse", `${input.ops.head}:${verifier.path}`),
    verifier.blob,
    `${name} verifier blob mismatch`,
  );
}

const uiArtifactBytes = readFileSync(options.uiArtifact);
const opsReceiptBytes = readFileSync(options.opsReceipt);
assert.equal(sha256(uiArtifactBytes), input.ui.artifactDigest, "UI artifact digest mismatch");
assert.equal(sha256(opsReceiptBytes), input.ops.consumerReceiptDigest, "OPS consumer receipt digest mismatch");

mkdirSync(options.workRoot);
const presentationWorkRoot = join(options.workRoot, "presentation-shared-visual");
const presentationVerifier = join(options.opsRoot, input.verifiers.presentationSharedVisual.path);
execFileSync(process.execPath, [
  presentationVerifier,
  "--mobile-agent-root", options.mobileAgentRoot,
  "--ui-root", options.uiRoot,
  "--work-root", presentationWorkRoot,
], { cwd: options.opsRoot, stdio: "pipe" });
const presentationReceiptPath = join(presentationWorkRoot, "presentation-shared-visual.receipt.json");
const presentationReceipt = JSON.parse(readFileSync(presentationReceiptPath, "utf8"));
assert.equal(presentationReceipt.status, "PASS", "presentation shared visual proof failed");

const receipt = {
  schema: RECEIPT_SCHEMA,
  gate: GATE_ID,
  status: "PASS",
  authority: false,
  inputDigest: sha256(inputBytes),
  exactTreeSet: {
    mobileAgent: { ...input.mobileAgent, observed: observed.mobileAgent },
    ops: { ...input.ops, observed: observed.ops },
    ui: { ...input.ui, observed: observed.ui },
  },
  verifiers: input.verifiers,
  consumed: {
    uiArtifact: { sha256: input.ui.artifactDigest, bytes: uiArtifactBytes.length },
    opsReceipt: { sha256: input.ops.consumerReceiptDigest, bytes: opsReceiptBytes.length },
  },
  proofs: {
    presentationSharedVisual: {
      schema: presentationReceipt.schema,
      status: presentationReceipt.status,
      receiptPath: "presentation-shared-visual/presentation-shared-visual.receipt.json",
    },
  },
  invalidation: "any input, head, tree, artifact, receipt, check identity, contract version, or verifier blob change requires a new full run",
};
const receiptPath = join(options.workRoot, RECEIPT_BASENAME);
const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
writeFileSync(receiptPath, receiptBytes, { flag: "wx" });
process.stdout.write(`${JSON.stringify({
  gate: GATE_ID,
  status: "PASS",
  receiptPath,
  receiptSha256: sha256(receiptBytes),
})}\n`);
