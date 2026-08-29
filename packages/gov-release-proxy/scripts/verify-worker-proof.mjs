import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PRIVATE_FIXTURE_ASSETS, PUBLIC_ASSETS } from "../src/assets.mjs";

const baseUrl = process.argv[2];
assert.ok(baseUrl, "base URL is required");
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const fetchRetry = async pathname => {
  let response;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    response = await fetch(new URL(pathname, baseUrl), { redirect: "manual" });
    if (![404, 429, 500, 502, 503, 504].includes(response.status)) return { response, attempt };
    if (attempt < 30) await sleep(2000);
  }
  return { response, attempt: 30 };
};
const healthReadback = await fetchRetry("/health");
assert.equal(healthReadback.response.status, 200);
const health = await healthReadback.response.json();
assert.equal(health.status, "PASS");
assert.equal(health.githubCredentialConfigured, true);
assert.equal(health.githubAuthRequired, true);
assert.equal(health.privateFixtureEnabled, true);

const results = [];
for (const [route, asset] of Object.entries({ ...PUBLIC_ASSETS, ...PRIVATE_FIXTURE_ASSETS })) {
  const readback = await fetchRetry(route);
  assert.equal(readback.response.status, 200, `${route}: ${readback.response.status}`);
  const bytes = Buffer.from(await readback.response.arrayBuffer());
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  assert.equal(bytes.byteLength, asset.bytes);
  assert.equal(digest, asset.digest);
  assert.equal(readback.response.headers.get("x-gov-release-upstream-auth"), "credential");
  assert.equal(readback.response.headers.get("x-gov-release-repository"), asset.repository);
  results.push({ route, repository: asset.repository, visibility: asset.visibility, bytes: bytes.length, digest, attempts: readback.attempt });
}
console.log(JSON.stringify({
  schema: "ops.govReleaseCredentialWorkerReceipt/1",
  status: "PASS",
  sameWorker: true,
  githubCredentialUsedForPublic: true,
  githubCredentialUsedForPrivate: true,
  results,
  authority: false,
  cutover: false,
}));
