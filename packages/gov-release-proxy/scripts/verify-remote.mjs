import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolveCurrentPayload } from "../src/worker.mjs";

const baseUrl = process.argv[2];
assert.ok(baseUrl, "base URL is required");
const expected = await resolveCurrentPayload({ env: process.env });
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
for (attempts = 1; attempts <= 15; attempts += 1) {
  response = await fetch(new URL("/", baseUrl), { headers, redirect: "manual" });
  if (!retryStatuses.has(response.status)) break;
  if (attempts < 15) await sleep(2000);
}
if (response.status >= 300 && response.status < 400 && !clientId) {
  console.log(JSON.stringify({
    schema: "ops.govReleaseProxyRemoteReceipt/4",
    status: "ACCESS_BLOCKED",
    anonymousStatus: response.status,
    authenticatedReadback: false,
    attempts,
  }));
  process.exit(0);
}
if (response.status !== 200) {
  const body = await response.text();
  throw new Error(`root data failed: status=${response.status} attempts=${attempts} body=${body.slice(0, 500)}`);
}
const bytes = Buffer.from(await response.arrayBuffer());
const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
assert.equal(bytes.byteLength, expected.bytes);
assert.equal(digest, expected.digest);
assert.deepEqual(bytes, Buffer.from(expected.body));
assert.equal(response.headers.get("x-gov-release-selector"), "latest");
assert.equal(response.headers.get("x-gov-release-locator"), expected.locator);
assert.equal(response.headers.get("x-gov-release-repository"), expected.repository);
assert.equal(response.headers.get("x-gov-release-id"), expected.releaseId);
assert.equal(response.headers.get("x-gov-release-tag"), expected.tag);
assert.equal(response.headers.get("x-gov-release-sequence"), String(expected.sequence));
assert.equal(response.headers.get("x-gov-release-manifest-digest"), expected.releaseDigest);
assert.equal(response.headers.get("x-gov-release-asset"), expected.name);
assert.equal(response.headers.get("x-gov-release-digest"), expected.digest);
assert.equal(response.headers.get("x-gov-release-semantic-digest"), expected.semanticDigest);
assert.equal(response.headers.get("x-gov-release-upstream-auth"), expected.credentialUsed ? "credential" : "anonymous");
assert.equal(response.headers.get("x-gov-release-commit"), expected.targetCommit);
assert.equal(response.headers.get("x-gov-release-numeric-id"), expected.releaseNumericId ? String(expected.releaseNumericId) : null);
assert.equal(response.headers.get("x-gov-release-asset-id"), expected.assetId ? String(expected.assetId) : null);
console.log(JSON.stringify({
  schema: "ops.govReleaseProxyRemoteReceipt/4",
  status: "PASS",
  endpoint: "/",
  source: expected.repository,
  locator: expected.locator,
  releaseId: expected.releaseId,
  releaseNumericId: expected.releaseNumericId,
  releaseTag: expected.tag,
  releaseSequence: expected.sequence,
  manifestDigest: expected.releaseDigest,
  assetId: expected.assetId,
  assetName: expected.name,
  semanticDigest: expected.semanticDigest,
  accessServiceToken: Boolean(clientId),
  authenticatedReadback: Boolean(clientId),
  upstreamCredentialUsed: expected.credentialUsed,
  attempts,
  bytes: bytes.byteLength,
  digest,
  runtimeFixture: false,
  fixedReleaseIdentity: false,
  authority: false,
  cutover: false,
}));
