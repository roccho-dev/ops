import assert from "node:assert/strict";
import fs from "node:fs";

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
const apiToken = process.env.CLOUDFLARE_API_TOKEN ?? "";
const workerName = process.env.CLOUDFLARE_WORKER_NAME ?? "stg-gov-release-proxy";
const output = process.env.WORKER_CLEANUP_RECEIPT ?? "worker-cleanup-receipt.json";
assert.match(accountId, /^[0-9a-f]{32}$/u, "CLOUDFLARE_ACCOUNT_ID is required");
assert.ok(apiToken, "CLOUDFLARE_API_TOKEN is required");
assert.match(workerName, /^[a-z0-9-]+$/u);
const names = ["GITHUB_RELEASE_TOKEN", "REQUIRE_GITHUB_AUTH", "ENABLE_PRIVATE_FIXTURE"];
const headers = { authorization: `Bearer ${apiToken}`, accept: "application/json" };
const results = [];
for (const name of names) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}/secrets/${name}`,
    { method: "DELETE", headers, redirect: "error" },
  );
  let value = null;
  try { value = await response.json(); } catch { value = null; }
  const success = response.status === 404 || (response.ok && value?.success === true);
  results.push({ name, httpStatus: response.status, deletedOrAbsent: success });
}
const receipt = {
  schema: "ops.govReleaseWorkerProofCleanup/1",
  status: results.every(result => result.deletedOrAbsent) ? "PASS" : "FAIL",
  workerName,
  results,
};
fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt));
assert.equal(receipt.status, "PASS");
