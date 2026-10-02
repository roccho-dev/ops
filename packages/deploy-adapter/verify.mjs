#!/usr/bin/env node
import fs from "node:fs";

const SCHEMA = "ops.deploy-effect.receipt/1";
const TARGETS = new Set(["preview", "production"]);

function fail(message) {
  throw new Error(message);
}

export function loadOne(text) {
  const lines = text.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  if (lines.length !== 1) fail("receipt must contain exactly one non-empty JSON line");
  let value;
  try {
    value = JSON.parse(lines[0]);
  } catch (error) {
    fail(`invalid JSON receipt: ${error.message}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("receipt must be an object");
  }
  return value;
}

export function verifyReceipt(receipt) {
  const required = [
    "schema", "authority", "status", "provider", "target",
    "sourceRevision", "deploymentUrl", "probe",
  ];
  const missing = required.filter((key) => !(key in receipt));
  if (missing.length) fail(`missing fields: ${missing.sort().join(",")}`);
  if (receipt.schema !== SCHEMA) fail("unexpected schema");
  if (receipt.authority !== false) fail("deployment receipt must be non-authority");
  if (receipt.status !== "PASS") fail("success receipt must be PASS");
  if (!TARGETS.has(receipt.target)) fail("target must be preview or production");

  for (const key of ["provider", "sourceRevision"]) {
    if (typeof receipt[key] !== "string" || !receipt[key].trim()) {
      fail(`${key} must be a non-empty string`);
    }
  }

  let url;
  try {
    url = new URL(receipt.deploymentUrl);
  } catch {
    fail("deploymentUrl must be an https URL");
  }
  if (url.protocol !== "https:" || !url.host) fail("deploymentUrl must be an https URL");

  const probe = receipt.probe;
  if (!probe || typeof probe !== "object" || Array.isArray(probe)) fail("probe must be an object");
  if (typeof probe.path !== "string" || !probe.path.startsWith("/")) {
    fail("probe.path must begin with /");
  }
  if (!Number.isInteger(probe.status) || probe.status < 200 || probe.status > 299) {
    fail("probe.status must be 2xx");
  }
  return receipt;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length > 1) fail("usage: verify.mjs [receipt.jsonl]");
  const text = args.length ? fs.readFileSync(args[0], "utf8") : fs.readFileSync(0, "utf8");
  verifyReceipt(loadOne(text));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
