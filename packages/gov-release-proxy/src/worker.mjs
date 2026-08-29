import {
  CONFIG,
  PRIVATE_FIXTURE_ROOT_ASSET,
  PUBLIC_ROOT_ASSET,
  configFor,
  rootAssetFor,
} from "./assets.mjs";

const GITHUB_API = "https://api.github.com";
const USER_AGENT = "roccho-dev-ops-gov-release-proxy/3";
const SAFE_METHODS = new Set(["GET", "HEAD"]);

export class ProxyError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = "ProxyError";
    this.code = code;
    this.status = status;
  }
}

const fail = (condition, code, status, message) => {
  if (!condition) throw new ProxyError(code, status, message);
};
const enabled = value => value === true || value === "true" || value === "1";
const hex = bytes => [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
const digestBytes = async (bytes, cryptoScope = globalThis.crypto) => {
  const result = await cryptoScope.subtle.digest("SHA-256", bytes);
  return `sha256:${hex(new Uint8Array(result))}`;
};
const json = (value, status = 200, headers = {}) => new Response(`${JSON.stringify(value)}\n`, {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "private, no-store",
    "vary": "Accept",
    "x-content-type-options": "nosniff",
    ...headers,
  },
});

export const privateFixtureEnabled = env => enabled(env.ENABLE_PRIVATE_FIXTURE);
export const githubAuthRequired = asset => asset.requiresCredential;
export const selectedRootAsset = env => rootAssetFor({ privateFixtureEnabled: privateFixtureEnabled(env) });
export const availableAssets = env => Object.freeze({ "/": selectedRootAsset(env) });
export const resolveAsset = (pathname, env = {}) => pathname === "/" ? selectedRootAsset(env) : null;
export const upstreamUrl = asset => `${GITHUB_API}/repos/${asset.repository}/releases/assets/${asset.assetId}`;
export const wantsData = request => /application\/(?:x-ndjson|json)/iu.test(request.headers.get("accept") ?? "");

export const fetchAsset = async ({
  asset,
  env = {},
  fetchImpl = globalThis.fetch,
  cryptoScope = globalThis.crypto,
}) => {
  const token = String(env.GITHUB_RELEASE_TOKEN ?? "");
  const credentialRequired = githubAuthRequired(asset);
  fail(!credentialRequired || token.length > 0,
    "UPSTREAM_CREDENTIAL_REQUIRED", 503, "A bounded GitHub read credential is required");

  const headers = new Headers({
    accept: "application/octet-stream",
    "user-agent": USER_AGENT,
    "x-github-api-version": "2022-11-28",
  });
  if (credentialRequired) headers.set("authorization", `Bearer ${token}`);
  const response = await fetchImpl(upstreamUrl(asset), {
    method: "GET",
    headers,
    redirect: "follow",
  });
  if (response.status === 401) throw new ProxyError("AUTHENTICATION_REQUIRED", 401, "GitHub authentication is required");
  if (response.status === 403) throw new ProxyError("ACCESS_DENIED", 403, "GitHub access is denied");
  fail(response.ok, "UPSTREAM_HTTP", 502, `GitHub asset fetch failed: ${response.status}`);
  const bytes = await response.arrayBuffer();
  fail(bytes.byteLength === asset.bytes,
    "UPSTREAM_BYTES", 502, `GitHub asset bytes mismatch: ${bytes.byteLength}`);
  const observedDigest = await digestBytes(bytes, cryptoScope);
  fail(observedDigest === asset.digest,
    "UPSTREAM_DIGEST", 502, `GitHub asset digest mismatch: ${observedDigest}`);
  return { bytes, observedDigest, credentialUsed: credentialRequired };
};

const assetHeaders = (asset, credentialUsed) => ({
  "content-type": asset.contentType,
  "content-length": String(asset.bytes),
  "cache-control": "private, no-store",
  "vary": "Accept",
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-gov-release-repository": asset.repository,
  "x-gov-release-tag": asset.tag,
  "x-gov-release-asset": asset.name,
  "x-gov-release-digest": asset.digest,
  "x-gov-release-upstream-auth": credentialUsed ? "credential" : "anonymous",
});

const serveUi = async (request, env) => {
  fail(env.ASSETS && typeof env.ASSETS.fetch === "function", "UI_NOT_CONFIGURED", 503, "UI assets are not configured");
  const response = await env.ASSETS.fetch(request);
  const headers = new Headers(response.headers);
  headers.set("cache-control", "public, max-age=300");
  headers.set("vary", "Accept");
  headers.set("x-content-type-options", "nosniff");
  return new Response(request.method === "HEAD" ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export const handleRequest = async (request, env = {}, context = {}) => {
  fail(SAFE_METHODS.has(request.method), "METHOD_NOT_ALLOWED", 405, "Only GET and HEAD are allowed");
  const url = new URL(request.url);
  fail(url.pathname === "/", "NOT_FOUND", 404, "Only the root endpoint exists");
  fail(url.search === "" && url.hash === "", "URL_UNSAFE", 400, "Query and fragment are not accepted");

  if (!wantsData(request)) return serveUi(request, env);

  const asset = selectedRootAsset(env);
  if (request.method === "HEAD") {
    return new Response(null, {
      status: 200,
      headers: assetHeaders(asset, githubAuthRequired(asset)),
    });
  }
  const loaded = await fetchAsset({
    asset,
    env,
    fetchImpl: context.fetchImpl ?? globalThis.fetch,
    cryptoScope: context.cryptoScope ?? globalThis.crypto,
  });
  return new Response(loaded.bytes, {
    status: 200,
    headers: assetHeaders(asset, loaded.credentialUsed),
  });
};

const worker = {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env, { executionContext: ctx });
    } catch (error) {
      if (error instanceof ProxyError) {
        return json({
          schema: "ops.govReleaseProxyError/1",
          status: "FAIL",
          code: error.code,
        }, error.status, { allow: "GET, HEAD" });
      }
      console.error(error);
      return json({
        schema: "ops.govReleaseProxyError/1",
        status: "FAIL",
        code: "UNEXPECTED",
      }, 500);
    }
  },
};

export { CONFIG, PRIVATE_FIXTURE_ROOT_ASSET, PUBLIC_ROOT_ASSET, configFor };
export default worker;
