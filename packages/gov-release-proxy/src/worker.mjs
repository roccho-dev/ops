import { CONFIG, SOURCE } from "./assets.mjs";

const GITHUB_WEB = "https://github.com";
const GITHUB_API = "https://api.github.com";
const USER_AGENT = "roccho-dev-ops-gov-release-proxy/5";
const SAFE_METHODS = new Set(["GET", "HEAD"]);
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const RELEASE_TAG = /^gov-release\/([A-Za-z0-9._-]+)\/([0-9a-f]{64})$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;

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
    throw new ProxyError("DIGEST_COMPUTE", 502, "Unable to calculate a digest");
  }
};
const canonicalJson = value => {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    fail(Number.isFinite(value), "JSON_CANONICAL_INVALID", 502, "JSON contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  fail(typeof value === "object", "JSON_CANONICAL_INVALID", 502, "JSON contains an unsupported value");
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
};
const canonicalDigest = async (value, cryptoScope = globalThis.crypto) => (
  digestBytes(new TextEncoder().encode(canonicalJson(value)), cryptoScope)
);
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
  });
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
    headers.set("x-github-api-version", "2022-11-28");
  }
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
const readBytes = async (response, maximum, code) => {
  const declared = Number(response.headers.get("content-length") ?? 0);
  fail(!Number.isFinite(declared) || declared <= maximum,
    `${code}_SIZE`, 502, "GitHub response exceeds the bounded size");
  let bytes;
  try { bytes = await response.arrayBuffer(); }
  catch { throw new ProxyError(`${code}_BODY`, 502, "Unable to read the GitHub response"); }
  fail(bytes.byteLength > 0 && bytes.byteLength <= maximum,
    `${code}_SIZE`, 502, "GitHub response size is invalid");
  return bytes;
};
const parseJsonBytes = (bytes, code) => {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text);
  } catch {
    throw new ProxyError(code, 502, "GitHub returned invalid UTF-8 JSON");
  }
};
const validateTag = tag => {
  const match = RELEASE_TAG.exec(tag);
  fail(match, "RELEASE_TAG_INVALID", 502, "Current release tag is outside the gov contract");
  return Object.freeze({ releaseId: match[1], releaseDigest: `sha256:${match[2]}` });
};
const validateManifest = async ({ manifest, tag, cryptoScope }) => {
  fail(manifest && typeof manifest === "object" && !Array.isArray(manifest),
    "MANIFEST_INVALID", 502, "Release manifest must be an object");
  const identity = validateTag(tag);
  fail(manifest.kind === "govReleaseManifest.v1", "MANIFEST_KIND", 502, "Release manifest kind is invalid");
  fail(manifest.status === "adopted", "MANIFEST_STATUS", 502, "Release manifest is not adopted");
  fail(manifest.releaseId === identity.releaseId,
    "MANIFEST_RELEASE_ID", 502, "Release manifest ID does not match the tag");
  fail(Number.isSafeInteger(manifest.sequence) && manifest.sequence >= 0,
    "MANIFEST_SEQUENCE", 502, "Release manifest sequence is invalid");
  fail(typeof manifest.acceptedDecisionDigest === "string" && SHA256.test(manifest.acceptedDecisionDigest),
    "MANIFEST_DECISION_DIGEST", 502, "Release manifest decision digest is invalid");
  const observed = await canonicalDigest(manifest, cryptoScope);
  fail(observed === identity.releaseDigest,
    "MANIFEST_DIGEST", 502, "Release manifest digest does not match the current tag");
  return Object.freeze({ ...identity, sequence: manifest.sequence, acceptedDecisionDigest: manifest.acceptedDecisionDigest });
};
const validateDecision = async ({ decision, manifestIdentity, cryptoScope }) => {
  fail(decision && typeof decision === "object" && !Array.isArray(decision),
    "DECISION_INVALID", 502, "Accepted decision must be an object");
  const observed = await canonicalDigest(decision, cryptoScope);
  fail(observed === manifestIdentity.acceptedDecisionDigest,
    "DECISION_DIGEST", 502, "Accepted decision digest does not match the release manifest");
  return observed;
};

export const latestWebUrl = (source = SOURCE) => `${GITHUB_WEB}/${source.repository}/releases/latest`;
export const latestApiUrl = (source = SOURCE) => `${GITHUB_API}/repos/${source.repository}/releases/latest`;
export const exactDownloadUrl = (tag, name, source = SOURCE) => (
  `${GITHUB_WEB}/${source.repository}/releases/download/${tag}/${name}`
);
export const wantsData = request => /application\/(?:x-ndjson|json)/iu.test(request.headers.get("accept") ?? "");

export const parseLatestRedirect = (location, source = SOURCE) => {
  let target;
  try { target = new URL(location, latestWebUrl(source)); }
  catch { throw new ProxyError("RELEASE_REDIRECT", 502, "Current release redirect is invalid"); }
  const prefix = `/${source.repository}/releases/tag/`;
  fail(target.protocol === "https:" && target.host === "github.com" && target.pathname.startsWith(prefix),
    "RELEASE_REDIRECT", 502, "Current release redirect is outside the fixed repository");
  let tag;
  try { tag = decodeURIComponent(target.pathname.slice(prefix.length)); }
  catch { throw new ProxyError("RELEASE_REDIRECT", 502, "Current release tag encoding is invalid"); }
  validateTag(tag);
  return tag;
};

const discoverPublicTag = async ({ fetchImpl = globalThis.fetch } = {}) => {
  const response = await fetchGitHub({
    url: latestWebUrl(),
    init: {
      method: "HEAD",
      headers: new Headers({ "user-agent": USER_AGENT }),
      redirect: "manual",
    },
    fetchImpl,
    code: "RELEASE_CURRENT_FETCH",
  });
  if (response.status === 404) return null;
  if (!REDIRECTS.has(response.status)) githubFailure(response);
  const location = response.headers.get("location");
  fail(location, "RELEASE_REDIRECT", 502, "Current release redirect is missing");
  return parseLatestRedirect(location);
};

const fetchPublicFile = async ({ tag, name, maximum, fetchImpl, code }) => {
  const response = await fetchGitHub({
    url: exactDownloadUrl(tag, name),
    init: {
      method: "GET",
      headers: new Headers({ "user-agent": USER_AGENT }),
      redirect: "follow",
    },
    fetchImpl,
    code: `${code}_FETCH`,
  });
  if (!response.ok) githubFailure(response);
  return readBytes(response, maximum, code);
};

export const normalizePrivateRelease = (value, source = SOURCE) => {
  fail(value && typeof value === "object" && !Array.isArray(value),
    "RELEASE_INVALID", 502, "Latest release metadata must be an object");
  fail(Number.isSafeInteger(value.id) && value.id > 0 && value.draft === false && value.prerelease === false,
    "RELEASE_INVALID", 502, "Latest release identity is invalid");
  const tag = typeof value.tag_name === "string" ? value.tag_name : "";
  const identity = validateTag(tag);
  fail(value.name === identity.releaseId,
    "RELEASE_ID_INVALID", 502, "Release title does not match its stable ID");
  fail(typeof value.target_commitish === "string" && /^[0-9a-f]{40}$/u.test(value.target_commitish),
    "RELEASE_COMMIT_INVALID", 502, "Release target is not an exact commit");
  fail(Array.isArray(value.assets), "RELEASE_ASSETS_INVALID", 502, "Release assets are missing");
  const select = (name, maximum, acceptedTypes) => {
    const matches = value.assets.filter(asset => asset?.name === name);
    fail(matches.length === 1, "RELEASE_ASSET_INVALID", 502, `Release must contain exactly one ${name}`);
    const asset = matches[0];
    fail(Number.isSafeInteger(asset.id) && asset.id > 0 && asset.state === "uploaded",
      "RELEASE_ASSET_INVALID", 502, `${name} identity is invalid`);
    fail(Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= maximum,
      "RELEASE_ASSET_SIZE", 502, `${name} size is invalid`);
    fail(typeof asset.digest === "string" && SHA256.test(asset.digest),
      "RELEASE_ASSET_DIGEST", 502, `${name} digest is invalid`);
    fail(acceptedTypes.includes(asset.content_type),
      "RELEASE_ASSET_TYPE", 502, `${name} media type is invalid`);
    const apiUrl = `${GITHUB_API}/repos/${source.repository}/releases/assets/${asset.id}`;
    fail(asset.url === apiUrl, "RELEASE_ASSET_URL", 502, `${name} API URL is outside the fixed source`);
    return Object.freeze({ id: asset.id, name, bytes: asset.size, digest: asset.digest, contentType: asset.content_type, apiUrl });
  };
  return Object.freeze({
    repository: source.repository,
    releaseNumericId: value.id,
    tag,
    targetCommit: value.target_commitish,
    ...identity,
    manifest: select(source.manifestName, source.maxManifestBytes, ["application/json"]),
    decision: select(source.assetName, source.maxBytes, source.acceptedContentTypes),
  });
};

const fetchPrivateFile = async ({ asset, token, maximum, fetchImpl, code, cryptoScope }) => {
  const response = await fetchGitHub({
    url: asset.apiUrl,
    init: {
      method: "GET",
      headers: githubHeaders({ token, binary: true }),
      redirect: "follow",
    },
    fetchImpl,
    code: `${code}_FETCH`,
  });
  if (!response.ok) githubFailure(response, { credentialUsed: true });
  const bytes = await readBytes(response, maximum, code);
  const observed = await digestBytes(bytes, cryptoScope);
  fail(observed === asset.digest, `${code}_RAW_DIGEST`, 502, `${asset.name} raw digest does not match GitHub metadata`);
  return bytes;
};

const resolvePublicPayload = async ({ tag, fetchImpl, cryptoScope }) => {
  const manifestBytes = await fetchPublicFile({
    tag,
    name: SOURCE.manifestName,
    maximum: SOURCE.maxManifestBytes,
    fetchImpl,
    code: "MANIFEST",
  });
  const manifest = parseJsonBytes(manifestBytes, "MANIFEST_JSON");
  const manifestIdentity = await validateManifest({ manifest, tag, cryptoScope });
  const decisionBytes = await fetchPublicFile({
    tag,
    name: SOURCE.assetName,
    maximum: SOURCE.maxBytes,
    fetchImpl,
    code: "DECISION",
  });
  const decision = parseJsonBytes(decisionBytes, "DECISION_JSON");
  const semanticDigest = await validateDecision({ decision, manifestIdentity, cryptoScope });
  return Object.freeze({
    repository: SOURCE.repository,
    locator: "github-web-latest",
    tag,
    releaseId: manifestIdentity.releaseId,
    releaseDigest: manifestIdentity.releaseDigest,
    sequence: manifestIdentity.sequence,
    targetCommit: null,
    releaseNumericId: null,
    assetId: null,
    name: SOURCE.assetName,
    bytes: decisionBytes.byteLength,
    digest: await digestBytes(decisionBytes, cryptoScope),
    semanticDigest,
    contentType: "application/json",
    credentialUsed: false,
    body: decisionBytes,
  });
};

const resolvePrivatePayload = async ({ token, fetchImpl, cryptoScope }) => {
  const metadata = await fetchGitHub({
    url: latestApiUrl(),
    init: {
      method: "GET",
      headers: githubHeaders({ token }),
      redirect: "follow",
    },
    fetchImpl,
    code: "RELEASE_METADATA_FETCH",
  });
  if (!metadata.ok) githubFailure(metadata, { credentialUsed: true });
  let releaseValue;
  try { releaseValue = await metadata.json(); }
  catch { throw new ProxyError("RELEASE_METADATA_JSON", 502, "GitHub returned invalid release metadata"); }
  const release = normalizePrivateRelease(releaseValue);
  const manifestBytes = await fetchPrivateFile({
    asset: release.manifest,
    token,
    maximum: SOURCE.maxManifestBytes,
    fetchImpl,
    code: "MANIFEST",
    cryptoScope,
  });
  const manifest = parseJsonBytes(manifestBytes, "MANIFEST_JSON");
  const manifestIdentity = await validateManifest({ manifest, tag: release.tag, cryptoScope });
  const decisionBytes = await fetchPrivateFile({
    asset: release.decision,
    token,
    maximum: SOURCE.maxBytes,
    fetchImpl,
    code: "DECISION",
    cryptoScope,
  });
  const decision = parseJsonBytes(decisionBytes, "DECISION_JSON");
  const semanticDigest = await validateDecision({ decision, manifestIdentity, cryptoScope });
  return Object.freeze({
    repository: release.repository,
    locator: "github-api-latest",
    tag: release.tag,
    releaseId: release.releaseId,
    releaseDigest: release.releaseDigest,
    sequence: manifestIdentity.sequence,
    targetCommit: release.targetCommit,
    releaseNumericId: release.releaseNumericId,
    assetId: release.decision.id,
    name: release.decision.name,
    bytes: decisionBytes.byteLength,
    digest: release.decision.digest,
    semanticDigest,
    contentType: release.decision.contentType,
    credentialUsed: true,
    body: decisionBytes,
  });
};

export const resolveCurrentPayload = async ({
  env = {},
  fetchImpl = globalThis.fetch,
  cryptoScope = globalThis.crypto,
} = {}) => {
  const tag = await discoverPublicTag({ fetchImpl });
  if (tag) return resolvePublicPayload({ tag, fetchImpl, cryptoScope });
  const token = String(env.GITHUB_RELEASE_TOKEN ?? "");
  fail(token.length > 0, "AUTHENTICATION_REQUIRED", 401, "The fixed source requires authentication");
  return resolvePrivatePayload({ token, fetchImpl, cryptoScope });
};

const assetHeaders = value => ({
  "content-type": `${value.contentType}; charset=utf-8`,
  "content-length": String(value.bytes),
  "cache-control": "private, no-store",
  "vary": "Accept",
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-gov-release-selector": SOURCE.releaseSelector,
  "x-gov-release-locator": value.locator,
  "x-gov-release-repository": value.repository,
  "x-gov-release-id": value.releaseId,
  "x-gov-release-tag": value.tag,
  "x-gov-release-sequence": String(value.sequence),
  "x-gov-release-manifest-digest": value.releaseDigest,
  "x-gov-release-asset": value.name,
  "x-gov-release-digest": value.digest,
  "x-gov-release-semantic-digest": value.semanticDigest,
  "x-gov-release-upstream-auth": value.credentialUsed ? "credential" : "anonymous",
  ...(value.targetCommit ? { "x-gov-release-commit": value.targetCommit } : {}),
  ...(value.releaseNumericId ? { "x-gov-release-numeric-id": String(value.releaseNumericId) } : {}),
  ...(value.assetId ? { "x-gov-release-asset-id": String(value.assetId) } : {}),
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

  const current = await resolveCurrentPayload({
    env,
    fetchImpl: context.fetchImpl ?? globalThis.fetch,
    cryptoScope: context.cryptoScope ?? globalThis.crypto,
  });
  return new Response(request.method === "HEAD" ? null : current.body, {
    status: 200,
    headers: assetHeaders(current),
  });
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
