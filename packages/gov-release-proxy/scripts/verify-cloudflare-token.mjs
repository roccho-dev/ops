import assert from "node:assert/strict";
import fs from "node:fs";

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
const apiToken = process.env.CLOUDFLARE_API_TOKEN ?? "";
const output = process.env.CLOUDFLARE_PREFLIGHT_RECEIPT ?? "cloudflare-token-preflight.json";
assert.match(accountId, /^[0-9a-f]{32}$/u, "CLOUDFLARE_ACCOUNT_ID is required");
assert.ok(apiToken, "CLOUDFLARE_API_TOKEN is required");

const headers = { authorization: `Bearer ${apiToken}`, accept: "application/json" };
const call = async path => {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, { headers, redirect: "error" });
  let value = null;
  try { value = await response.json(); } catch { value = null; }
  return {
    httpStatus: response.status,
    success: value?.success === true,
    tokenStatus: value?.result?.status ?? null,
    errorCodes: Array.isArray(value?.errors) ? value.errors.map(error => error.code) : [],
  };
};

const userToken = await call("/user/tokens/verify");
const accountToken = await call(`/accounts/${accountId}/tokens/verify`);
const workersScripts = await call(`/accounts/${accountId}/workers/scripts`);
const accessApps = await call(`/accounts/${accountId}/access/apps?per_page=1`);
const accessServiceTokens = await call(`/accounts/${accountId}/access/service_tokens?per_page=1`);
const activeToken = [userToken, accountToken].some(result => result.httpStatus === 200 && result.success && result.tokenStatus === "active");
const receipt = {
  schema: "ops.cloudflareWorkerTokenPreflight/2",
  status: activeToken && workersScripts.success ? "PASS" : "FAIL",
  accountId,
  userToken,
  accountToken,
  workersScripts,
  accessApps,
  accessServiceTokens,
  activeToken,
  effectiveWorkersScope: workersScripts.success,
  effectiveAccessAppsScope: accessApps.success,
  effectiveAccessServiceTokenScope: accessServiceTokens.success,
};
fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt));
assert.equal(activeToken, true, "Cloudflare token is not active");
assert.equal(workersScripts.success, true, "Cloudflare token cannot list Workers scripts");
