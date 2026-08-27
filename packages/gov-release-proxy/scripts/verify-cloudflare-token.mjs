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
const activeToken = [userToken, accountToken].some(result => result.httpStatus === 200 && result.success && result.tokenStatus === "active");
const effectiveWorkersScope = workersScripts.httpStatus === 200 && workersScripts.success;
const receipt = {
  schema: "ops.cloudflareWorkerTokenPreflight/1",
  status: activeToken && effectiveWorkersScope ? "PASS" : "FAIL",
  accountId,
  userToken,
  accountToken,
  workersScripts,
  activeToken,
  effectiveWorkersScope,
};
fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt));
assert.equal(activeToken, true, "Cloudflare token is not active for either user or account token verification");
assert.equal(effectiveWorkersScope, true, "Cloudflare token cannot list Workers scripts for the configured account");
