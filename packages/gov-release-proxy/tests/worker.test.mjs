import test from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { SOURCE } from "../src/assets.mjs";
import worker, {
  ProxyError,
  exactDownloadUrl,
  handleRequest,
  latestApiUrl,
  latestWebUrl,
  normalizePrivateRelease,
  parseLatestRedirect,
  resolveCurrentPayload,
  wantsData,
} from "../src/worker.mjs";

const canonicalJson = value => {
  if (value === null) return "null";
  if (["string", "boolean", "number"].includes(typeof value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
};
const digestText = text => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const digestJson = value => digestText(canonicalJson(value));
const bytesOf = value => Buffer.from(`${JSON.stringify(value)}\n`);

const decision = Object.freeze({
  kind: "govReleaseDecision.v1",
  id: "decision-v1",
  status: "adopted",
});
const decisionSemanticDigest = digestJson(decision);
const manifest = Object.freeze({
  kind: "govReleaseManifest.v1",
  releaseId: "decision-v1",
  sequence: 7,
  previousReleaseDigest: null,
  supersedesReleaseDigest: null,
  acceptedDecisionDigest: decisionSemanticDigest,
  govEngineDigest: `sha256:${"1".repeat(64)}`,
  nixOutputDigest: `sha256:${"2".repeat(64)}`,
  status: "adopted",
});
const manifestDigest = digestJson(manifest);
const tag = `gov-release/decision-v1/${manifestDigest.slice("sha256:".length)}`;
const manifestBytes = bytesOf(manifest);
const decisionBytes = bytesOf(decision);
const manifestRawDigest = digestText(manifestBytes);
const decisionRawDigest = digestText(decisionBytes);

const redirectResponse = (location, status = 302) => new Response(null, {
  status,
  headers: { location },
});
const jsonResponse = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json", ...headers },
});
const bytesResponse = (value, status = 200, headers = {}) => new Response(value, {
  status,
  headers: { "content-type": "application/octet-stream", ...headers },
});
const publicFetch = async (url, init) => {
  assert.equal(init.headers.get("authorization"), null);
  if (url === latestWebUrl()) {
    return redirectResponse(`https://github.com/${SOURCE.repository}/releases/tag/${tag}`);
  }
  if (url === exactDownloadUrl(tag, SOURCE.manifestName)) return bytesResponse(manifestBytes);
  if (url === exactDownloadUrl(tag, SOURCE.assetName)) return bytesResponse(decisionBytes);
  throw new Error(`unexpected public URL: ${url}`);
};
const privateMetadata = ({ assets = null, overrides = {} } = {}) => ({
  id: 777,
  name: "decision-v1",
  tag_name: tag,
  target_commitish: "b".repeat(40),
  draft: false,
  prerelease: false,
  assets: assets ?? [
    {
      id: 881,
      name: SOURCE.manifestName,
      state: "uploaded",
      size: manifestBytes.byteLength,
      digest: manifestRawDigest,
      content_type: "application/json",
      url: `https://api.github.com/repos/${SOURCE.repository}/releases/assets/881`,
    },
    {
      id: 882,
      name: SOURCE.assetName,
      state: "uploaded",
      size: decisionBytes.byteLength,
      digest: decisionRawDigest,
      content_type: "application/json",
      url: `https://api.github.com/repos/${SOURCE.repository}/releases/assets/882`,
    },
  ],
  ...overrides,
});
const privateFetch = async (url, init) => {
  const authorization = init.headers.get("authorization");
  if (url === latestWebUrl()) {
    assert.equal(authorization, null);
    return new Response(null, { status: 404 });
  }
  assert.equal(authorization, "Bearer secret");
  if (url === latestApiUrl()) return jsonResponse(privateMetadata());
  if (url.endsWith("/881")) return bytesResponse(manifestBytes);
  if (url.endsWith("/882")) return bytesResponse(decisionBytes);
  throw new Error(`unexpected private URL: ${url}`);
};
const uiAssets = {
  fetch: async () => new Response("<!doctype html><title>UI</title>", {
    headers: { "content-type": "text/html; charset=utf-8" },
  }),
};

test("root content negotiation distinguishes UI from semantic data", () => {
  assert.equal(wantsData(new Request("https://worker.invalid/", { headers: { accept: "text/html" } })), false);
  assert.equal(wantsData(new Request("https://worker.invalid/", { headers: { accept: "application/json" } })), true);
  assert.equal(wantsData(new Request("https://worker.invalid/", { headers: { accept: "application/x-ndjson" } })), true);
});

test("public current release is discovered by bounded web redirect", () => {
  assert.equal(
    parseLatestRedirect(`https://github.com/${SOURCE.repository}/releases/tag/${tag}`),
    tag,
  );
  assert.throws(
    () => parseLatestRedirect(`https://github.com/other/repo/releases/tag/${tag}`),
    error => error instanceof ProxyError && error.code === "RELEASE_REDIRECT",
  );
});

test("public current release validates manifest and decision without REST API", async () => {
  const current = await resolveCurrentPayload({
    env: { GITHUB_RELEASE_TOKEN: "configured-but-unused" },
    fetchImpl: publicFetch,
    cryptoScope: webcrypto,
  });
  assert.equal(current.locator, "github-web-latest");
  assert.equal(current.credentialUsed, false);
  assert.equal(current.releaseId, "decision-v1");
  assert.equal(current.releaseDigest, manifestDigest);
  assert.equal(current.sequence, 7);
  assert.equal(current.semanticDigest, decisionSemanticDigest);
  assert.equal(current.digest, decisionRawDigest);
  assert.deepEqual(Buffer.from(current.body), decisionBytes);
});

test("public root returns exact current bytes and provenance", async () => {
  const response = await handleRequest(
    new Request("https://worker.invalid/", { headers: { accept: "application/json" } }),
    { GITHUB_RELEASE_TOKEN: "configured-but-unused" },
    { fetchImpl: publicFetch, cryptoScope: webcrypto },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), decisionBytes);
  assert.equal(response.headers.get("x-gov-release-locator"), "github-web-latest");
  assert.equal(response.headers.get("x-gov-release-manifest-digest"), manifestDigest);
  assert.equal(response.headers.get("x-gov-release-semantic-digest"), decisionSemanticDigest);
  assert.equal(response.headers.get("x-gov-release-digest"), decisionRawDigest);
  assert.equal(response.headers.get("x-gov-release-upstream-auth"), "anonymous");
  assert.equal(response.headers.get("x-gov-release-numeric-id"), null);
});

test("manifest and accepted decision mismatches fail closed", async () => {
  const wrongManifest = { ...manifest, sequence: 8 };
  await assert.rejects(
    resolveCurrentPayload({
      fetchImpl: async url => {
        if (url === latestWebUrl()) return redirectResponse(`https://github.com/${SOURCE.repository}/releases/tag/${tag}`);
        if (url.includes(SOURCE.manifestName)) return bytesResponse(bytesOf(wrongManifest));
        return bytesResponse(decisionBytes);
      },
      cryptoScope: webcrypto,
    }),
    error => error instanceof ProxyError && error.code === "MANIFEST_DIGEST",
  );
  const wrongDecision = { ...decision, status: "rejected" };
  await assert.rejects(
    resolveCurrentPayload({
      fetchImpl: async url => {
        if (url === latestWebUrl()) return redirectResponse(`https://github.com/${SOURCE.repository}/releases/tag/${tag}`);
        if (url.includes(SOURCE.manifestName)) return bytesResponse(manifestBytes);
        return bytesResponse(bytesOf(wrongDecision));
      },
      cryptoScope: webcrypto,
    }),
    error => error instanceof ProxyError && error.code === "DECISION_DIGEST",
  );
});

test("private current release uses one server-side credential", async () => {
  const current = await resolveCurrentPayload({
    env: { GITHUB_RELEASE_TOKEN: "secret" },
    fetchImpl: privateFetch,
    cryptoScope: webcrypto,
  });
  assert.equal(current.locator, "github-api-latest");
  assert.equal(current.credentialUsed, true);
  assert.equal(current.releaseNumericId, 777);
  assert.equal(current.assetId, 882);
  assert.equal(current.targetCommit, "b".repeat(40));
  assert.equal(current.digest, decisionRawDigest);
});

test("private metadata requires exactly one valid manifest and decision", () => {
  const one = privateMetadata();
  assert.equal(normalizePrivateRelease(one).decision.id, 882);
  for (const value of [
    privateMetadata({ assets: [...one.assets, one.assets[1]] }),
    privateMetadata({ assets: one.assets.map(asset => asset.name === SOURCE.assetName ? { ...asset, digest: null } : asset) }),
    privateMetadata({ assets: one.assets.map(asset => asset.name === SOURCE.assetName ? { ...asset, content_type: "text/plain" } : asset) }),
    privateMetadata({ overrides: { tag_name: "other/v1" } }),
  ]) {
    assert.throws(() => normalizePrivateRelease(value), ProxyError);
  }
});

test("missing and insufficient private credentials remain explicit", async () => {
  await assert.rejects(
    resolveCurrentPayload({ fetchImpl: async () => new Response(null, { status: 404 }) }),
    error => error instanceof ProxyError && error.status === 401,
  );
  await assert.rejects(
    resolveCurrentPayload({
      env: { GITHUB_RELEASE_TOKEN: "secret" },
      fetchImpl: async url => url === latestWebUrl()
        ? new Response(null, { status: 404 })
        : jsonResponse({ message: "Not Found" }, 404),
    }),
    error => error instanceof ProxyError && error.status === 403,
  );
});

test("private raw asset tampering fails before semantic projection", async () => {
  const tampered = Buffer.from(decisionBytes);
  tampered[0] ^= 1;
  await assert.rejects(
    resolveCurrentPayload({
      env: { GITHUB_RELEASE_TOKEN: "secret" },
      fetchImpl: async url => {
        if (url === latestWebUrl()) return new Response(null, { status: 404 });
        if (url === latestApiUrl()) return jsonResponse(privateMetadata());
        if (url.endsWith("/881")) return bytesResponse(manifestBytes);
        return bytesResponse(tampered);
      },
      cryptoScope: webcrypto,
    }),
    error => error instanceof ProxyError && error.code === "DECISION_RAW_DIGEST",
  );
});

test("public web rate limits remain typed and fail closed", async () => {
  await assert.rejects(
    resolveCurrentPayload({
      fetchImpl: async () => new Response(null, { status: 429 }),
    }),
    error => error instanceof ProxyError && error.code === "UPSTREAM_RATE_LIMIT" && error.status === 503,
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

test("data HEAD resolves the same current release without returning a body", async () => {
  const response = await handleRequest(
    new Request("https://worker.invalid/", { method: "HEAD", headers: { accept: "application/json" } }),
    {},
    { fetchImpl: publicFetch, cryptoScope: webcrypto },
  );
  assert.equal(response.status, 200);
  assert.equal(response.body, null);
  assert.equal(response.headers.get("x-gov-release-id"), "decision-v1");
  assert.equal(response.headers.get("x-gov-release-sequence"), "7");
});
