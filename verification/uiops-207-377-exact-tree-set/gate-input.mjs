import assert from "node:assert/strict";
import {
  GATE_ID,
  INPUT_SCHEMA,
  OPS_CONSUMER_RECEIPT_SCHEMA,
  PROVIDER_SNAPSHOT_SCHEMA,
  UI_PUBLICATION_RECEIPT_SCHEMA,
  digest,
  exactKeys,
  nonEmpty,
  object,
  sha1,
} from "./contract-core.mjs";

function validateVerifier(value, label, expectedPath) {
  const row = object(value, label);
  exactKeys(row, ["blob", "head", "path", "repository"], label);
  assert.equal(row.repository, "roccho-dev/ops", `${label}.repository mismatch`);
  assert.equal(row.path, expectedPath, `${label}.path mismatch`);
  sha1(row.head, `${label}.head`);
  sha1(row.blob, `${label}.blob`);
  return row;
}

export function validateGateInput(value) {
  const input = object(value, "gate input");
  exactKeys(input, [
    "authority",
    "contracts",
    "files",
    "gate",
    "providerSnapshot",
    "schema",
    "stage",
    "verifiers",
  ], "gate input");
  assert.equal(input.schema, INPUT_SCHEMA, "gate input schema mismatch");
  assert.equal(input.authority, false, "gate input must not claim authority");
  assert.equal(input.gate, GATE_ID, "gate id mismatch");
  assert(["candidate", "merged"].includes(input.stage), "gate input stage changed");

  const provider = object(input.providerSnapshot, "gate input.providerSnapshot");
  exactKeys(provider, ["schema", "sha256"], "gate input.providerSnapshot");
  assert.equal(provider.schema, PROVIDER_SNAPSHOT_SCHEMA, "provider snapshot schema mismatch");
  digest(provider.sha256, "gate input.providerSnapshot.sha256");

  const contracts = object(input.contracts, "gate input.contracts");
  exactKeys(contracts, [
    "adapter",
    "corePort",
    "opsConsumerReceipt",
    "policyApp",
    "uiPublicationReceipt",
  ], "gate input.contracts");
  assert.equal(contracts.uiPublicationReceipt, UI_PUBLICATION_RECEIPT_SCHEMA, "UI receipt schema mismatch");
  assert.equal(contracts.opsConsumerReceipt, OPS_CONSUMER_RECEIPT_SCHEMA, "OPS receipt schema mismatch");
  nonEmpty(contracts.corePort, "gate input.contracts.corePort");
  nonEmpty(contracts.adapter, "gate input.contracts.adapter");
  nonEmpty(contracts.policyApp, "gate input.contracts.policyApp");

  const files = object(input.files, "gate input.files");
  exactKeys(files, ["opsConsumerReceiptSha256", "uiPublicationReceiptSha256"], "gate input.files");
  digest(files.uiPublicationReceiptSha256, "gate input.files.uiPublicationReceiptSha256");
  digest(files.opsConsumerReceiptSha256, "gate input.files.opsConsumerReceiptSha256");

  const verifiers = object(input.verifiers, "gate input.verifiers");
  exactKeys(verifiers, ["gate", "presentationSharedVisual"], "gate input.verifiers");
  validateVerifier(verifiers.gate, "gate input.verifiers.gate", "verification/uiops-207-377-exact-tree-set/verify.mjs");
  validateVerifier(verifiers.presentationSharedVisual, "gate input.verifiers.presentationSharedVisual", "verification/presentation-shared-visual/verify.mjs");
  return input;
}


export function validateInputAgainstSnapshot(input, snapshot) {
  assert.equal(input.stage, snapshot.stage, "input/provider stage mismatch");
  assert.equal(input.providerSnapshot.schema, snapshot.schema, "input/provider schema mismatch");
  const opsHead = snapshot.pullRequests.ops.evaluated.commit;
  assert.equal(input.verifiers.gate.head, opsHead, "gate verifier head must equal evaluated OPS commit");
  assert.equal(input.verifiers.presentationSharedVisual.head, opsHead, "presentation verifier head must equal evaluated OPS commit");
}

