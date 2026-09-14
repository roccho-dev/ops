import assert from "node:assert/strict";
import {
  OPS_CONSUMER_RECEIPT_SCHEMA,
  digest,
  exactKeys,
  nonEmpty,
  object,
} from "./contract-core.mjs";
import { findCheck } from "./provider-snapshot.mjs";
import { assertReceiptProducer, validateOwnerValidation } from "./typed-ui-receipt.mjs";

export function validateOpsConsumerReceipt(value, snapshot, input, uiReceipt, uiReceiptSha256, opsReceiptSha256) {
  const receipt = object(value, "OPS consumer receipt");
  exactKeys(receipt, [
    "assembly",
    "browser",
    "consumedUi",
    "consumer",
    "contracts",
    "lock",
    "packageCheck",
    "schema",
    "status",
    "validation",
  ], "OPS consumer receipt");
  assert.equal(receipt.schema, OPS_CONSUMER_RECEIPT_SCHEMA, "OPS consumer receipt schema mismatch");
  assert.equal(receipt.status, "PASS", "OPS consumer receipt status must be PASS");
  const opsPr = snapshot.pullRequests.ops;
  assertReceiptProducer(receipt.consumer, "OPS consumer receipt.consumer", opsPr);

  const contracts = object(receipt.contracts, "OPS consumer receipt.contracts");
  exactKeys(contracts, ["policyApp"], "OPS consumer receipt.contracts");
  assert.equal(contracts.policyApp, input.contracts.policyApp, "OPS policy-app contract mismatch");

  const consumedUi = object(receipt.consumedUi, "OPS consumer receipt.consumedUi");
  exactKeys(consumedUi, [
    "adapterContract",
    "archiveSha256",
    "corePortContract",
    "producerEvaluatedCommit",
    "producerEvaluatedTree",
    "publicationReceiptSha256",
  ], "OPS consumer receipt.consumedUi");
  assert.equal(consumedUi.publicationReceiptSha256, uiReceiptSha256, "OPS consumed UI receipt digest mismatch");
  assert.equal(consumedUi.archiveSha256, uiReceipt.publication.archive.sha256, "OPS consumed UI archive digest mismatch");
  assert.equal(consumedUi.producerEvaluatedCommit, uiReceipt.producer.evaluated.commit, "OPS consumed UI producer commit mismatch");
  assert.equal(consumedUi.producerEvaluatedTree, uiReceipt.producer.evaluated.tree, "OPS consumed UI producer tree mismatch");
  assert.equal(consumedUi.corePortContract, input.contracts.corePort, "OPS consumed UI core-port mismatch");
  assert.equal(consumedUi.adapterContract, input.contracts.adapter, "OPS consumed UI adapter mismatch");

  const lock = object(receipt.lock, "OPS consumer receipt.lock");
  exactKeys(lock, ["archiveSha256", "locator", "path", "rowSha256", "rows"], "OPS consumer receipt.lock");
  nonEmpty(lock.path, "OPS consumer receipt.lock.path");
  assert.equal(lock.rows, 1, "OPS lock must contain exactly one row");
  digest(lock.rowSha256, "OPS consumer receipt.lock.rowSha256");
  assert.equal(lock.archiveSha256, uiReceipt.publication.archive.sha256, "OPS lock archive digest mismatch");
  assert.deepEqual(lock.locator, uiReceipt.publication.locator, "OPS lock locator mismatch");

  const assembly = object(receipt.assembly, "OPS consumer receipt.assembly");
  exactKeys(assembly, ["hostClosureSha256", "outputTreeSha256", "receiptSha256"], "OPS consumer receipt.assembly");
  digest(assembly.receiptSha256, "OPS consumer receipt.assembly.receiptSha256");
  digest(assembly.outputTreeSha256, "OPS consumer receipt.assembly.outputTreeSha256");
  digest(assembly.hostClosureSha256, "OPS consumer receipt.assembly.hostClosureSha256");
  assert.equal(assembly.hostClosureSha256, uiReceipt.publication.hostClosure.sha256, "assembled host closure differs from UI publication");

  const packageCheck = object(receipt.packageCheck, "OPS consumer receipt.packageCheck");
  exactKeys(packageCheck, [
    "checkAttr",
    "checkDrvPath",
    "packageAttr",
    "packageDrvPath",
    "sameDerivation",
    "system",
  ], "OPS consumer receipt.packageCheck");
  nonEmpty(packageCheck.system, "OPS consumer receipt.packageCheck.system");
  nonEmpty(packageCheck.packageAttr, "OPS consumer receipt.packageCheck.packageAttr");
  nonEmpty(packageCheck.checkAttr, "OPS consumer receipt.packageCheck.checkAttr");
  nonEmpty(packageCheck.packageDrvPath, "OPS consumer receipt.packageCheck.packageDrvPath");
  nonEmpty(packageCheck.checkDrvPath, "OPS consumer receipt.packageCheck.checkDrvPath");
  assert.equal(packageCheck.sameDerivation, true, "OPS package/check must be the same derivation");
  assert.equal(packageCheck.packageDrvPath, packageCheck.checkDrvPath, "OPS package/check drvPath mismatch");

  const browser = object(receipt.browser, "OPS consumer receipt.browser");
  exactKeys(browser, [
    "forbiddenPaths404",
    "receiptSha256",
    "servedHostClosureSha256",
    "sourceFallbackUsed",
    "status",
  ], "OPS consumer receipt.browser");
  assert.equal(browser.status, "PASS", "OPS browser receipt status must be PASS");
  digest(browser.receiptSha256, "OPS consumer receipt.browser.receiptSha256");
  digest(browser.servedHostClosureSha256, "OPS consumer receipt.browser.servedHostClosureSha256");
  assert.equal(browser.sourceFallbackUsed, false, "OPS browser proof used a source fallback");
  assert.equal(browser.forbiddenPaths404, true, "OPS browser proof did not reject forbidden paths");
  assert.equal(browser.servedHostClosureSha256, assembly.hostClosureSha256, "OPS browser host closure mismatch");

  const ownerCheck = validateOwnerValidation(receipt.validation, "OPS consumer receipt.validation", {
    repository: "roccho-dev/ops",
    evaluated: opsPr.evaluated,
    snapshot,
    lane: "ops",
  });
  assert.equal(
    findCheck(snapshot, "ops", ownerCheck.checkContext).evidenceSha256,
    opsReceiptSha256,
    "OPS owner check evidence digest mismatch",
  );
  return receipt;
}

