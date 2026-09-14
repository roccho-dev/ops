import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";

export const GATE_ID = "uiops-207-377-exact-tree-set/1";
export const INPUT_SCHEMA = "uiops-207-377-exact-tree-set.input/2";
export const PROVIDER_SNAPSHOT_SCHEMA = "uiops.github-provider-snapshot/1";
export const UI_PUBLICATION_RECEIPT_SCHEMA = "ui.policy-app-publication.receipt/1";
export const OPS_CONSUMER_RECEIPT_SCHEMA = "ops.policy-app-consumer.receipt/1";
export const RECEIPT_SCHEMA = "uiops-207-377-exact-tree-set.receipt/2";
export const RECEIPT_BASENAME = "uiops-207-377-exact-tree-set.receipt.json";

const SHA1 = /^[0-9a-f]{40}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const HTTPS = /^https:\/\//u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;
const REQUIRED_OPTIONS = [
  "--input",
  "--mobile-agent-root",
  "--ops-consumer-receipt",
  "--ops-root",
  "--provider-snapshot",
  "--ui-artifact",
  "--ui-publication-receipt",
  "--ui-root",
  "--work-root",
];

export function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return `${JSON.stringify(canonicalValue(value))}\n`;
}

export function assertCanonicalJsonBytes(bytes, value, label) {
  assert.equal(bytes.toString("utf8"), canonicalJson(value), `${label} must use canonical JSON`);
}

export function object(value, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value;
}

export function array(value, label) {
  assert(Array.isArray(value), `${label} must be an array`);
  return value;
}

export function exactKeys(value, expected, label) {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label} fields changed`);
}

export function sha1(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.match(value, SHA1, `${label} must be a 40-character lowercase Git SHA`);
}

export function digest(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.match(value, SHA256, `${label} must be a sha256 digest`);
}

export function nonEmpty(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert(value.length > 0, `${label} must not be empty`);
}

export function httpsUrl(value, label) {
  nonEmpty(value, label);
  assert.match(value, HTTPS, `${label} must be an https URL`);
}

export function timestamp(value, label) {
  nonEmpty(value, label);
  assert.match(value, TIMESTAMP, `${label} must be an RFC3339 UTC timestamp`);
}

export function positiveInteger(value, label) {
  assert(Number.isInteger(value) && value > 0, `${label} must be a positive integer`);
}

export function nonNegativeInteger(value, label) {
  assert(Number.isInteger(value) && value >= 0, `${label} must be a non-negative integer`);
}

export function boolean(value, label) {
  assert.equal(typeof value, "boolean", `${label} must be a boolean`);
}

export function validateCommitTree(value, label, commitKey = "commit", treeKey = "tree") {
  const row = object(value, label);
  exactKeys(row, [commitKey, treeKey], label);
  sha1(row[commitKey], `${label}.${commitKey}`);
  sha1(row[treeKey], `${label}.${treeKey}`);
  return row;
}


export function parseCli(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    assert(REQUIRED_OPTIONS.includes(option), `unknown CLI option: ${option ?? "missing"}`);
    assert(value && !value.startsWith("--"), `missing value for ${option}`);
    assert(!values.has(option), `duplicate CLI option: ${option}`);
    values.set(option, value);
  }
  for (const option of REQUIRED_OPTIONS) assert(values.has(option), `missing CLI option: ${option}`);
  return Object.fromEntries(REQUIRED_OPTIONS.map((option) => [
    option.slice(2).replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase()),
    resolve(values.get(option)),
  ]));
}

function isWithin(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function assertExternalFreshWorkRoot(workRoot, repoRoots) {
  for (const [name, root] of Object.entries(repoRoots)) {
    assert(!isWithin(root, workRoot), `work root must be outside ${name} repository`);
  }
}
