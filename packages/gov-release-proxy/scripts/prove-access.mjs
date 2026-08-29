import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { PRIVATE_FIXTURE_ASSETS, PUBLIC_ASSETS } from "../src/assets.mjs";

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
const apiToken = process.env.CLOUDFLARE_API_TOKEN ?? "";
const baseUrl = process.argv[2] ?? "";
const output = process.env.ACCESS_PROOF_RECEIPT ?? "access-proof-receipt.json";
const runIdentity = process.env.GITHUB_RUN_ID ?? String(Date.now());
assert.match(accountId, /^[0-9a-f]{32}$/u, "CLOUDFLARE_ACCOUNT_ID is required");
assert.ok(apiToken, "CLOUDFLARE_API_TOKEN is required");
assert.ok(baseUrl, "Worker base URL is required");
const domain = new URL(baseUrl).host;
const apiBase = `https://api.cloudflare.com/client/v4/accounts/${accountId}`;
const apiHeaders = { authorization: `Bearer ${apiToken}`, "content-type": "application/json" };
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
let serviceToken = null;
let application = null;
let proof = null;
let proofError = null;

const cf = async (pathname, { method = "GET", body = null, allow404 = false } = {}) => {
  const response = await fetch(`${apiBase}${pathname}`, {
    method,
    headers: apiHeaders,
    body: body === null ? null : JSON.stringify(body),
    redirect: "error",
  });
  let value = null;
  try { value = await response.json(); } catch { value = null; }
  if (allow404 && response.status === 404) return null;
  if (!response.ok || value?.success !== true) {
    const codes = Array.isArray(value?.errors) ? value.errors.map(error => error.code) : [];
    throw new Error(`Cloudflare API ${method} ${pathname} failed: HTTP ${response.status}; codes=${codes.join(",")}`);
  }
  return value.result;
};

const poll = async (callback, label) => {
  let last = null;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    last = await callback(attempt);
    if (last.done) return { ...last, attempts: attempt };
    if (attempt < 30) await sleep(2000);
  }
  throw new Error(`${label} did not converge: ${JSON.stringify(last)}`);
};

try {
  serviceToken = await cf("/access/service_tokens", {
    method: "POST",
    body: {
      name: `stg-gov-release-proxy-ci-${runIdentity}`,
      duration: "1h",
      enabled: true,
    },
  });
  assert.ok(serviceToken.id && serviceToken.client_id && serviceToken.client_secret);

  application = await cf("/access/apps", {
    method: "POST",
    body: {
      type: "self_hosted",
      name: `stg-gov-release-proxy-ci-${runIdentity}`,
      domain,
      session_duration: "1h",
      auto_redirect_to_identity: false,
      policies: [{
        name: `stg-gov-release-proxy-ci-${runIdentity}`,
        decision: "non_identity",
        precedence: 1,
        include: [{ service_token: { token_id: serviceToken.id } }],
        exclude: [],
        require: [],
      }],
    },
  });
  assert.ok(application.id);

  const anonymous = await poll(async () => {
    const response = await fetch(new URL("/health", baseUrl), { redirect: "manual" });
    return { done: response.status !== 200, status: response.status, locationPresent: Boolean(response.headers.get("location")) };
  }, "anonymous Access block");
  assert.ok([302, 401, 403].includes(anonymous.status), `unexpected anonymous status ${anonymous.status}`);

  const accessHeaders = {
    "CF-Access-Client-Id": serviceToken.client_id,
    "CF-Access-Client-Secret": serviceToken.client_secret,
  };
  const authenticated = await poll(async () => {
    const response = await fetch(new URL("/health", baseUrl), { headers: accessHeaders, redirect: "manual" });
    return { done: response.status === 200, status: response.status };
  }, "service-token Access readback");
  assert.equal(authenticated.status, 200);

  const results = [];
  for (const [route, asset] of Object.entries({ ...PUBLIC_ASSETS, ...PRIVATE_FIXTURE_ASSETS })) {
    const response = await fetch(new URL(route, baseUrl), { headers: accessHeaders, redirect: "manual" });
    assert.equal(response.status, 200, `${route}: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    assert.equal(bytes.byteLength, asset.bytes);
    assert.equal(digest, asset.digest);
    assert.equal(response.headers.get("x-gov-release-upstream-auth"), "credential");
    results.push({ route, repository: asset.repository, visibility: asset.visibility, bytes: bytes.length, digest });
  }

  proof = {
    schema: "ops.govReleaseAccessServiceTokenProof/1",
    status: "PASS",
    domain,
    anonymous: { status: anonymous.status, attempts: anonymous.attempts, blocked: true },
    authenticated: { status: authenticated.status, attempts: authenticated.attempts, serviceToken: true },
    results,
    accessApplicationCreated: true,
    serviceTokenCreated: true,
    authority: false,
    cutover: false,
  };
} catch (error) {
  proofError = error;
  proof = {
    schema: "ops.govReleaseAccessServiceTokenProof/1",
    status: "FAIL",
    domain,
    error: String(error?.message ?? error),
    accessApplicationCreated: Boolean(application?.id),
    serviceTokenCreated: Boolean(serviceToken?.id),
    authority: false,
    cutover: false,
  };
} finally {
  const cleanup = { applicationDeleted: false, serviceTokenDeleted: false };
  if (application?.id) {
    try {
      await cf(`/access/apps/${application.id}`, { method: "DELETE", allow404: true });
      cleanup.applicationDeleted = true;
    } catch (error) {
      cleanup.applicationError = String(error?.message ?? error);
    }
  }
  if (serviceToken?.id) {
    try {
      await cf(`/access/service_tokens/${serviceToken.id}`, { method: "DELETE", allow404: true });
      cleanup.serviceTokenDeleted = true;
    } catch (error) {
      cleanup.serviceTokenError = String(error?.message ?? error);
    }
  }
  proof.cleanup = cleanup;
  fs.writeFileSync(output, `${JSON.stringify(proof, null, 2)}\n`);
  console.log(JSON.stringify(proof));
}

if (proofError) throw proofError;
assert.equal(proof.cleanup.applicationDeleted, true);
assert.equal(proof.cleanup.serviceTokenDeleted, true);
