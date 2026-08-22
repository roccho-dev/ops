import { canonicalJson } from "./canonical.mjs";

export const MAX_URL_MODULE_CHARS = 8_192;
export const MAX_URL_MODULE_COMPRESSED_BYTES = 64 * 1_024;
export const MAX_URL_MODULE_EXPANDED_BYTES = 256 * 1_024;

const invariant = (condition, message) => { if (!condition) throw new Error(`url-module: ${message}`); };
const fragmentPattern = /^[a-z][a-z0-9-]{0,31}$/u;

const validateFragment = fragment => {
  invariant(typeof fragment === "string" && fragmentPattern.test(fragment), "fragment name is invalid");
  return fragment;
};

const base64UrlEncode = bytes => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
};

const base64UrlDecode = input => {
  invariant(typeof input === "string" && input.length > 0, "token is empty");
  invariant(/^[A-Za-z0-9_-]+$/u.test(input), "token is not base64url");
  const normalized = input.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  let binary;
  try {
    binary = atob(padded);
  } catch (_) {
    throw new Error("url-module: token is not base64url");
  }
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  invariant(bytes.byteLength <= MAX_URL_MODULE_COMPRESSED_BYTES, `compressed payload exceeds ${MAX_URL_MODULE_COMPRESSED_BYTES} bytes`);
  return bytes;
};

const collect = async (stream, maximum, label) => {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      invariant(total <= maximum, `${label} exceeds ${maximum} bytes`);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
};

const gzip = async bytes => {
  invariant(typeof CompressionStream === "function", "gzip compression is unavailable");
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return collect(stream, MAX_URL_MODULE_COMPRESSED_BYTES, "compressed payload");
};

const gunzip = async bytes => {
  invariant(typeof DecompressionStream === "function", "gzip decompression is unavailable");
  let stream;
  try {
    stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  } catch (_) {
    throw new Error("url-module: gzip payload is invalid");
  }
  try {
    return await collect(stream, MAX_URL_MODULE_EXPANDED_BYTES, "expanded payload");
  } catch (error) {
    if (String(error.message).startsWith("url-module:")) throw error;
    throw new Error("url-module: gzip payload is invalid");
  }
};

export const assertUrlModuleWithinLimit = input => {
  const value = String(input);
  invariant(value.length <= MAX_URL_MODULE_CHARS, `URL exceeds ${MAX_URL_MODULE_CHARS} characters`);
  return value;
};

export const encodeUrlModule = async value => {
  const source = new TextEncoder().encode(canonicalJson(value));
  invariant(source.byteLength <= MAX_URL_MODULE_EXPANDED_BYTES, `expanded payload exceeds ${MAX_URL_MODULE_EXPANDED_BYTES} bytes`);
  return base64UrlEncode(await gzip(source));
};

export const decodeUrlModule = async token => {
  const source = await gunzip(base64UrlDecode(token));
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(source));
  } catch (_) {
    throw new Error("url-module: payload JSON is invalid");
  }
};

const fragmentFromInput = input => {
  const value = String(input ?? "");
  if (!value) return "";
  if (value.startsWith("#")) {
    assertUrlModuleWithinLimit(value);
    return value;
  }
  let url;
  try {
    const relative = value.startsWith("/") || value.startsWith("./") || value.startsWith("../");
    url = relative ? new URL(value, "https://url-module.invalid/") : new URL(value);
  } catch (_) {
    throw new Error("url-module: URL is invalid");
  }
  assertUrlModuleWithinLimit(url.href);
  return url.hash;
};

const fragmentFields = hash => {
  if (!hash) return new URLSearchParams();
  invariant(hash.startsWith("#"), "fragment is invalid");
  const params = new URLSearchParams(hash.slice(1));
  for (const key of new Set(params.keys())) {
    validateFragment(key);
    invariant(params.getAll(key).length === 1, `fragment field is duplicated: ${key}`);
  }
  return params;
};

export const createUrlModuleFieldsUrl = async ({ base, fields }) => {
  invariant(fields && typeof fields === "object" && !Array.isArray(fields), "fields must be an object");
  const url = new URL(String(base));
  const params = new URLSearchParams();
  for (const key of Object.keys(fields).sort()) {
    validateFragment(key);
    invariant(fields[key] !== undefined && fields[key] !== null, `field value is missing: ${key}`);
    params.set(key, await encodeUrlModule(fields[key]));
  }
  invariant([...params.keys()].length > 0, "at least one fragment field is required");
  url.hash = params.toString();
  return assertUrlModuleWithinLimit(url.href);
};

export const createUrlModuleUrl = async ({ base, fragment = "module", value }) => createUrlModuleFieldsUrl({ base, fields: { [fragment]: value } });

export const readUrlModuleToken = ({ fragment = "module", input = globalThis.location?.href ?? "" } = {}) => {
  validateFragment(fragment);
  const params = fragmentFields(fragmentFromInput(input));
  const values = params.getAll(fragment);
  invariant(values.length <= 1, `fragment field is duplicated: ${fragment}`);
  return values.length === 0 ? null : values[0];
};

export const readUrlModule = async options => {
  const token = readUrlModuleToken(options);
  return token === null ? null : decodeUrlModule(token);
};
