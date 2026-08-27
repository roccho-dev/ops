import test from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import worker, { fetchAsset, handleRequest, ProxyError, upstreamUrl } from "../src/worker.mjs";

const bytes = Buffer.from('{"fixture":"ok"}\n');
const asset = Object.freeze({
  assetId: 99,
  name: "fixture.json",
  bytes: bytes.byteLength,
  digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  contentType: "application/json; charset=utf-8",
});
const responseFor = (body = bytes, status = 200) => new Response(body, { status, headers: { "content-type": "application/octet-stream" } });

test("fetchAsset pins the asset API and validates bytes and digest", async () => {
  const calls = [];
  const loaded = await fetchAsset({
    asset,
    cryptoScope: webcrypto,
    fetchImpl: async (url, init) => { calls.push({ url, init }); return responseFor(); },
  });
  assert.equal(Buffer.from(loaded.bytes).toString(), bytes.toString());
  assert.equal(loaded.observedDigest, asset.digest);
  assert.equal(calls[0].url, upstreamUrl(asset));
  assert.equal(calls[0].init.redirect, "follow");
  assert.equal(calls[0].init.headers.get("authorization"), null);
});

test("private mode adds server-side GitHub credential only upstream", async () => {
  let observed;
  await fetchAsset({
    asset,
    env: { GITHUB_RELEASE_TOKEN: "private-token" },
    cryptoScope: webcrypto,
    fetchImpl: async (_url, init) => { observed = init.headers; return responseFor(); },
  });
  assert.equal(observed.get("authorization"), "Bearer private-token");
});

test("digest mismatch fails closed", async () => {
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

test("health and config are non-authority metadata", async () => {
  const health = await handleRequest(new Request("https://worker.invalid/health"));
  assert.equal(health.status, 200);
  const value = await health.json();
  assert.equal(value.authority, false);
  assert.equal(value.privateUpstream, false);
  const config = await handleRequest(new Request("https://worker.invalid/config"));
  assert.equal((await config.json()).authority, false);
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

test("HEAD never calls GitHub and exposes pinned digest", async () => {
  const response = await handleRequest(new Request("https://worker.invalid/data/manifest", { method: "HEAD" }), {}, {
    fetchImpl: async () => { throw new Error("must not fetch"); },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body, null);
  assert.match(response.headers.get("x-gov-release-digest"), /^sha256:/u);
});

test("worker response never returns upstream authorization", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(Buffer.alloc(456), { status: 200 });
  try {
    const response = await worker.fetch(new Request("https://worker.invalid/data/manifest"), { GITHUB_RELEASE_TOKEN: "secret" }, {});
    assert.equal(response.headers.get("authorization"), null);
    assert.equal((await response.json()).code, "UPSTREAM_DIGEST");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
