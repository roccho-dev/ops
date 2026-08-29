import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolveCurrentAsset } from "../src/worker.mjs";

const baseUrl = process.argv[2];
assert.ok(baseUrl, "base URL is required");
const expected = await resolveCurrentAsset({ env: process.env });
const clientId = process.env.CF_ACCESS_CLIENT_ID ?? "";
const clientSecret = process.env.CF_ACCESS_CLIENT_SECRET ?? "";
const headers = {
  accept: "application/x-ndjson, application/json;q=0.9",
  ...(clientId && clientSecret ? {
    "CF-Access-Client-Id": clientId,
    "CF-Access-Client-Secret": clientSecret,
  } : {}),
};
const retryStatuses = new Set([404, 429, 500, 502, 503, 504]);
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
let response;
let attempts = 0;
for (attempts = 1; attempts <= 30; attempts += 1) {
  response = await fetch(new URL("/", baseUrl), { headers, redirect: "manual" });
  if (!retryStatuses.has(response.status)) break;
  if (attempts < 30) await sleep(2000);
}
if (response.status >= 300 && response.status < 400 && !clientId) {
  console.log(JSON.stringify({
    schema: "ops.govReleaseProxyRemoteReceipt/3",
    status: "ACCESS_BLOCKED",
    anonymousStatus: response.status,
    authenticatedReadback: false,
    attempts,
  }));
  process.exit(0);
}
assert.equal(response.status, 200, `root data: ${response.status} after ${attempts} attempts`);
const bytes = Buffer.from(await response.arrayBuffer());
const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
assert.equal(bytes.byteLength, expected.bytes);
assert.equal(digest, expected.digest);
assert.equal(response.headers.get("x-gov-release-selector"), "latest");
assert.equal(response.headers.get("x-gov-release-repository"), expected.repository);
assert.equal(response.headers.get("x-gov-release-id"), expected.releaseId);
assert.equal(response.headers.get("x-gov-release-numeric-id"), String(expected.releaseNumericId));
assert.equal(response.headers.get("x-gov-release-tag"), expected.tag);
assert.equal(response.headers.get("x-gov-release-commit"), expected.targetCommit);
assert.equal(response.headers.get("x-gov-release-asset"), expected.name);
assert.equal(response.headers.get("x-gov-release-asset-id"), String(expected.assetId));
assert.equal(response.headers.get("x-gov-release-digest"), expected.digest);
assert.equal(response.headers.get("x-gov-release-upstream-auth"), expected.credentialUsed ? "credential" : "anonymous");
console.log(JSON.stringify({
  schema: "ops.govReleaseProxyRemoteReceipt/3",
  status: "PASS",
  endpoint: "/",
  source: expected.repository,
  releaseId: expected.releaseId,
  releaseNumericId: expected.releaseNumericId,
  releaseTag: expected.tag,
  assetId: expected.assetId,
  assetName: expected.name,
  accessServiceToken: Boolean(clientId),
  authenticatedReadback: Boolean(clientId),
  upstreamCredentialUsed: expected.credentialUsed,
  attempts,
  bytes: bytes.byteLength,
  digest,
  authority: false,
  cutover: false,
}));
