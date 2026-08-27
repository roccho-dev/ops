import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ASSETS } from "../src/assets.mjs";

const baseUrl = process.argv[2];
assert.ok(baseUrl, "base URL is required");
const clientId = process.env.CF_ACCESS_CLIENT_ID ?? "";
const clientSecret = process.env.CF_ACCESS_CLIENT_SECRET ?? "";
const accessHeaders = clientId && clientSecret ? {
  "CF-Access-Client-Id": clientId,
  "CF-Access-Client-Secret": clientSecret,
} : {};

const health = await fetch(new URL("/health", baseUrl), { headers: accessHeaders, redirect: "manual" });
if (health.status >= 300 && health.status < 400 && !clientId) {
  console.log(JSON.stringify({ schema: "ops.govReleaseProxyRemoteReceipt/1", status: "ACCESS_BLOCKED", anonymousStatus: health.status, authenticatedReadback: false }));
  process.exit(0);
}
assert.equal(health.status, 200);
const healthValue = await health.json();
assert.equal(healthValue.status, "PASS");

const results = [];
for (const [route, asset] of Object.entries(ASSETS)) {
  const response = await fetch(new URL(route, baseUrl), { headers: accessHeaders, redirect: "manual" });
  assert.equal(response.status, 200, `${route}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.byteLength, asset.bytes);
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  assert.equal(digest, asset.digest);
  assert.equal(response.headers.get("x-gov-release-digest"), asset.digest);
  results.push({ route, bytes: bytes.byteLength, digest });
}
console.log(JSON.stringify({
  schema: "ops.govReleaseProxyRemoteReceipt/1",
  status: "PASS",
  accessServiceToken: Boolean(clientId),
  authenticatedReadback: Boolean(clientId),
  results,
}));
