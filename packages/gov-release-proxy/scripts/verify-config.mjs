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

assert.equal(PUBLIC_RELEASE.sourceKind, "git-raw");
assert.equal(PUBLIC_RELEASE.repository, "roccho-dev/governance");
assert.equal(PUBLIC_RELEASE.visibility, "public");
assert.match(PUBLIC_RELEASE.targetCommit, /^[0-9a-f]{40}$/u);
assert.equal(PUBLIC_ROOT_ASSET.requiresCredential, false);
assert.equal(PUBLIC_ROOT_ASSET.assetId, null);
assert.equal(PUBLIC_ROOT_ASSET.releaseId, null);
assert.equal(PUBLIC_ROOT_ASSET.path, "docs/final-scope-purpose-join/selected-universe.jsonl");
assert.match(
  PUBLIC_ROOT_ASSET.downloadUrl,
  /^https:\/\/raw\.githubusercontent\.com\/roccho-dev\/governance\/[0-9a-f]{40}\/docs\/final-scope-purpose-join\/selected-universe\.jsonl$/u,
);

assert.equal(PRIVATE_FIXTURE_RELEASE.sourceKind, "github-release-asset");
assert.equal(PRIVATE_FIXTURE_RELEASE.repository, "roccho-dev/adrs");
assert.equal(PRIVATE_FIXTURE_RELEASE.visibility, "private");
assert.equal(PRIVATE_FIXTURE_ROOT_ASSET.requiresCredential, true);
assert.equal(PRIVATE_FIXTURE_ROOT_ASSET.downloadUrl, null);
assert.ok(Number.isSafeInteger(PRIVATE_FIXTURE_ROOT_ASSET.releaseId) && PRIVATE_FIXTURE_ROOT_ASSET.releaseId > 0);
assert.ok(Number.isSafeInteger(PRIVATE_FIXTURE_ROOT_ASSET.assetId) && PRIVATE_FIXTURE_ROOT_ASSET.assetId > 0);

for (const asset of [PUBLIC_ROOT_ASSET, PRIVATE_FIXTURE_ROOT_ASSET]) {
  assert.match(asset.repository, /^[^/]+\/[^/]+$/u);
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
  publicUpstream: "exact-git-raw",
  privateUpstream: "authenticated-release-asset-api",
  publicAsset: PUBLIC_ROOT_ASSET.name,
  privateFixtureAsset: PRIVATE_FIXTURE_ROOT_ASSET.name,
}));
