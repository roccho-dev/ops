import assert from "node:assert/strict";

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
const apiToken = process.env.CLOUDFLARE_API_TOKEN ?? "";
const workerUrl = process.env.WORKER_URL ?? "";
const otpIdpId = process.env.CF_ACCESS_OTP_IDP_ID ?? "";
const allowedEmails = JSON.parse(process.env.CF_ACCESS_ALLOWED_EMAILS_JSON ?? "[]");
const appName = process.env.CF_ACCESS_APP_NAME ?? "stg-gov-release-proxy";
assert.match(accountId, /^[0-9a-f]{32}$/u, "CLOUDFLARE_ACCOUNT_ID is required");
assert.ok(apiToken, "CLOUDFLARE_API_TOKEN is required");
assert.ok(workerUrl, "WORKER_URL is required");
assert.ok(Array.isArray(allowedEmails) && allowedEmails.length > 0, "CF_ACCESS_ALLOWED_EMAILS_JSON is required");
assert.ok(allowedEmails.every(value => /^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(value)), "allowed emails are invalid");
assert.ok(otpIdpId, "CF_ACCESS_OTP_IDP_ID is required");
const domain = new URL(workerUrl).host;
const api = `https://api.cloudflare.com/client/v4/accounts/${accountId}/access/apps`;
const headers = { authorization: `Bearer ${apiToken}`, "content-type": "application/json" };

const list = await fetch(`${api}?per_page=100`, { headers });
assert.equal(list.status, 200, await list.text());
const listValue = await list.json();
assert.equal(listValue.success, true);
const existing = listValue.result.find(app => app.name === appName);
const body = {
  type: "self_hosted",
  name: appName,
  domain,
  session_duration: "24h",
  auto_redirect_to_identity: true,
  policies: [{
    name: `${appName} email OTP`,
    decision: "allow",
    precedence: 1,
    include: allowedEmails.map(email => ({ email: { email } })),
    require: [{ login_method: { id: otpIdpId } }],
  }],
};
const response = await fetch(existing ? `${api}/${existing.id}` : api, {
  method: existing ? "PUT" : "POST",
  headers,
  body: JSON.stringify(body),
});
assert.ok(response.ok, await response.text());
const value = await response.json();
assert.equal(value.success, true);
assert.equal(value.result.name, appName);
assert.equal(value.result.domain, domain);
console.log(JSON.stringify({
  schema: "ops.govReleaseProxyAccessReceipt/1",
  status: "PASS",
  action: existing ? "updated" : "created",
  applicationId: value.result.id,
  applicationName: appName,
  domain,
  emailCount: allowedEmails.length,
  otpIdpId,
  authority: false,
}));
