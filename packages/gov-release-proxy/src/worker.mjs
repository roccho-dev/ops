import {
  CONFIG,
  PRIVATE_FIXTURE_BINDING,
  PRIVATE_FIXTURE_ROOT_ASSET,
  PUBLIC_BINDING,
  PUBLIC_ROOT_ASSET,
  assetForBinding,
  bindingFromEnv,
  configFor,
  privateFixtureEnabled,
  rootAssetFor,
} from "./assets.mjs";
import { BindingError } from "./binding.mjs";

const GITHUB_API = "https://api.github.com";
const USER_AGENT = "roccho-dev-ops-gov-release-proxy/4";
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

export const selectedBinding = env => bindingFromEnv(env);
export const githubAuthRequired = asset => asset.requiresCredential;
export const selectedRootAsset = env => assetForBinding(selectedBinding(env));
export const availableAssets = env => Object.freeze({ "/": selectedRootAsset(env) });
export const resolveAsset = (pathname, env = {}) => pathname === "/" ? selectedRootAsset(env) : null;
export const upstreamUrl = asset => asset.requiresCredential
  ? `${GITHUB_API}/repos/${asset.repository}/releases/assets/${asset.assetId}`
  : asset.downloadUrl;
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
  });
  if (credentialRequired) {
    headers.set("authorization", `Bearer ${token}`);
    headers.set("x-github-api-version", "2022-11-28");
  }
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

const bindingHeaders = binding => ({
  "x-gov-map-binding": binding.bindingId,
  "x-gov-claim-ceiling": binding.claimCeiling,
  "x-gov-production-cutover": "false",
  ...(binding.ui === null ? {} : {
    "x-gov-ui-commit": binding.ui.artifactCommit,
    "x-gov-ui-profile": binding.ui.profileId,
    "x-gov-ui-html-digest": binding.ui.htmlDigest,
    "x-gov-ui-meaning-digest": binding.ui.meaningDigest,
  }),
});

const assetHeaders = (asset, credentialUsed, binding) => ({
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
  ...bindingHeaders(binding),
});

const serveUi = async (request, env, binding, cryptoScope = globalThis.crypto) => {
  fail(env.ASSETS && typeof env.ASSETS.fetch === "function", "UI_NOT_CONFIGURED", 503, "UI assets are not configured");
  const response = await env.ASSETS.fetch(request);
  fail(response.ok, "UI_HTTP", 502, `UI asset fetch failed: ${response.status}`);
  const headers = new Headers(response.headers);
  headers.set("cache-control", "public, max-age=300");
  headers.set("vary", "Accept");
  headers.set("x-content-type-options", "nosniff");
  for (const [name, value] of Object.entries(bindingHeaders(binding))) headers.set(name, value);

  if (request.method === "HEAD" || binding.ui === null) {
    return new Response(request.method === "HEAD" ? null : response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  fail(/^text\/html(?:;|$)/iu.test(headers.get("content-type") ?? ""), "UI_CONTENT_TYPE", 502, "UI asset content type mismatch");
  const bytes = await response.arrayBuffer();
  fail(bytes.byteLength === binding.ui.htmlBytes, "UI_BYTES", 502, `UI asset bytes mismatch: ${bytes.byteLength}`);
  const observedDigest = await digestBytes(bytes, cryptoScope);
  fail(observedDigest === binding.ui.htmlDigest, "UI_DIGEST", 502, `UI asset digest mismatch: ${observedDigest}`);
  const text = new TextDecoder().decode(bytes);
  fail(text.includes(binding.ui.meaningDigest), "UI_MEANING_IDENTITY", 502, "UI asset does not contain the bound meaning digest");
  headers.set("content-length", String(bytes.byteLength));
  return new Response(bytes, {
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

  const binding = selectedBinding(env);
  if (!wantsData(request)) return serveUi(request, env, binding, context.cryptoScope ?? globalThis.crypto);

  const asset = assetForBinding(binding);
  if (request.method === "HEAD") {
    return new Response(null, {
      status: 200,
      headers: assetHeaders(asset, githubAuthRequired(asset), binding),
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
    headers: assetHeaders(asset, loaded.credentialUsed, binding),
  });
};

const worker = {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env, { executionContext: ctx });
    } catch (error) {
      if (error instanceof ProxyError || error instanceof BindingError) {
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

export {
  CONFIG,
  PRIVATE_FIXTURE_BINDING,
  PRIVATE_FIXTURE_ROOT_ASSET,
  PUBLIC_BINDING,
  PUBLIC_ROOT_ASSET,
  configFor,
  privateFixtureEnabled,
  rootAssetFor,
};
export default worker;
