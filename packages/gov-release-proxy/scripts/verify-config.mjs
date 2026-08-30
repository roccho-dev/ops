import assert from "node:assert/strict";
import {
  CONFIG,
  PRIVATE_FIXTURE_BINDING,
  PRIVATE_FIXTURE_ROOT_ASSET,
  PUBLIC_BINDING,
  PUBLIC_ROOT_ASSET,
  configFor,
} from "../src/assets.mjs";
import { validateBinding } from "../src/binding.mjs";

for (const binding of [PUBLIC_BINDING, PRIVATE_FIXTURE_BINDING]) {
  assert.equal(validateBinding(binding).bindingId, binding.bindingId);
  assert.equal(binding.authority, false);
  assert.equal(binding.productionCutover, false);
  assert.equal(binding.endpoint, "/");
  assert.equal(binding.deliveryModel, "one-root");
  assert.equal(binding.browserDirectGitHubFetch, false);
}

assert.equal(CONFIG.schema, "ops.govReleaseProxyConfig/4");
assert.equal(CONFIG.bindingId, PUBLIC_BINDING.bindingId);
assert.equal(CONFIG.authority, false);
assert.equal(CONFIG.claimCeiling, "VISUAL_EVALUATION_ONLY");
assert.equal(CONFIG.productionCutover, false);
assert.equal(CONFIG.asset, PUBLIC_ROOT_ASSET);
assert.equal(CONFIG.ui.meaningDigest, CONFIG.asset.digest);

assert.equal(PUBLIC_ROOT_ASSET.sourceKind, "git-raw");
assert.equal(PUBLIC_ROOT_ASSET.requiresCredential, false);
assert.equal(PRIVATE_FIXTURE_ROOT_ASSET.sourceKind, "github-release-asset");
assert.equal(PRIVATE_FIXTURE_ROOT_ASSET.requiresCredential, true);
assert.equal(configFor({ privateFixtureEnabled: true }).asset, PRIVATE_FIXTURE_ROOT_ASSET);

console.log(JSON.stringify({
  schema: "check-receipt/1",
  checkId: "ops.gov-release-proxy.binding",
  status: "PASS",
  bindingSchema: PUBLIC_BINDING.schema,
  defaultBindingId: PUBLIC_BINDING.bindingId,
  localBindingInput: "GOV_RELEASE_BINDING_JSON",
  endpoint: "/",
  htmlNdjsonMeaningIdentity: "BOUND",
  productionCutover: false,
}));
