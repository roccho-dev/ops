import assert from "node:assert/strict";
import { ASSETS, CONFIG, RELEASE } from "../src/assets.mjs";

assert.equal(CONFIG.schema, "ops.govReleaseProxyConfig/1");
assert.equal(CONFIG.authority, false);
assert.equal(CONFIG.privateUpstream, false);
assert.equal(RELEASE.repository, "roccho-dev/governance");
assert.match(RELEASE.targetCommit, /^[0-9a-f]{40}$/u);
assert.equal(Object.keys(ASSETS).length, 2);
for (const [route, asset] of Object.entries(ASSETS)) {
  assert.match(route, /^\/data\/[a-z-]+$/u);
  assert.ok(Number.isSafeInteger(asset.assetId) && asset.assetId > 0);
  assert.ok(Number.isSafeInteger(asset.bytes) && asset.bytes > 0);
  assert.match(asset.digest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(asset.contentType, /^application\/json/u);
}
console.log(JSON.stringify({ schema: "check-receipt/1", checkId: "ops.gov-release-proxy.config", status: "PASS", routes: Object.keys(ASSETS) }));
