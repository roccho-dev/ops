import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG, SOURCE } from "../src/assets.mjs";

assert.equal(CONFIG.schema, "ops.govReleaseProxyConfig/4");
assert.equal(CONFIG.authority, false);
assert.equal(CONFIG.endpoint, "/");
assert.equal(CONFIG.deliveryModel, "one-root");
assert.equal(CONFIG.browserDirectGitHubFetch, false);
assert.equal(CONFIG.runtimeFixture, false);
assert.equal(SOURCE.repository, "roccho-dev/governance");
assert.equal(SOURCE.releaseSelector, "latest");
assert.equal(SOURCE.assetName, "accepted-decision.json");
assert.deepEqual([...SOURCE.acceptedContentTypes], ["application/json", "application/x-ndjson"]);
assert.equal(SOURCE.maxBytes, 2_000_000);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeFiles = [
  "src/assets.mjs",
  "src/worker.mjs",
  "tests/access-contract.test.mjs",
  "tests/worker.test.mjs",
  "scripts/bootstrap-access.mjs",
  "scripts/verify-cloudflare-token.mjs",
  "scripts/verify-remote.mjs",
  "scripts/verify-root-browser.py",
  "README.md",
  "package.json",
  "wrangler.jsonc",
].map(relative => path.join(root, relative));
assert.ok(runtimeFiles.every(file => fs.existsSync(file)), "runtime closure file is missing");
const source = runtimeFiles.map(file => fs.readFileSync(file, "utf8")).join("\n");
for (const forbidden of [
  "PRIVATE_FIXTURE",
  "ENABLE_PRIVATE_FIXTURE",
  "REQUIRE_GITHUB_AUTH",
  "roccho-dev/adrs",
  "351310910",
  "471043875",
  "356287183",
  "482207652",
  "6c6409f27657eec4b497d5a0da7a6940416a45508fbf5c7032b57e4ab178f1f6",
]) {
  assert.equal(source.includes(forbidden), false, `runtime fixture or fixed release identity remains: ${forbidden}`);
}

const cleanup = fs.readFileSync(path.join(root, "scripts", "cleanup-worker-proof.mjs"), "utf8");
assert.match(cleanup, /const names = \["REQUIRE_GITHUB_AUTH", "ENABLE_PRIVATE_FIXTURE"\]/u);
assert.doesNotMatch(cleanup, /const names = \[[^\]]*GITHUB_RELEASE_TOKEN/u);

console.log(JSON.stringify({
  schema: "check-receipt/1",
  checkId: "ops.gov-release-proxy.config",
  status: "PASS",
  endpoint: "/",
  source: SOURCE.repository,
  releaseSelector: SOURCE.releaseSelector,
  semanticAsset: SOURCE.assetName,
  runtimeClosureFiles: runtimeFiles.length,
  fixedReleaseIdentity: false,
  runtimeFixture: false,
  legacyFixtureCleanupBounded: true,
}));
