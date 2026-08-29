import assert from "node:assert/strict";
import {
  CONFIG,
  PRIVATE_FIXTURE_ROOT_ASSET,
  PRIVATE_FIXTURE_RELEASE,
  PUBLIC_RELEASE,
  PUBLIC_ROOT_ASSET,
  configFor,
} from "../src/assets.mjs";

assert.equal(CONFIG.schema, "ops.govReleaseProxyConfig/3");
assert.equal(CONFIG.authority, false);
assert.equal(CONFIG.deliveryModel, "one-root");
assert.equal(CONFIG.endpoint, "/");
assert.equal(CONFIG.browserDirectGitHubFetch, false);
assert.equal(PUBLIC_RELEASE.repository, "roccho-dev/governance");
assert.equal(PUBLIC_RELEASE.visibility, "public");
assert.equal(PRIVATE_FIXTURE_RELEASE.repository, "roccho-dev/adrs");
assert.equal(PRIVATE_FIXTURE_RELEASE.visibility, "private");
assert.equal(PUBLIC_ROOT_ASSET.requiresCredential, false);
assert.equal(PRIVATE_FIXTURE_ROOT_ASSET.requiresCredential, true);
assert.match(
  PUBLIC_ROOT_ASSET.downloadUrl,
  /^https:\/\/github\.com\/roccho-dev\/governance\/releases\/download\//u,
);
assert.equal(PRIVATE_FIXTURE_ROOT_ASSET.downloadUrl, null);

for (const asset of [PUBLIC_ROOT_ASSET, PRIVATE_FIXTURE_ROOT_ASSET]) {
  assert.match(asset.repository, /^[^/]+\/[^/]+$/u);
  assert.ok(Number.isSafeInteger(asset.releaseId) && asset.releaseId > 0);
  assert.ok(Number.isSafeInteger(asset.assetId) && asset.assetId > 0);
  assert.ok(Number.isSafeInteger(asset.bytes) && asset.bytes > 0);
  assert.match(asset.digest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(asset.contentType, /^application\/(json|x-ndjson)/u);
  assert.equal(asset.requiresCredential, asset.visibility === "private");
}

assert.equal(configFor().asset, PUBLIC_ROOT_ASSET);
assert.equal(configFor({ privateFixtureEnabled: true }).asset, PRIVATE_FIXTURE_ROOT_ASSET);
console.log(JSON.stringify({
  schema: "check-receipt/1",
  checkId: "ops.gov-release-proxy.config",
  status: "PASS",
  endpoint: "/",
  publicUpstream: "immutable-release-download",
  privateUpstream: "authenticated-release-asset-api",
  publicAsset: PUBLIC_ROOT_ASSET.name,
  privateFixtureAsset: PRIVATE_FIXTURE_ROOT_ASSET.name,
}));
