import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^(?:sha256:)?[0-9a-f]{64}$/;
const FORBIDDEN_RECEIPT_KEYS = new Set([
  "secret",
  "secret_value",
  "plaintext",
  "private_key",
  "age_identity",
  "decrypted_value",
  "secret_hash",
]);
const FORBIDDEN_STRINGS = [
  /AGE-SECRET-KEY-1[0-9A-Z]{20,}/,
  /-----BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY-----/,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
];

export const SECRET_ENV_NAMES = Object.freeze([
  "JEV_API_KEY",
  "SOURCE_JEV_API_KEY",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "SOPS_AGE_KEY",
  "AGE_KEY_FILE",
  "ENVCTL_AUTH_BUNDLE",
  "GH_TOKEN",
  "GITHUB_TOKEN",
]);

export function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export function normalizeSha256(value, label = "sha256") {
  requireCondition(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase sha256 digest`);
  return value.startsWith("sha256:") ? value.slice(7) : value;
}

export function exactSha(value, label = "SHA") {
  requireCondition(typeof value === "string" && SHA40.test(value), `${label} must be an exact 40-character lowercase SHA`);
  return value;
}

export function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256File(file) {
  return sha256Bytes(readFileSync(file));
}

export function loadJson(file, label = "JSON") {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${label} is unreadable: ${error.message}`);
  }
}

export function assertNoPrivateMaterial(value, at = "$") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPrivateMaterial(item, `${at}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      requireCondition(!FORBIDDEN_RECEIPT_KEYS.has(key), `${at}: forbidden private field ${key}`);
      assertNoPrivateMaterial(item, `${at}.${key}`);
    }
    return;
  }
  if (typeof value === "string") {
    for (const pattern of FORBIDDEN_STRINGS) {
      requireCondition(!pattern.test(value), `${at}: forbidden private material`);
    }
  }
}

export function exactObjectKeys(value, expected, label) {
  requireCondition(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  requireCondition(actual.length === wanted.length && actual.every((key, index) => key === wanted[index]), `${label} fields differ`);
}

export function normalizedHttps(value, label) {
  const parsed = new URL(value);
  requireCondition(parsed.protocol === "https:" && !parsed.username && !parsed.password, `${label} must use credential-free https`);
  parsed.hash = "";
  return parsed.href;
}

export function sanitizedEnv(env) {
  // A denylist cannot enumerate future credentials or code-injection variables.
  const names = ["PATH", "LANG", "LC_ALL", "TZ", "CI", "PLAYWRIGHT_BROWSERS_PATH"];
  return Object.fromEntries(names.filter(name => typeof env[name] === "string")
    .map(name => [name, env[name]]));
}

export function effectEnv(env) {
  const result = sanitizedEnv(env);
  for (const name of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]) {
    if (typeof env[name] === "string" && env[name].length > 0) result[name] = env[name];
  }
  return result;
}

export function atomicJson(file, value) {
  assertNoPrivateMaterial(value);
  const target = path.resolve(file);
  const directory = path.dirname(target);
  mkdirSync(directory, { recursive: true });
  const temporaryDirectory = mkdtempSync(path.join(directory, ".voice-ui-target-runtime-"));
  const temporary = path.join(temporaryDirectory, "value.json");
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, target);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}
