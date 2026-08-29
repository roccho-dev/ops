import assert from "node:assert/strict";
import {
  CONFIG,
  PRIVATE_FIXTURE_ASSETS,
  PRIVATE_FIXTURE_RELEASE,
  PUBLIC_ASSETS,
  PUBLIC_RELEASE,
  configFor,
} from "../src/assets.mjs";

assert.equal(CONFIG.schema, "ops.govReleaseProxyConfig/2");
assert.equal(CONFIG.authority, false);
assert.equal(CONFIG.deliveryModel, "always-worker");
assert.equal(CONFIG.browserDirectGitHubFetch, false);
assert.equal(PUBLIC_RELEASE.repository, "roccho-dev/governance");
assert.equal(PUBLIC_RELEASE.visibility, "public");
assert.equal(PRIVATE_FIXTURE_RELEASE.repository, "roccho-dev/adrs");
assert.equal(PRIVATE_FIXTURE_RELEASE.visibility, "private");
assert.equal(Object.keys(PUBLIC_ASSETS).length, 2);
assert.equal(Object.keys(PRIVATE_FIXTURE_ASSETS).length, 2);

for (const [route, asset] of Object.entries({ ...PUBLIC_ASSETS, ...PRIVATE_FIXTURE_ASSETS })) {
  assert.match(route, /^\/(data|proof\/private)\/[a-z-]+$/u);
  assert.match(asset.repository, /^[^/]+\/[^/]+$/u);
  assert.ok(Number.isSafeInteger(asset.releaseId) && asset.releaseId > 0);
  assert.ok(Number.isSafeInteger(asset.assetId) && asset.assetId > 0);
  assert.ok(Number.isSafeInteger(asset.bytes) && asset.bytes > 0);
  assert.match(asset.digest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(asset.contentType, /^application\/(json|x-ndjson)/u);
  assert.equal(asset.requiresCredential, asset.visibility === "private");
}

assert.equal(configFor().routes.length, 2);
assert.equal(configFor({ privateFixtureEnabled: true }).routes.length, 4);
console.log(JSON.stringify({
  schema: "check-receipt/1",
  checkId: "ops.gov-release-proxy.config",
  status: "PASS",
  publicRoutes: Object.keys(PUBLIC_ASSETS),
  privateFixtureRoutes: Object.keys(PRIVATE_FIXTURE_ASSETS),
}));
