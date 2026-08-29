import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PUBLIC_ROOT_ASSET } from "../src/assets.mjs";

const baseUrl = process.argv[2];
assert.ok(baseUrl, "base URL is required");
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
    schema: "ops.govReleaseProxyRemoteReceipt/2",
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
assert.equal(bytes.byteLength, PUBLIC_ROOT_ASSET.bytes);
assert.equal(digest, PUBLIC_ROOT_ASSET.digest);
assert.equal(response.headers.get("x-gov-release-digest"), PUBLIC_ROOT_ASSET.digest);
assert.match(response.headers.get("content-type") ?? "", /^application\/json/u);
console.log(JSON.stringify({
  schema: "ops.govReleaseProxyRemoteReceipt/2",
  status: "PASS",
  endpoint: "/",
  accessServiceToken: Boolean(clientId),
  authenticatedReadback: Boolean(clientId),
  attempts,
  bytes: bytes.byteLength,
  digest,
}));
