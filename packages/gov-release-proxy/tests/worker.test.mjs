import test from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import {
  PRIVATE_FIXTURE_ASSETS,
  PUBLIC_ASSETS,
} from "../src/assets.mjs";
import worker, {
  ProxyError,
  availableAssets,
  fetchAsset,
  handleRequest,
  resolveAsset,
  upstreamUrl,
} from "../src/worker.mjs";

const bytes = Buffer.from('{"fixture":"ok"}\n');
const asset = Object.freeze({
  repository: "roccho-dev/example",
  releaseId: 1,
  tag: "proof",
  visibility: "public",
  assetId: 99,
  name: "fixture.json",
  bytes: bytes.byteLength,
  digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  contentType: "application/json; charset=utf-8",
  requiresCredential: false,
});
const responseFor = (body = bytes, status = 200) => new Response(body, {
  status,
  headers: { "content-type": "application/octet-stream" },
});
const digestCrypto = digest => ({
  subtle: {
    digest: async () => Uint8Array.from(Buffer.from(digest.slice("sha256:".length), "hex")).buffer,
  },
});

test("fetchAsset pins repository and asset API and validates bytes and digest", async () => {
  const calls = [];
  const loaded = await fetchAsset({
    asset,
    cryptoScope: webcrypto,
    fetchImpl: async (url, init) => { calls.push({ url, init }); return responseFor(); },
  });
  assert.equal(Buffer.from(loaded.bytes).toString(), bytes.toString());
  assert.equal(loaded.observedDigest, asset.digest);
  assert.equal(loaded.credentialUsed, false);
  assert.equal(calls[0].url, "https://api.github.com/repos/roccho-dev/example/releases/assets/99");
  assert.equal(calls[0].init.redirect, "follow");
  assert.equal(calls[0].init.headers.get("authorization"), null);
});

test("required public auth and private fixtures use server-side credential", async () => {
  let publicHeaders;
  const publicLoaded = await fetchAsset({
    asset,
    env: { GITHUB_RELEASE_TOKEN: "bounded-token", REQUIRE_GITHUB_AUTH: "true" },
    cryptoScope: webcrypto,
    fetchImpl: async (_url, init) => { publicHeaders = init.headers; return responseFor(); },
  });
  assert.equal(publicHeaders.get("authorization"), "Bearer bounded-token");
  assert.equal(publicLoaded.credentialUsed, true);

  const privateAsset = Object.values(PRIVATE_FIXTURE_ASSETS)[0];
  let privateHeaders;
  await fetchAsset({
    asset: privateAsset,
    env: { GITHUB_RELEASE_TOKEN: "bounded-token" },
    cryptoScope: digestCrypto(privateAsset.digest),
    fetchImpl: async (_url, init) => {
      privateHeaders = init.headers;
      return responseFor(Buffer.alloc(privateAsset.bytes));
    },
  });
  assert.equal(privateHeaders.get("authorization"), "Bearer bounded-token");
  assert.equal(upstreamUrl(privateAsset), `https://api.github.com/repos/roccho-dev/adrs/releases/assets/${privateAsset.assetId}`);
});

test("missing required credential fails before upstream", async () => {
  await assert.rejects(
    fetchAsset({ asset, env: { REQUIRE_GITHUB_AUTH: "true" }, fetchImpl: async () => { throw new Error("must not fetch"); } }),
    error => error instanceof ProxyError && error.code === "UPSTREAM_CREDENTIAL_REQUIRED",
  );
  await assert.rejects(
    fetchAsset({ asset: Object.values(PRIVATE_FIXTURE_ASSETS)[0], fetchImpl: async () => { throw new Error("must not fetch"); } }),
    error => error instanceof ProxyError && error.code === "UPSTREAM_CREDENTIAL_REQUIRED",
  );
});

test("digest and byte mismatch fail closed", async () => {
  await assert.rejects(
    fetchAsset({ asset, cryptoScope: webcrypto, fetchImpl: async () => responseFor(Buffer.from("tampered")) }),
    error => error instanceof ProxyError && error.code === "UPSTREAM_BYTES",
  );
  const sameBytes = Buffer.from('{"fixture":"no"}\n');
  assert.equal(sameBytes.byteLength, bytes.byteLength);
  await assert.rejects(
    fetchAsset({ asset, cryptoScope: webcrypto, fetchImpl: async () => responseFor(sameBytes) }),
    error => error instanceof ProxyError && error.code === "UPSTREAM_DIGEST",
  );
});

test("private routes remain hidden until proof flag is set", () => {
  assert.equal(Object.keys(availableAssets({})).length, 2);
  assert.equal(resolveAsset("/proof/private/manifest", {}), null);
  assert.equal(Object.keys(availableAssets({ ENABLE_PRIVATE_FIXTURE: "true" })).length, 4);
  assert.equal(resolveAsset("/proof/private/manifest", { ENABLE_PRIVATE_FIXTURE: "true" }).repository, "roccho-dev/adrs");
});

test("enabled private route reads with credential and exposes no credential", async () => {
  const privateAsset = PRIVATE_FIXTURE_ASSETS["/proof/private/manifest"];
  let upstreamHeaders;
  const response = await handleRequest(
    new Request("https://worker.invalid/proof/private/manifest"),
    { ENABLE_PRIVATE_FIXTURE: "true", GITHUB_RELEASE_TOKEN: "secret" },
    {
      cryptoScope: digestCrypto(privateAsset.digest),
      fetchImpl: async (_url, init) => {
        upstreamHeaders = init.headers;
        return responseFor(Buffer.alloc(privateAsset.bytes));
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-gov-release-upstream-auth"), "credential");
  assert.equal(response.headers.get("authorization"), null);
  assert.equal(upstreamHeaders.get("authorization"), "Bearer secret");
});

test("health/config expose states but never secret values", async () => {
  const env = { ENABLE_PRIVATE_FIXTURE: "true", REQUIRE_GITHUB_AUTH: "true", GITHUB_RELEASE_TOKEN: "secret" };
  const health = await handleRequest(new Request("https://worker.invalid/health"), env);
  const healthText = await health.text();
  const healthValue = JSON.parse(healthText);
  assert.equal(healthValue.githubCredentialConfigured, true);
  assert.equal(healthValue.githubAuthRequired, true);
  assert.equal(healthValue.privateFixtureEnabled, true);
  assert.equal(healthText.includes("secret"), false);
  const config = await handleRequest(new Request("https://worker.invalid/config"), env);
  const configValue = await config.json();
  assert.equal(configValue.routes.length, 4);
});

test("only fixed GET and HEAD routes are accepted", async () => {
  const post = await worker.fetch(new Request("https://worker.invalid/data/manifest", { method: "POST" }), {}, {});
  assert.equal(post.status, 405);
  assert.equal((await post.json()).code, "METHOD_NOT_ALLOWED");
  const missing = await worker.fetch(new Request("https://worker.invalid/data/unknown"), {}, {});
  assert.equal(missing.status, 404);
  const query = await worker.fetch(new Request("https://worker.invalid/data/manifest?url=https://evil.invalid"), {}, {});
  assert.equal(query.status, 400);
});

test("HEAD never calls GitHub and exposes pinned metadata", async () => {
  const response = await handleRequest(new Request("https://worker.invalid/data/manifest", { method: "HEAD" }), {}, {
    fetchImpl: async () => { throw new Error("must not fetch"); },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body, null);
  assert.equal(response.headers.get("x-gov-release-repository"), "roccho-dev/governance");
  assert.match(response.headers.get("x-gov-release-digest"), /^sha256:/u);
});

test("public assets remain exactly two production routes", () => {
  assert.deepEqual(Object.keys(PUBLIC_ASSETS), ["/data/manifest", "/data/accepted-decision"]);
});
