#!/usr/bin/env node
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  GATE_ID,
  INPUT_SCHEMA,
  OPS_CONSUMER_RECEIPT_SCHEMA,
  PROVIDER_SNAPSHOT_SCHEMA,
  RECEIPT_BASENAME,
  RECEIPT_SCHEMA,
  UI_PUBLICATION_RECEIPT_SCHEMA,
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
import {
  artifactBytes,
  base,
  clone,
  contractModules,
  digest,
  expectFailure,
  fixtureRoot,
  here,
  makeInput,
  opsReceipt,
  opsReceiptBytes,
  runGate,
  sha,
  snapshot,
  sourceVerifier,
  ui,
  uiReceipt,
  uiReceiptBytes,
} from "./contract-selftest-fixture.mjs";

validateProviderSnapshot(clone(snapshot));
validateGateInput(clone(base.input));
validateInputAgainstSnapshot(base.input, snapshot);
validateUiPublicationReceipt(clone(uiReceipt), snapshot, base.input, sha256(uiReceiptBytes));
validateOpsConsumerReceipt(clone(opsReceipt), snapshot, base.input, uiReceipt, sha256(uiReceiptBytes), sha256(opsReceiptBytes));

const positive = runGate({ workName: "positive" });
assert.equal(positive.status, 0, positive.stderr);
const positiveResult = JSON.parse(positive.stdout.trim());
assert.equal(positiveResult.status, "PASS");
assert.equal(positiveResult.gate, GATE_ID);
assert.equal(positiveResult.stage, "candidate");
assert(readFileSync(join(fixtureRoot, "work", "positive", RECEIPT_BASENAME), "utf8").endsWith("\n"));

const shadowRoot = join(fixtureRoot, "shadow");
mkdirSync(shadowRoot);
copyFileSync(sourceVerifier, join(shadowRoot, "verify.mjs"));
for (const name of contractModules) copyFileSync(join(here, name), join(shadowRoot, name));
expectFailure(
  "shadow runner",
  runGate({ verifier: join(shadowRoot, "verify.mjs"), workName: "shadow" }),
  /gate runner must execute from the exact OPS checkout/u,
);

const dirtyPath = join(ui.root, "DIRTY");
writeFileSync(dirtyPath, "dirty\n");
expectFailure("dirty checkout", runGate({ workName: "dirty" }), /checkout must be clean/u);
unlinkSync(dirtyPath);

function writeCase(name, providerValue, inputValue, uiValue = uiReceipt, opsValue = opsReceipt, artifact = artifactBytes, canonicalInput = true) {
  const root = join(fixtureRoot, "cases", name);
  mkdirSync(root, { recursive: true });
  const providerFile = join(root, "provider.json");
  const inputFile = join(root, "input.json");
  const uiFile = join(root, "ui.json");
  const opsFile = join(root, "ops.json");
  const artifactFile = join(root, "ui.tgz");
  writeFileSync(providerFile, canonicalJson(providerValue));
  writeFileSync(inputFile, canonicalInput ? canonicalJson(inputValue) : `${JSON.stringify(inputValue, null, 2)}\n`);
  writeFileSync(uiFile, canonicalJson(uiValue));
  writeFileSync(opsFile, canonicalJson(opsValue));
  writeFileSync(artifactFile, artifact);
  return { providerFile, inputFile, uiFile, opsFile, artifactFile };
}

const fakePrSnapshot = clone(snapshot);
fakePrSnapshot.pullRequests.ui.number += 1;
fakePrSnapshot.pullRequests.ui.url = `https://github.com/roccho-dev/ui/pull/${fakePrSnapshot.pullRequests.ui.number}`;
const fakePrBase = makeInput(fakePrSnapshot);
const fakePrFiles = writeCase("fake-pr", fakePrSnapshot, fakePrBase.input);
expectFailure("fake PR evidence", runGate({
  workName: "fake-pr",
  provider: fakePrFiles.providerFile,
  input: fakePrFiles.inputFile,
  uiReceiptFile: fakePrFiles.uiFile,
  opsReceiptFile: fakePrFiles.opsFile,
  artifact: fakePrFiles.artifactFile,
}), /provider snapshot\.reviews\.ui\.w\.url mismatch|producer\.pr mismatch/u);

const staleCheckSnapshot = clone(snapshot);
staleCheckSnapshot.checks.ops.evidence[0].actualHead = sha("a");
const staleCheckBase = makeInput(staleCheckSnapshot);
const staleCheckFiles = writeCase("stale-check", staleCheckSnapshot, staleCheckBase.input);
expectFailure("stale check evidence", runGate({
  workName: "stale-check",
  provider: staleCheckFiles.providerFile,
  input: staleCheckFiles.inputFile,
  uiReceiptFile: staleCheckFiles.uiFile,
  opsReceiptFile: staleCheckFiles.opsFile,
  artifact: staleCheckFiles.artifactFile,
}), /actualHead mismatch/u);

const wrongUi = clone(uiReceipt);
wrongUi.schema = "wrong/1";
const wrongUiBase = makeInput(snapshot, wrongUi, opsReceipt);
const wrongUiFiles = writeCase("wrong-ui-schema", snapshot, wrongUiBase.input, wrongUi);
expectFailure("wrong UI receipt schema", runGate({
  workName: "wrong-ui-schema",
  provider: wrongUiFiles.providerFile,
  input: wrongUiFiles.inputFile,
  uiReceiptFile: wrongUiFiles.uiFile,
  opsReceiptFile: wrongUiFiles.opsFile,
  artifact: wrongUiFiles.artifactFile,
}), /UI publication receipt schema mismatch/u);

const mutatedArtifactFiles = writeCase("artifact-mutation", snapshot, base.input, uiReceipt, opsReceipt, Buffer.from("mutated archive\n"));
expectFailure("artifact byte mutation", runGate({
  workName: "artifact-mutation",
  provider: mutatedArtifactFiles.providerFile,
  input: mutatedArtifactFiles.inputFile,
  uiReceiptFile: mutatedArtifactFiles.uiFile,
  opsReceiptFile: mutatedArtifactFiles.opsFile,
  artifact: mutatedArtifactFiles.artifactFile,
}), /UI artifact (?:byte count|digest) mismatch/u);

const wrongOps = clone(opsReceipt);
wrongOps.browser.servedHostClosureSha256 = digest("9");
const wrongOpsBase = makeInput(snapshot, uiReceipt, wrongOps);
const wrongOpsFiles = writeCase("wrong-ops-receipt", snapshot, wrongOpsBase.input, uiReceipt, wrongOps);
expectFailure("wrong OPS receipt semantics", runGate({
  workName: "wrong-ops-receipt",
  provider: wrongOpsFiles.providerFile,
  input: wrongOpsFiles.inputFile,
  uiReceiptFile: wrongOpsFiles.uiFile,
  opsReceiptFile: wrongOpsFiles.opsFile,
  artifact: wrongOpsFiles.artifactFile,
}), /OPS browser host closure mismatch/u);

const missingIssue = clone(snapshot);
delete missingIssue.issues.ui;
const missingIssueBase = makeInput(missingIssue);
const missingIssueFiles = writeCase("missing-issue", missingIssue, missingIssueBase.input);
expectFailure("missing target tuple", runGate({
  workName: "missing-issue",
  provider: missingIssueFiles.providerFile,
  input: missingIssueFiles.inputFile,
  uiReceiptFile: missingIssueFiles.uiFile,
  opsReceiptFile: missingIssueFiles.opsFile,
  artifact: missingIssueFiles.artifactFile,
}), /provider snapshot\.issues fields changed/u);

const extraSnapshot = clone(snapshot);
extraSnapshot.extra = true;
const extraBase = makeInput(extraSnapshot);
const extraFiles = writeCase("extra-provider-field", extraSnapshot, extraBase.input);
expectFailure("extra provider tuple", runGate({
  workName: "extra-provider-field",
  provider: extraFiles.providerFile,
  input: extraFiles.inputFile,
  uiReceiptFile: extraFiles.uiFile,
  opsReceiptFile: extraFiles.opsFile,
  artifact: extraFiles.artifactFile,
}), /provider snapshot fields changed/u);

const missingReview = clone(snapshot);
delete missingReview.reviews.ops.r;
const missingReviewBase = makeInput(missingReview);
const missingReviewFiles = writeCase("missing-review", missingReview, missingReviewBase.input);
expectFailure("missing review tuple", runGate({
  workName: "missing-review",
  provider: missingReviewFiles.providerFile,
  input: missingReviewFiles.inputFile,
  uiReceiptFile: missingReviewFiles.uiFile,
  opsReceiptFile: missingReviewFiles.opsFile,
  artifact: missingReviewFiles.artifactFile,
}), /provider snapshot\.reviews\.ops fields changed/u);

const missingCheck = clone(snapshot);
missingCheck.checks.ui.evidence = [];
const missingCheckBase = makeInput(missingCheck);
const missingCheckFiles = writeCase("missing-check", missingCheck, missingCheckBase.input);
expectFailure("missing check tuple", runGate({
  workName: "missing-check",
  provider: missingCheckFiles.providerFile,
  input: missingCheckFiles.inputFile,
  uiReceiptFile: missingCheckFiles.uiFile,
  opsReceiptFile: missingCheckFiles.opsFile,
  artifact: missingCheckFiles.artifactFile,
}), /evidence count mismatch/u);

const nonCanonicalFiles = writeCase("noncanonical-input", snapshot, base.input, uiReceipt, opsReceipt, artifactBytes, false);
expectFailure("canonical input mutation", runGate({
  workName: "noncanonical-input",
  provider: nonCanonicalFiles.providerFile,
  input: nonCanonicalFiles.inputFile,
  uiReceiptFile: nonCanonicalFiles.uiFile,
  opsReceiptFile: nonCanonicalFiles.opsFile,
  artifact: nonCanonicalFiles.artifactFile,
}), /gate input must use canonical JSON/u);

const merged = clone(snapshot);
merged.stage = "merged";
for (const [name, digit] of [["ui", "b"], ["ops", "c"]]) {
  const prValue = merged.pullRequests[name];
  prValue.state = "closed";
  prValue.merge = { state: "merged", commit: sha(digit), tree: sha(digit === "b" ? "d" : "e") };
  prValue.evaluated = { commit: prValue.merge.commit, tree: prValue.merge.tree };
  for (const row of merged.checks[name].evidence) {
    row.expectedHead = prValue.evaluated.commit;
    row.actualHead = prValue.evaluated.commit;
    row.expectedTree = prValue.evaluated.tree;
    row.actualTree = prValue.evaluated.tree;
  }
}
validateProviderSnapshot(merged);
const mergedInput = clone(base.input);
mergedInput.stage = "merged";
mergedInput.providerSnapshot.sha256 = sha256(Buffer.from(canonicalJson(merged)));
mergedInput.verifiers.gate.head = merged.pullRequests.ops.evaluated.commit;
mergedInput.verifiers.presentationSharedVisual.head = merged.pullRequests.ops.evaluated.commit;
validateGateInput(mergedInput);
validateInputAgainstSnapshot(mergedInput, merged);

const cli = parseCli([
  "--input", "/tmp/input.json",
  "--mobile-agent-root", "/tmp/mobile-agent",
  "--ops-consumer-receipt", "/tmp/ops.json",
  "--ops-root", "/tmp/ops",
  "--provider-snapshot", "/tmp/provider.json",
  "--ui-artifact", "/tmp/ui.tgz",
  "--ui-publication-receipt", "/tmp/ui.json",
  "--ui-root", "/tmp/ui",
  "--work-root", "/tmp/work",
]);
assert.equal(cli.providerSnapshot, "/tmp/provider.json");
assert.throws(() => parseCli([]), /missing CLI option/u);
assert.throws(() => assertExternalFreshWorkRoot("/tmp/ops/work", { ops: "/tmp/ops" }), /outside ops repository/u);

for (const source of [sourceVerifier, join(here, "..", "presentation-shared-visual", "verify.mjs")]) {
  const text = readFileSync(source, "utf8");
  assert.doesNotMatch(text, /\brmSync\b|rm\s+-rf|recursive\s*:\s*true/u, `${source} contains recursive cleanup`);
}

process.stdout.write(`${JSON.stringify({
  kind: "uiops.exactTreeSetContractSelftest.v2",
  gate: GATE_ID,
  inputSchema: INPUT_SCHEMA,
  providerSnapshotSchema: PROVIDER_SNAPSHOT_SCHEMA,
  uiReceiptSchema: UI_PUBLICATION_RECEIPT_SCHEMA,
  opsReceiptSchema: OPS_CONSUMER_RECEIPT_SCHEMA,
  receiptSchema: RECEIPT_SCHEMA,
  receiptBasename: RECEIPT_BASENAME,
  processCases: 13,
  stages: ["candidate", "merged"],
  status: "PASS",
})}\n`);
