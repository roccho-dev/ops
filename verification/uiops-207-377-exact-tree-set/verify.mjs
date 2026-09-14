#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GATE_ID,
  RECEIPT_BASENAME,
  RECEIPT_SCHEMA,
  assertCanonicalJsonBytes,
  assertExternalFreshWorkRoot,
  canonicalJson,
  parseCli,
  sha256,
  validateGateInput,
  validateInputAgainstSnapshot,
  validateOpsConsumerReceipt,
  validateProviderSnapshot,
  validateUiPublicationReceipt,
} from "./contract.mjs";

const options = parseCli(process.argv.slice(2));
const inputBytes = readFileSync(options.input);
const inputValue = JSON.parse(inputBytes.toString("utf8"));
assertCanonicalJsonBytes(inputBytes, inputValue, "gate input");
const input = validateGateInput(inputValue);

const providerBytes = readFileSync(options.providerSnapshot);
const providerValue = JSON.parse(providerBytes.toString("utf8"));
assertCanonicalJsonBytes(providerBytes, providerValue, "provider snapshot");
const snapshot = validateProviderSnapshot(providerValue);
assert.equal(sha256(providerBytes), input.providerSnapshot.sha256, "provider snapshot digest mismatch");
validateInputAgainstSnapshot(input, snapshot);

const runningVerifier = resolve(fileURLToPath(import.meta.url));
const expectedRunningVerifier = resolve(options.opsRoot, input.verifiers.gate.path);
assert.equal(runningVerifier, expectedRunningVerifier, "gate runner must execute from the exact OPS checkout");

const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();

function repositoryFromRemote(remote) {
  const match = remote.replace(/\.git$/u, "").match(/github\.com(?::|\/)([^/]+\/[^/]+)$/u);
  return match?.[1] ?? null;
}

function assertRepository(root, spec, label, base = null) {
  assert(statSync(root).isDirectory(), `${label} root must be a directory`);
  assert.equal(repositoryFromRemote(git(root, "remote", "get-url", "origin")), spec.repository, `${label} origin mismatch`);
  assert.equal(git(root, "status", "--porcelain", "--untracked-files=all"), "", `${label} checkout must be clean`);
  const commit = git(root, "rev-parse", "HEAD");
  const tree = git(root, "rev-parse", "HEAD^{tree}");
  assert.equal(commit, spec.evaluated.commit, `${label} evaluated commit mismatch`);
  assert.equal(tree, spec.evaluated.tree, `${label} evaluated tree mismatch`);
  if (base) execFileSync("git", ["-C", root, "merge-base", "--is-ancestor", base.commit, commit]);
  return { commit, tree };
}

function assertBlob(root, commit, validator, label) {
  assert.equal(git(root, "rev-parse", `${commit}:${validator.path}`), validator.blob, `${label} validator blob mismatch`);
}

assertExternalFreshWorkRoot(options.workRoot, {
  mobileAgent: options.mobileAgentRoot,
  ops: options.opsRoot,
  ui: options.uiRoot,
});
assert.equal(existsSync(options.workRoot), false, "work root must not already exist");
assert(statSync(dirname(options.workRoot)).isDirectory(), "work root parent must exist");
assert(statSync(options.uiArtifact).isFile(), "UI artifact must be a file");
assert(statSync(options.uiPublicationReceipt).isFile(), "UI publication receipt must be a file");
assert(statSync(options.opsConsumerReceipt).isFile(), "OPS consumer receipt must be a file");

const uiPr = snapshot.pullRequests.ui;
const opsPr = snapshot.pullRequests.ops;
const observed = {
  mobileAgent: assertRepository(
    options.mobileAgentRoot,
    snapshot.repositories.mobileAgent,
    "mobileAgent",
  ),
  ops: assertRepository(options.opsRoot, opsPr, "ops", opsPr.base),
  ui: assertRepository(options.uiRoot, uiPr, "ui", uiPr.base),
};

for (const [name, verifier] of Object.entries(input.verifiers)) {
  assert.equal(
    git(options.opsRoot, "rev-parse", `${opsPr.evaluated.commit}:${verifier.path}`),
    verifier.blob,
    `${name} verifier blob mismatch`,
  );
}
assert.equal(
  git(options.opsRoot, "hash-object", runningVerifier),
  input.verifiers.gate.blob,
  "executed gate runner bytes differ from the exact OPS blob",
);

const uiReceiptBytes = readFileSync(options.uiPublicationReceipt);
const uiReceiptValue = JSON.parse(uiReceiptBytes.toString("utf8"));
assertCanonicalJsonBytes(uiReceiptBytes, uiReceiptValue, "UI publication receipt");
assert.equal(sha256(uiReceiptBytes), input.files.uiPublicationReceiptSha256, "UI publication receipt digest mismatch");
const uiReceipt = validateUiPublicationReceipt(uiReceiptValue, snapshot, input, sha256(uiReceiptBytes));

const opsReceiptBytes = readFileSync(options.opsConsumerReceipt);
const opsReceiptValue = JSON.parse(opsReceiptBytes.toString("utf8"));
assertCanonicalJsonBytes(opsReceiptBytes, opsReceiptValue, "OPS consumer receipt");
assert.equal(sha256(opsReceiptBytes), input.files.opsConsumerReceiptSha256, "OPS consumer receipt digest mismatch");
const opsReceipt = validateOpsConsumerReceipt(
  opsReceiptValue,
  snapshot,
  input,
  uiReceipt,
  sha256(uiReceiptBytes),
  sha256(opsReceiptBytes),
);

assertBlob(options.uiRoot, uiPr.evaluated.commit, uiReceipt.validation.validator, "UI publication owner");
assertBlob(options.opsRoot, opsPr.evaluated.commit, opsReceipt.validation.validator, "OPS consumer owner");

const uiArtifactBytes = readFileSync(options.uiArtifact);
assert.equal(uiArtifactBytes.length, uiReceipt.publication.archive.bytes, "UI artifact byte count mismatch");
assert.equal(sha256(uiArtifactBytes), uiReceipt.publication.archive.sha256, "UI artifact digest mismatch");

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
const presentationReceiptBytes = readFileSync(presentationReceiptPath);
const presentationReceipt = JSON.parse(presentationReceiptBytes.toString("utf8"));
assert.equal(presentationReceipt.status, "PASS", "presentation shared visual proof failed");
assert.equal(presentationReceipt.repositories.mobileAgent.head, snapshot.repositories.mobileAgent.evaluated.commit);
assert.equal(presentationReceipt.repositories.mobileAgent.tree, snapshot.repositories.mobileAgent.evaluated.tree);
assert.equal(presentationReceipt.repositories.ui.head, uiPr.evaluated.commit);
assert.equal(presentationReceipt.repositories.ui.tree, uiPr.evaluated.tree);

const observedAfterProof = {
  mobileAgent: assertRepository(
    options.mobileAgentRoot,
    snapshot.repositories.mobileAgent,
    "mobileAgent after proof",
  ),
  ops: assertRepository(options.opsRoot, opsPr, "ops after proof", opsPr.base),
  ui: assertRepository(options.uiRoot, uiPr, "ui after proof", uiPr.base),
};
assert.deepEqual(observedAfterProof, observed, "repository identity changed during proof");

const receipt = {
  schema: RECEIPT_SCHEMA,
  gate: GATE_ID,
  stage: input.stage,
  status: "PASS",
  authority: false,
  inputDigest: sha256(inputBytes),
  providerSnapshot: {
    schema: snapshot.schema,
    sha256: sha256(providerBytes),
    capturedAt: snapshot.capturedAt,
    source: snapshot.source,
  },
  issueTargets: snapshot.issues,
  exactTreeSet: {
    mobileAgent: {
      ...snapshot.repositories.mobileAgent,
      checks: snapshot.checks.mobileAgent,
      observed: observed.mobileAgent,
    },
    ops: {
      ...opsPr,
      checks: snapshot.checks.ops,
      reviews: snapshot.reviews.ops,
      observed: observed.ops,
    },
    ui: {
      ...uiPr,
      checks: snapshot.checks.ui,
      reviews: snapshot.reviews.ui,
      observed: observed.ui,
    },
  },
  contracts: input.contracts,
  verifiers: input.verifiers,
  consumed: {
    uiPublicationReceipt: {
      schema: uiReceipt.schema,
      sha256: sha256(uiReceiptBytes),
      bytes: uiReceiptBytes.length,
      ownerValidation: uiReceipt.validation,
    },
    uiArtifact: {
      locator: uiReceipt.publication.locator,
      sha256: uiReceipt.publication.archive.sha256,
      bytes: uiArtifactBytes.length,
      manifestSha256: uiReceipt.publication.manifest.sha256,
      hostClosureSha256: uiReceipt.publication.hostClosure.sha256,
    },
    opsConsumerReceipt: {
      schema: opsReceipt.schema,
      sha256: sha256(opsReceiptBytes),
      bytes: opsReceiptBytes.length,
      ownerValidation: opsReceipt.validation,
      lock: opsReceipt.lock,
      assembly: opsReceipt.assembly,
      packageCheck: opsReceipt.packageCheck,
      browser: opsReceipt.browser,
    },
  },
  proofs: {
    presentationSharedVisual: {
      schema: presentationReceipt.schema,
      status: presentationReceipt.status,
      receiptPath: "presentation-shared-visual/presentation-shared-visual.receipt.json",
      receiptSha256: sha256(presentationReceiptBytes),
      receiptBytes: presentationReceiptBytes.length,
    },
  },
  invalidation: "any issue version, PR terminal/evaluated/merge identity, provider snapshot, required check, R/W review, unresolved count, contract version, owner validator, artifact, receipt, verifier blob, repository, or canonical input change requires a new full run",
};
const receiptPath = join(options.workRoot, RECEIPT_BASENAME);
const receiptBytes = Buffer.from(canonicalJson(receipt));
writeFileSync(receiptPath, receiptBytes, { flag: "wx" });
process.stdout.write(`${JSON.stringify({
  gate: GATE_ID,
  stage: input.stage,
  status: "PASS",
  receiptPath,
  receiptSha256: sha256(receiptBytes),
})}\n`);
