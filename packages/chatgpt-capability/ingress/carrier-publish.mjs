#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const fail = (message) => { throw new Error(message); };
const hex = (value, name) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
  ? value
  : fail(`${name} must be lowercase sha256`);

function args(values, required) {
  const result = {};
  while (values.length) {
    const key = values.shift();
    const value = values.shift();
    if (!required.includes(key) || !value || result[key]) fail("invalid options");
    result[key] = value;
  }
  if (required.some((key) => !result[key])) fail("missing options");
  return result;
}

function expected(payload, expectedSha) {
  const actual = sha256(payload);
  if (actual !== expectedSha) fail(`payload sha256 mismatch: ${actual}`);
}

function canonicalCarrier(payload) {
  const carrier = Buffer.from(payload.toString("base64"), "ascii");
  if (/\s/u.test(carrier.toString("ascii"))) fail("carrier contains whitespace");
  if (!Buffer.from(carrier.toString("ascii"), "base64").equals(payload)) fail("carrier round-trip mismatch");
  return carrier;
}

function receipt(payload, carrier) {
  return {
    schema: "carrier-publish-prepare/1",
    status: "PASS",
    codec: "standard-base64",
    payload: { bytes: payload.length, sha256: sha256(payload) },
    carrier: { bytes: carrier.length, sha256: sha256(carrier) },
  };
}

function prepare(options) {
  const payload = fs.readFileSync(options["--payload"]);
  const payloadSha = hex(options["--payload-sha256"], "payload-sha256");
  expected(payload, payloadSha);
  const carrier = canonicalCarrier(payload);
  fs.writeFileSync(options["--carrier"], carrier);
  fs.writeFileSync(options["--receipt"], json(receipt(payload, carrier)));
  return receipt(payload, carrier);
}

function verify(options) {
  const payload = fs.readFileSync(options["--payload"]);
  const carrier = fs.readFileSync(options["--carrier"]);
  const payloadSha = hex(options["--payload-sha256"], "payload-sha256");
  expected(payload, payloadSha);
  if (!carrier.equals(canonicalCarrier(payload))) fail("carrier mismatch");
  const observed = receipt(payload, carrier);
  const stored = JSON.parse(fs.readFileSync(options["--receipt"], "utf8"));
  if (json(stored) !== json(observed)) fail("receipt mismatch");
  return observed;
}

function selftest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "carrier-publish-"));
  try {
    const payload = Buffer.from("PASS\n");
    const payloadPath = path.join(root, "payload.bin");
    const carrierPath = path.join(root, "carrier.b64.txt");
    const receiptPath = path.join(root, "receipt.json");
    fs.writeFileSync(payloadPath, payload);
    const options = {
      "--payload": payloadPath,
      "--payload-sha256": sha256(payload),
      "--carrier": carrierPath,
      "--receipt": receiptPath,
    };
    prepare(options);
    verify(options);
    fs.appendFileSync(carrierPath, "\n");
    try { verify(options); fail("expected carrier mismatch"); } catch (error) {
      if (!/carrier/.test(error.message)) throw error;
    }
    return { schema: "carrier-publish-selftest/1", status: "PASS" };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function main() {
  const [command, ...values] = process.argv.slice(2);
  if (!command || command === "selftest") return selftest();
  const required = ["--payload", "--payload-sha256", "--carrier", "--receipt"];
  const options = args(values, required);
  if (command === "prepare") return prepare(options);
  if (command === "verify") return verify(options);
  fail("usage: carrier-publish.mjs selftest | prepare|verify --payload FILE --payload-sha256 SHA --carrier FILE --receipt FILE");
}

try {
  console.log(JSON.stringify(main()));
} catch (error) {
  console.error(`carrier-publish: ${error.message}`);
  process.exit(1);
}
