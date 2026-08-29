import { CONFIG, SOURCE } from "./assets.mjs";

const GITHUB_API = "https://api.github.com";
const USER_AGENT = "roccho-dev-ops-gov-release-proxy/4";
const SAFE_METHODS = new Set(["GET", "HEAD"]);
const RELEASE_TAG = /^gov-release\/([A-Za-z0-9._-]+)\/([0-9a-f]{64})$/u;

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
  try {
    const result = await cryptoScope.subtle.digest("SHA-256", bytes);
    return `sha256:${hex(new Uint8Array(result))}`;
  } catch {
    throw new ProxyError("UPSTREAM_DIGEST_COMPUTE", 502, "Unable to calculate the upstream digest");
  }
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
const githubHeaders = ({ token = "", binary = false } = {}) => {
  const headers = new Headers({
    accept: binary ? "application/octet-stream" : "application/vnd.github+json",
    "user-agent": USER_AGENT,
    "x-github-api-version": "2022-11-28",
  });
  if (token) headers.set("authorization", `Bearer ${token}`);
  return headers;
};
const fetchGitHub = async ({ url, init, fetchImpl, code }) => {
  try {
    return await fetchImpl(url, init);
  } catch {
    throw new ProxyError(code, 502, "GitHub transport failed");
  }
};
const githubFailure = (response, { credentialUsed = false } = {}) => {
  if (response.status === 429 || response.headers.get("x-ratelimit-remaining") === "0") {
    throw new ProxyError("UPSTREAM_RATE_LIMIT", 503, "GitHub rate limit reached");
  }
  if (response.status === 401) {
    throw new ProxyError("AUTHENTICATION_REQUIRED", 401, "GitHub authentication is required");
  }
  if (response.status === 403 || (response.status === 404 && credentialUsed)) {
    throw new ProxyError("ACCESS_DENIED", 403, "GitHub access is denied");
  }
  if (response.status === 404) {
    throw new ProxyError("AUTHENTICATION_REQUIRED", 401, "The fixed source may require authentication");
  }
  throw new ProxyError("UPSTREAM_HTTP", 502, `GitHub request failed: ${response.status}`);
};
const parseJson = async response => {
  try {
    return await response.json();
  } catch {
    throw new ProxyError("UPSTREAM_JSON", 502, "GitHub returned invalid JSON");
  }
};

export const latestReleaseUrl = (source = SOURCE) => (
  `${GITHUB_API}/repos/${source.repository}/releases/latest`
);
export const wantsData = request => /application\/(?:x-ndjson|json)/iu.test(request.headers.get("accept") ?? "");

export const normalizeLatestRelease = (value, source = SOURCE) => {
  fail(value && typeof value === "object" && !Array.isArray(value),
    "RELEASE_INVALID", 502, "Latest release metadata must be an object");
  fail(Number.isSafeInteger(value.id) && value.id > 0,
    "RELEASE_INVALID", 502, "Latest release ID is invalid");
  fail(value.draft === false && value.prerelease === false,
    "RELEASE_INVALID", 502, "Latest release is not published current data");
  const tag = typeof value.tag_name === "string" ? value.tag_name : "";
  const tagMatch = RELEASE_TAG.exec(tag);
  fail(tagMatch, "RELEASE_TAG_INVALID", 502, "Latest release tag is outside the gov contract");
  const releaseId = tagMatch[1];
  fail(value.name === releaseId,
    "RELEASE_ID_INVALID", 502, "Release title does not match its stable release ID");
  fail(typeof value.target_commitish === "string" && /^[0-9a-f]{40}$/u.test(value.target_commitish),
    "RELEASE_COMMIT_INVALID", 502, "Release target is not an exact commit");
  fail(Array.isArray(value.assets),
    "RELEASE_ASSETS_INVALID", 502, "Release assets are missing");
  const matches = value.assets.filter(asset => asset?.name === source.assetName);
  fail(matches.length === 1,
    "RELEASE_ASSET_INVALID", 502, "Release must contain exactly one semantic source asset");
  const asset = matches[0];
  fail(Number.isSafeInteger(asset.id) && asset.id > 0 && asset.state === "uploaded",
    "RELEASE_ASSET_INVALID", 502, "Semantic source asset identity is invalid");
  fail(Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= source.maxBytes,
    "RELEASE_ASSET_SIZE", 502, "Semantic source asset size is invalid");
  fail(typeof asset.digest === "string" && /^sha256:[0-9a-f]{64}$/u.test(asset.digest),
    "RELEASE_ASSET_DIGEST", 502, "Semantic source asset digest is missing");
  fail(source.acceptedContentTypes.includes(asset.content_type),
    "RELEASE_ASSET_TYPE", 502, "Semantic source asset media type is invalid");
  fail(asset.url === `${GITHUB_API}/repos/${source.repository}/releases/assets/${asset.id}`,
    "RELEASE_ASSET_URL", 502, "Semantic source asset API URL is outside the fixed source");
  let downloadUrl;
  try { downloadUrl = new URL(asset.browser_download_url); }
  catch { throw new ProxyError("RELEASE_ASSET_URL", 502, "Semantic source download URL is invalid"); }
  fail(downloadUrl.protocol === "https:" && downloadUrl.host === "github.com",
    "RELEASE_ASSET_URL", 502, "Semantic source download host is invalid");
  fail(downloadUrl.pathname.startsWith(`/${source.repository}/releases/download/`),
    "RELEASE_ASSET_URL", 502, "Semantic source download path is outside the fixed source");

  return Object.freeze({
    repository: source.repository,
    releaseNumericId: value.id,
    releaseId,
    releaseDigest: `sha256:${tagMatch[2]}`,
    tag,
    targetCommit: value.target_commitish,
    assetId: asset.id,
    name: asset.name,
    bytes: asset.size,
    digest: asset.digest,
    contentType: asset.content_type,
    apiUrl: asset.url,
    downloadUrl: asset.browser_download_url,
  });
};

const requestLatest = async ({ token = "", fetchImpl = globalThis.fetch } = {}) => (
  fetchGitHub({
    url: latestReleaseUrl(),
    init: {
      method: "GET",
      headers: githubHeaders({ token }),
      redirect: "follow",
    },
    fetchImpl,
    code: "RELEASE_METADATA_FETCH",
  })
);

export const resolveCurrentAsset = async ({ env = {}, fetchImpl = globalThis.fetch } = {}) => {
  const token = String(env.GITHUB_RELEASE_TOKEN ?? "");
  let response = await requestLatest({ fetchImpl });
  let credentialUsed = false;
  if (response.status === 404 && token) {
    response = await requestLatest({ token, fetchImpl });
    credentialUsed = true;
  }
  if (!response.ok) githubFailure(response, { credentialUsed });
  const release = normalizeLatestRelease(await parseJson(response));
  return Object.freeze({ ...release, credentialUsed });
};

export const fetchAsset = async ({
  asset,
  env = {},
  fetchImpl = globalThis.fetch,
  cryptoScope = globalThis.crypto,
}) => {
  const token = String(env.GITHUB_RELEASE_TOKEN ?? "");
  fail(!asset.credentialUsed || token.length > 0,
    "UPSTREAM_CREDENTIAL_REQUIRED", 503, "A bounded GitHub read credential is required");
  const response = await fetchGitHub({
    url: asset.credentialUsed ? asset.apiUrl : asset.downloadUrl,
    init: {
      method: "GET",
      headers: githubHeaders({ token: asset.credentialUsed ? token : "", binary: true }),
      redirect: "follow",
    },
    fetchImpl,
    code: "RELEASE_ASSET_FETCH",
  });
  if (!response.ok) githubFailure(response, { credentialUsed: asset.credentialUsed });
  let bytes;
  try { bytes = await response.arrayBuffer(); }
  catch { throw new ProxyError("UPSTREAM_BODY", 502, "Unable to read the upstream body"); }
  fail(bytes.byteLength === asset.bytes,
    "UPSTREAM_BYTES", 502, `GitHub asset bytes mismatch: ${bytes.byteLength}`);
  const observedDigest = await digestBytes(bytes, cryptoScope);
  fail(observedDigest === asset.digest,
    "UPSTREAM_DIGEST", 502, `GitHub asset digest mismatch: ${observedDigest}`);
  return { bytes, observedDigest };
};

const assetHeaders = asset => ({
  "content-type": `${asset.contentType}; charset=utf-8`,
  "content-length": String(asset.bytes),
  "cache-control": "private, no-store",
  "vary": "Accept",
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-gov-release-selector": SOURCE.releaseSelector,
  "x-gov-release-repository": asset.repository,
  "x-gov-release-id": asset.releaseId,
  "x-gov-release-numeric-id": String(asset.releaseNumericId),
  "x-gov-release-tag": asset.tag,
  "x-gov-release-commit": asset.targetCommit,
  "x-gov-release-asset": asset.name,
  "x-gov-release-asset-id": String(asset.assetId),
  "x-gov-release-digest": asset.digest,
  "x-gov-release-upstream-auth": asset.credentialUsed ? "credential" : "anonymous",
});

const serveUi = async (request, env) => {
  fail(env.ASSETS && typeof env.ASSETS.fetch === "function",
    "UI_NOT_CONFIGURED", 503, "UI assets are not configured");
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

  const asset = await resolveCurrentAsset({
    env,
    fetchImpl: context.fetchImpl ?? globalThis.fetch,
  });
  if (request.method === "HEAD") {
    return new Response(null, { status: 200, headers: assetHeaders(asset) });
  }
  const loaded = await fetchAsset({
    asset,
    env,
    fetchImpl: context.fetchImpl ?? globalThis.fetch,
    cryptoScope: context.cryptoScope ?? globalThis.crypto,
  });
  return new Response(loaded.bytes, { status: 200, headers: assetHeaders(asset) });
};

const worker = {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env, { executionContext: ctx });
    } catch (error) {
      if (error instanceof ProxyError) {
        return json({ schema: "ops.govReleaseProxyError/1", status: "FAIL", code: error.code },
          error.status, { allow: "GET, HEAD" });
      }
      console.error(error);
      return json({ schema: "ops.govReleaseProxyError/1", status: "FAIL", code: "UNEXPECTED" }, 500);
    }
  },
};

export { CONFIG };
export default worker;
