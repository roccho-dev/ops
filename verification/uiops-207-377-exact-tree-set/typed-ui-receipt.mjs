import assert from "node:assert/strict";
import {
  UI_PUBLICATION_RECEIPT_SCHEMA,
  digest,
  exactKeys,
  httpsUrl,
  nonEmpty,
  object,
  positiveInteger,
  sha1,
} from "./contract-core.mjs";
import { findCheck } from "./provider-snapshot.mjs";

export function validateOwnerValidation(value, label, { repository, evaluated, snapshot, lane }) {
  const row = object(value, label);
  exactKeys(row, ["checkContext", "status", "validator"], label);
  assert.equal(row.status, "PASS", `${label}.status must be PASS`);
  nonEmpty(row.checkContext, `${label}.checkContext`);
  findCheck(snapshot, lane, row.checkContext);
  const validator = object(row.validator, `${label}.validator`);
  exactKeys(validator, ["blob", "head", "path", "repository"], `${label}.validator`);
  assert.equal(validator.repository, repository, `${label}.validator.repository mismatch`);
  assert.equal(validator.head, evaluated.commit, `${label}.validator.head mismatch`);
  nonEmpty(validator.path, `${label}.validator.path`);
  sha1(validator.blob, `${label}.validator.blob`);
  return row;
}

export function assertReceiptProducer(value, label, pr) {
  const producer = object(value, label);
  exactKeys(producer, ["evaluated", "pr", "repository", "terminal"], label);
  assert.equal(producer.repository, pr.repository, `${label}.repository mismatch`);
  assert.equal(producer.pr, pr.number, `${label}.pr mismatch`);
  assert.deepEqual(producer.terminal, pr.terminal, `${label}.terminal mismatch`);
  assert.deepEqual(producer.evaluated, pr.evaluated, `${label}.evaluated mismatch`);
  return producer;
}

export function validateUiPublicationReceipt(value, snapshot, input, receiptSha256) {
  const receipt = object(value, "UI publication receipt");
  exactKeys(receipt, ["contracts", "producer", "publication", "schema", "status", "validation"], "UI publication receipt");
  assert.equal(receipt.schema, UI_PUBLICATION_RECEIPT_SCHEMA, "UI publication receipt schema mismatch");
  assert.equal(receipt.status, "PASS", "UI publication receipt status must be PASS");
  const uiPr = snapshot.pullRequests.ui;
  assertReceiptProducer(receipt.producer, "UI publication receipt.producer", uiPr);

  const contracts = object(receipt.contracts, "UI publication receipt.contracts");
  exactKeys(contracts, ["adapter", "corePort"], "UI publication receipt.contracts");
  assert.equal(contracts.corePort, input.contracts.corePort, "UI core-port contract mismatch");
  assert.equal(contracts.adapter, input.contracts.adapter, "UI adapter contract mismatch");

  const publication = object(receipt.publication, "UI publication receipt.publication");
  exactKeys(publication, ["archive", "hostClosure", "locator", "manifest"], "UI publication receipt.publication");
  const locator = object(publication.locator, "UI publication receipt.publication.locator");
  exactKeys(locator, ["immutable", "kind", "url"], "UI publication receipt.publication.locator");
  assert.equal(locator.immutable, true, "UI publication locator must be immutable");
  nonEmpty(locator.kind, "UI publication receipt.publication.locator.kind");
  httpsUrl(locator.url, "UI publication receipt.publication.locator.url");
  const archive = object(publication.archive, "UI publication receipt.publication.archive");
  exactKeys(archive, ["bytes", "name", "sha256"], "UI publication receipt.publication.archive");
  nonEmpty(archive.name, "UI publication receipt.publication.archive.name");
  positiveInteger(archive.bytes, "UI publication receipt.publication.archive.bytes");
  digest(archive.sha256, "UI publication receipt.publication.archive.sha256");
  for (const name of ["manifest", "hostClosure"]) {
    const item = object(publication[name], `UI publication receipt.publication.${name}`);
    exactKeys(item, ["sha256"], `UI publication receipt.publication.${name}`);
    digest(item.sha256, `UI publication receipt.publication.${name}.sha256`);
  }

  const ownerCheck = validateOwnerValidation(receipt.validation, "UI publication receipt.validation", {
    repository: "roccho-dev/ui",
    evaluated: uiPr.evaluated,
    snapshot,
    lane: "ui",
  });
  assert.equal(
    findCheck(snapshot, "ui", ownerCheck.checkContext).evidenceSha256,
    receiptSha256,
    "UI owner check evidence digest mismatch",
  );
  return receipt;
}

