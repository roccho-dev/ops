import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PUBLIC_ASSETS } from "../src/assets.mjs";

const baseUrl = process.argv[2];
assert.ok(baseUrl, "base URL is required");
const clientId = process.env.CF_ACCESS_CLIENT_ID ?? "";
const clientSecret = process.env.CF_ACCESS_CLIENT_SECRET ?? "";
const accessHeaders = clientId && clientSecret ? {
  "CF-Access-Client-Id": clientId,
  "CF-Access-Client-Secret": clientSecret,
} : {};
const retryStatuses = new Set([404, 429, 500, 502, 503, 504]);
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const fetchReadback = async pathname => {
  let lastResponse = null;
  let lastError = null;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const response = await fetch(new URL(pathname, baseUrl), { headers: accessHeaders, redirect: "manual" });
      lastResponse = response;
      if (!retryStatuses.has(response.status)) return { response, attempts: attempt };
    } catch (error) {
      lastError = error;
    }
    if (attempt < 30) await sleep(2000);
  }
  if (lastResponse) return { response: lastResponse, attempts: 30 };
  throw lastError ?? new Error(`${pathname}: no response`);
};

const healthReadback = await fetchReadback("/health");
const health = healthReadback.response;
if (health.status >= 300 && health.status < 400 && !clientId) {
  console.log(JSON.stringify({
    schema: "ops.govReleaseProxyRemoteReceipt/1",
    status: "ACCESS_BLOCKED",
    anonymousStatus: health.status,
    authenticatedReadback: false,
    healthAttempts: healthReadback.attempts,
  }));
  process.exit(0);
}
assert.equal(health.status, 200, `health: ${health.status} after ${healthReadback.attempts} attempts`);
const healthValue = await health.json();
assert.equal(healthValue.status, "PASS");

const results = [];
for (const [route, asset] of Object.entries(PUBLIC_ASSETS)) {
  const readback = await fetchReadback(route);
  const response = readback.response;
  assert.equal(response.status, 200, `${route}: ${response.status} after ${readback.attempts} attempts`);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.byteLength, asset.bytes);
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  assert.equal(digest, asset.digest);
  assert.equal(response.headers.get("x-gov-release-digest"), asset.digest);
  results.push({ route, bytes: bytes.byteLength, digest, attempts: readback.attempts });
}
console.log(JSON.stringify({
  schema: "ops.govReleaseProxyRemoteReceipt/1",
  status: "PASS",
  accessServiceToken: Boolean(clientId),
  authenticatedReadback: Boolean(clientId),
  healthAttempts: healthReadback.attempts,
  results,
}));
