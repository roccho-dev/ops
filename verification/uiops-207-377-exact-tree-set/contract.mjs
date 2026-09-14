import assert from "node:assert/strict";
import { isAbsolute, relative, resolve } from "node:path";

export const GATE_ID = "uiops-207-377-exact-tree-set/1";
export const INPUT_SCHEMA = "uiops-207-377-exact-tree-set.input/1";
export const RECEIPT_SCHEMA = "uiops-207-377-exact-tree-set.receipt/1";
export const RECEIPT_BASENAME = "uiops-207-377-exact-tree-set.receipt.json";

const SHA1 = /^[0-9a-f]{40}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const REQUIRED_OPTIONS = [
  "--input",
  "--mobile-agent-root",
  "--ops-receipt",
  "--ops-root",
  "--ui-artifact",
  "--ui-root",
  "--work-root",
];

function object(value, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value;
}

function exactKeys(value, expected, label) {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label} fields changed`);
}

function sha1(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.match(value, SHA1, `${label} must be a 40-character lowercase Git SHA`);
}

function digest(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.match(value, SHA256, `${label} must be a sha256 digest`);
}

function nonEmpty(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert(value.length > 0, `${label} must not be empty`);
}

function positiveInteger(value, label) {
  assert(Number.isInteger(value) && value > 0, `${label} must be a positive integer`);
}

function validateRepo(value, { label, repository, withBase = false, withPr = false }) {
  const row = object(value, label);
  for (const field of ["checkIdentity", "head", "repository", "tree"]) {
    assert(Object.hasOwn(row, field), `${label}.${field} is required`);
  }
  if (withBase) assert(Object.hasOwn(row, "base"), `${label}.base is required`);
  if (withPr) assert(Object.hasOwn(row, "pr"), `${label}.pr is required`);
  assert.equal(row.repository, repository, `${label}.repository mismatch`);
  sha1(row.head, `${label}.head`);
  sha1(row.tree, `${label}.tree`);
  if (withBase) sha1(row.base, `${label}.base`);
  if (withPr) positiveInteger(row.pr, `${label}.pr`);
  nonEmpty(row.checkIdentity, `${label}.checkIdentity`);
}

function validateVerifier(value, label, expectedPath) {
  const row = object(value, label);
  exactKeys(row, ["blob", "head", "path", "repository"], label);
  assert.equal(row.repository, "roccho-dev/ops", `${label}.repository mismatch`);
  assert.equal(row.path, expectedPath, `${label}.path mismatch`);
  sha1(row.head, `${label}.head`);
  sha1(row.blob, `${label}.blob`);
}

export function validateGateInput(value) {
  const input = object(value, "gate input");
  exactKeys(input, ["gate", "mobileAgent", "ops", "schema", "ui", "verifiers"], "gate input");
  assert.equal(input.schema, INPUT_SCHEMA, "gate input schema mismatch");
  assert.equal(input.gate, GATE_ID, "gate id mismatch");

  validateRepo(input.mobileAgent, {
    label: "mobileAgent",
    repository: "roccho-dev/mobile-agent",
  });

  validateRepo(input.ops, {
    label: "ops",
    repository: "roccho-dev/ops",
    withBase: true,
    withPr: true,
  });
  exactKeys(input.ops, [
    "base",
    "checkIdentity",
    "consumerReceiptDigest",
    "head",
    "policyAppContract",
    "pr",
    "repository",
    "tree",
  ], "ops");
  digest(input.ops.consumerReceiptDigest, "ops.consumerReceiptDigest");
  nonEmpty(input.ops.policyAppContract, "ops.policyAppContract");

  validateRepo(input.ui, {
    label: "ui",
    repository: "roccho-dev/ui",
    withBase: true,
    withPr: true,
  });
  exactKeys(input.ui, [
    "adapterContract",
    "artifactDigest",
    "base",
    "checkIdentity",
    "corePortContract",
    "head",
    "pr",
    "repository",
    "tree",
  ], "ui");
  digest(input.ui.artifactDigest, "ui.artifactDigest");
  nonEmpty(input.ui.corePortContract, "ui.corePortContract");
  nonEmpty(input.ui.adapterContract, "ui.adapterContract");

  const verifiers = object(input.verifiers, "verifiers");
  exactKeys(verifiers, ["gate", "presentationSharedVisual"], "verifiers");
  validateVerifier(
    verifiers.gate,
    "verifiers.gate",
    "verification/uiops-207-377-exact-tree-set/verify.mjs",
  );
  validateVerifier(
    verifiers.presentationSharedVisual,
    "verifiers.presentationSharedVisual",
    "verification/presentation-shared-visual/verify.mjs",
  );
  assert.equal(verifiers.gate.head, input.ops.head, "gate verifier head must equal ops head");
  assert.equal(
    verifiers.presentationSharedVisual.head,
    input.ops.head,
    "presentation verifier head must equal ops head",
  );
  return input;
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
