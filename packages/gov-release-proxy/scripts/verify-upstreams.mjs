import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PRIVATE_FIXTURE_ASSETS, PUBLIC_ASSETS } from "../src/assets.mjs";
import { upstreamUrl } from "../src/worker.mjs";

const token = process.env.GITHUB_RELEASE_TOKEN ?? "";
assert.ok(token, "GITHUB_RELEASE_TOKEN is required");
const results = [];
for (const [route, asset] of Object.entries({ ...PUBLIC_ASSETS, ...PRIVATE_FIXTURE_ASSETS })) {
  const response = await fetch(upstreamUrl(asset), {
    headers: {
      accept: "application/octet-stream",
      authorization: `Bearer ${token}`,
      "user-agent": "roccho-dev-ops-gov-release-auth-proof/1",
      "x-github-api-version": "2022-11-28",
    },
    redirect: "follow",
  });
  assert.equal(response.status, 200, `${route}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  assert.equal(bytes.byteLength, asset.bytes, `${route}: bytes`);
  assert.equal(digest, asset.digest, `${route}: digest`);
  results.push({
    route,
    repository: asset.repository,
    visibility: asset.visibility,
    assetId: asset.assetId,
    bytes: bytes.byteLength,
    digest,
  });
}
console.log(JSON.stringify({
  schema: "ops.govReleaseAuthenticatedUpstreamReceipt/1",
  status: "PASS",
  credentialUsed: true,
  publicPassed: results.filter(row => row.visibility === "public").length === 2,
  privatePassed: results.filter(row => row.visibility === "private").length === 2,
  results,
  authority: false,
  cutover: false,
}));
