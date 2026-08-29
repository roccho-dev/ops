import test from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import {
  PRIVATE_FIXTURE_ROOT_ASSET,
  PUBLIC_ROOT_ASSET,
} from "../src/assets.mjs";
import worker, {
  ProxyError,
  fetchAsset,
  handleRequest,
  selectedRootAsset,
  upstreamUrl,
  wantsData,
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
const uiAssets = {
  fetch: async request => new Response("<!doctype html><title>UI</title>", {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "x-request-method": request.method },
  }),
};

test("root content negotiation distinguishes HTML from JSON", () => {
  assert.equal(wantsData(new Request("https://worker.invalid/", { headers: { accept: "text/html" } })), false);
  assert.equal(wantsData(new Request("https://worker.invalid/", { headers: { accept: "application/json" } })), true);
  assert.equal(wantsData(new Request("https://worker.invalid/", { headers: { accept: "application/x-ndjson" } })), true);
});

test("HTML is served from the same root without touching GitHub", async () => {
  const response = await handleRequest(new Request("https://worker.invalid/", { headers: { accept: "text/html" } }), { ASSETS: uiAssets }, {
    fetchImpl: async () => { throw new Error("must not fetch upstream"); },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/html/u);
  assert.match(await response.text(), /<title>UI<\/title>/u);
});

test("JSON is served from the same root with pinned bytes and digest", async () => {
  const selected = PUBLIC_ROOT_ASSET;
  const response = await handleRequest(
    new Request("https://worker.invalid/", { headers: { accept: "application/json" } }),
    {},
    {
      cryptoScope: digestCrypto(selected.digest),
      fetchImpl: async (url, init) => {
        assert.equal(url, upstreamUrl(selected));
        assert.equal(init.headers.get("authorization"), null);
        return responseFor(Buffer.alloc(selected.bytes));
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal((await response.arrayBuffer()).byteLength, selected.bytes);
  assert.equal(response.headers.get("x-gov-release-digest"), selected.digest);
  assert.equal(response.headers.get("vary"), "Accept");
});

test("public root needs no credential; private root does", async () => {
  assert.equal(selectedRootAsset({}), PUBLIC_ROOT_ASSET);
  assert.equal(selectedRootAsset({ ENABLE_PRIVATE_FIXTURE: "true" }), PRIVATE_FIXTURE_ROOT_ASSET);
  const publicLoaded = await fetchAsset({ asset, cryptoScope: webcrypto, fetchImpl: async () => responseFor() });
  assert.equal(publicLoaded.credentialUsed, false);
  await assert.rejects(
    fetchAsset({ asset: PRIVATE_FIXTURE_ROOT_ASSET, fetchImpl: async () => { throw new Error("must not fetch"); } }),
    error => error instanceof ProxyError && error.code === "UPSTREAM_CREDENTIAL_REQUIRED",
  );
});

test("private root uses the credential only upstream", async () => {
  let upstreamHeaders;
  const selected = PRIVATE_FIXTURE_ROOT_ASSET;
  const response = await handleRequest(
    new Request("https://worker.invalid/", { headers: { accept: "application/x-ndjson" } }),
    { ENABLE_PRIVATE_FIXTURE: "true", GITHUB_RELEASE_TOKEN: "secret" },
    {
      cryptoScope: digestCrypto(selected.digest),
      fetchImpl: async (_url, init) => {
        upstreamHeaders = init.headers;
        return responseFor(Buffer.alloc(selected.bytes));
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(upstreamHeaders.get("authorization"), "Bearer secret");
  assert.equal(response.headers.get("authorization"), null);
  assert.equal(response.headers.get("x-gov-release-upstream-auth"), "credential");
});

test("upstream 401 and 403 remain explicit closed states", async () => {
  for (const [status, code] of [[401, "AUTHENTICATION_REQUIRED"], [403, "ACCESS_DENIED"]]) {
    await assert.rejects(
      fetchAsset({ asset, fetchImpl: async () => responseFor("", status) }),
      error => error instanceof ProxyError && error.code === code && error.status === status,
    );
  }
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

test("only root GET and HEAD exist", async () => {
  const post = await worker.fetch(new Request("https://worker.invalid/", { method: "POST" }), { ASSETS: uiAssets }, {});
  assert.equal(post.status, 405);
  assert.equal((await post.json()).code, "METHOD_NOT_ALLOWED");
  const missing = await worker.fetch(new Request("https://worker.invalid/data/manifest"), { ASSETS: uiAssets }, {});
  assert.equal(missing.status, 404);
  const query = await worker.fetch(new Request("https://worker.invalid/?repo=evil"), { ASSETS: uiAssets }, {});
  assert.equal(query.status, 400);
});

test("root data HEAD exposes metadata without upstream fetch", async () => {
  const response = await handleRequest(
    new Request("https://worker.invalid/", { method: "HEAD", headers: { accept: "application/json" } }),
    {},
    { fetchImpl: async () => { throw new Error("must not fetch"); } },
  );
  assert.equal(response.status, 200);
  assert.equal(response.body, null);
  assert.equal(response.headers.get("x-gov-release-repository"), "roccho-dev/governance");
  assert.equal(response.headers.get("x-gov-release-digest"), PUBLIC_ROOT_ASSET.digest);
});

test("root HTML HEAD remains delegated to static assets", async () => {
  const response = await handleRequest(new Request("https://worker.invalid/", { method: "HEAD", headers: { accept: "text/html" } }), { ASSETS: uiAssets });
  assert.equal(response.status, 200);
  assert.equal(response.body, null);
});
