import test from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { SOURCE } from "../src/assets.mjs";
import worker, {
  ProxyError,
  fetchAsset,
  handleRequest,
  latestReleaseUrl,
  normalizeLatestRelease,
  resolveCurrentAsset,
  wantsData,
} from "../src/worker.mjs";

const body = Buffer.from('{"id":"real-release-record","status":"adopted"}\n');
const digest = `sha256:${createHash("sha256").update(body).digest("hex")}`;
const release = ({ overrides = {} } = {}) => ({
  id: 777,
  name: "decision-v1",
  tag_name: `gov-release/decision-v1/${"a".repeat(64)}`,
  target_commitish: "b".repeat(40),
  draft: false,
  prerelease: false,
  assets: [{
    id: 888,
    name: SOURCE.assetName,
    state: "uploaded",
    size: body.byteLength,
    digest,
    content_type: "application/json",
    url: `https://api.github.com/repos/${SOURCE.repository}/releases/assets/888`,
    browser_download_url: `https://github.com/${SOURCE.repository}/releases/download/gov-release/decision-v1/${"a".repeat(64)}/${SOURCE.assetName}`,
  }],
  ...overrides,
});
const uiAssets = {
  fetch: async () => new Response("<!doctype html><title>UI</title>", {
    headers: { "content-type": "text/html; charset=utf-8" },
  }),
};
const jsonResponse = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json", ...headers },
});
const bytesResponse = (value = body, status = 200, headers = {}) => new Response(value, {
  status,
  headers: { "content-type": "application/octet-stream", ...headers },
});

test("root content negotiation distinguishes UI from semantic data", () => {
  assert.equal(wantsData(new Request("https://worker.invalid/", { headers: { accept: "text/html" } })), false);
  assert.equal(wantsData(new Request("https://worker.invalid/", { headers: { accept: "application/json" } })), true);
  assert.equal(wantsData(new Request("https://worker.invalid/", { headers: { accept: "application/x-ndjson" } })), true);
});

test("release contract resolves one exact real asset without fixed release identity", () => {
  const value = normalizeLatestRelease(release());
  assert.equal(value.releaseNumericId, 777);
  assert.equal(value.releaseId, "decision-v1");
  assert.equal(value.assetId, 888);
  assert.equal(value.bytes, body.byteLength);
  assert.equal(value.digest, digest);
});

test("release contract rejects non-gov, draft, duplicate and malformed assets", () => {
  for (const value of [
    release({ overrides: { tag_name: "other/v1" } }),
    release({ overrides: { draft: true } }),
    release({ overrides: { assets: [release().assets[0], release().assets[0]] } }),
    release({ overrides: { assets: [{ ...release().assets[0], digest: null }] } }),
    release({ overrides: { assets: [{ ...release().assets[0], content_type: "text/plain" }] } }),
  ]) {
    assert.throws(() => normalizeLatestRelease(value), ProxyError);
  }
});

test("public source resolves anonymously even when a credential exists", async () => {
  const calls = [];
  const asset = await resolveCurrentAsset({
    env: { GITHUB_RELEASE_TOKEN: "configured-but-unneeded" },
    fetchImpl: async (url, init) => {
      calls.push({ url, authorization: init.headers.get("authorization") });
      return jsonResponse(release());
    },
  });
  assert.equal(asset.credentialUsed, false);
  assert.deepEqual(calls, [{ url: latestReleaseUrl(), authorization: null }]);
});

test("private source retries fixed metadata with the server credential", async () => {
  const calls = [];
  const asset = await resolveCurrentAsset({
    env: { GITHUB_RELEASE_TOKEN: "secret" },
    fetchImpl: async (url, init) => {
      const authorization = init.headers.get("authorization");
      calls.push({ url, authorization });
      return authorization ? jsonResponse(release()) : jsonResponse({ message: "Not Found" }, 404);
    },
  });
  assert.equal(asset.credentialUsed, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].authorization, null);
  assert.equal(calls[1].authorization, "Bearer secret");
});

test("missing and insufficient private credentials remain explicit", async () => {
  await assert.rejects(
    resolveCurrentAsset({
      env: {},
      fetchImpl: async () => jsonResponse({ message: "Not Found" }, 404),
    }),
    error => error instanceof ProxyError && error.status === 401,
  );
  await assert.rejects(
    resolveCurrentAsset({
      env: { GITHUB_RELEASE_TOKEN: "secret" },
      fetchImpl: async () => jsonResponse({ message: "Not Found" }, 404),
    }),
    error => error instanceof ProxyError && error.status === 403,
  );
});

test("public root serves the current release and verifies exact bytes", async () => {
  const calls = [];
  const response = await handleRequest(
    new Request("https://worker.invalid/", { headers: { accept: "application/json" } }),
    {},
    {
      fetchImpl: async (url, init) => {
        calls.push({ url, authorization: init.headers.get("authorization") });
        return url === latestReleaseUrl() ? jsonResponse(release()) : bytesResponse();
      },
      cryptoScope: webcrypto,
    },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), body);
  assert.equal(response.headers.get("x-gov-release-selector"), "latest");
  assert.equal(response.headers.get("x-gov-release-id"), "decision-v1");
  assert.equal(response.headers.get("x-gov-release-numeric-id"), "777");
  assert.equal(response.headers.get("x-gov-release-asset-id"), "888");
  assert.equal(response.headers.get("x-gov-release-digest"), digest);
  assert.equal(response.headers.get("x-gov-release-upstream-auth"), "anonymous");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].authorization, null);
  assert.equal(calls[1].authorization, null);
});

test("private asset uses only the server-side credential", async () => {
  const calls = [];
  const response = await handleRequest(
    new Request("https://worker.invalid/", { headers: { accept: "application/json" } }),
    { GITHUB_RELEASE_TOKEN: "secret" },
    {
      fetchImpl: async (url, init) => {
        const authorization = init.headers.get("authorization");
        calls.push({ url, authorization });
        if (url === latestReleaseUrl() && !authorization) return jsonResponse({ message: "Not Found" }, 404);
        if (url === latestReleaseUrl()) return jsonResponse(release());
        return bytesResponse();
      },
      cryptoScope: webcrypto,
    },
  );
  assert.equal(response.status, 200);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].authorization, "Bearer secret");
  assert.equal(response.headers.get("authorization"), null);
  assert.equal(response.headers.get("x-gov-release-upstream-auth"), "credential");
});

test("byte, digest and GitHub rate-limit failures close the data path", async () => {
  const normalized = Object.freeze({ ...normalizeLatestRelease(release()), credentialUsed: false });
  await assert.rejects(
    fetchAsset({ asset: normalized, fetchImpl: async () => bytesResponse(Buffer.from("wrong")), cryptoScope: webcrypto }),
    error => error instanceof ProxyError && error.code === "UPSTREAM_BYTES",
  );
  const sameSize = Buffer.from(body);
  sameSize[0] ^= 1;
  await assert.rejects(
    fetchAsset({ asset: normalized, fetchImpl: async () => bytesResponse(sameSize), cryptoScope: webcrypto }),
    error => error instanceof ProxyError && error.code === "UPSTREAM_DIGEST",
  );
  await assert.rejects(
    resolveCurrentAsset({ fetchImpl: async () => jsonResponse({}, 403, { "x-ratelimit-remaining": "0" }) }),
    error => error instanceof ProxyError && error.status === 503,
  );
});

test("HTML stays on the same root and never touches GitHub", async () => {
  const response = await handleRequest(
    new Request("https://worker.invalid/", { headers: { accept: "text/html" } }),
    { ASSETS: uiAssets },
    { fetchImpl: async () => { throw new Error("must not fetch GitHub"); } },
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/html/u);
});

test("only root GET and HEAD exist", async () => {
  const post = await worker.fetch(new Request("https://worker.invalid/", { method: "POST" }), { ASSETS: uiAssets }, {});
  assert.equal(post.status, 405);
  const missing = await worker.fetch(new Request("https://worker.invalid/data/manifest"), { ASSETS: uiAssets }, {});
  assert.equal(missing.status, 404);
  const query = await worker.fetch(new Request("https://worker.invalid/?repo=evil"), { ASSETS: uiAssets }, {});
  assert.equal(query.status, 400);
});

test("data HEAD resolves current metadata but skips asset bytes", async () => {
  const calls = [];
  const response = await handleRequest(
    new Request("https://worker.invalid/", { method: "HEAD", headers: { accept: "application/json" } }),
    {},
    {
      fetchImpl: async (url, init) => {
        calls.push({ url, accept: init.headers.get("accept") });
        return jsonResponse(release());
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(response.body, null);
  assert.equal(calls.length, 1);
  assert.equal(response.headers.get("x-gov-release-digest"), digest);
});
