#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_OPTIONS = ["--mobile-agent-root", "--ui-root", "--work-root"];
function parseCli(argv) {
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
  return {
    mobile: resolve(values.get("--mobile-agent-root")),
    ui: resolve(values.get("--ui-root")),
    workRoot: resolve(values.get("--work-root")),
  };
}
function isWithin(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

const { mobile, ui, workRoot } = parseCli(process.argv.slice(2));
assert(statSync(mobile).isDirectory(), "mobile-agent repository path is required");
assert(statSync(ui).isDirectory(), "UI repository path is required");
assert(!isWithin(mobile, workRoot), "work root must be outside mobile-agent repository");
assert(!isWithin(ui, workRoot), "work root must be outside UI repository");
assert.equal(existsSync(workRoot), false, "work root must not already exist");
assert(statSync(dirname(workRoot)).isDirectory(), "work root parent must exist");

const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
const ancestor = (root, head) => execFileSync("git", ["-C", root, "merge-base", "--is-ancestor", head, "HEAD"]);
for (const head of [
  "1417afa6ab686887aeefeafa6f07017c531945ad",
  "54f9150aec8942421c56c4765b384c5ebef7459a",
]) ancestor(mobile, head);
for (const head of [
  "62999084fac566f54895deb8f1750798579479e6",
  "1ae018c8778254c3b91cdbfefdf5b435f8f9b917",
  "486dbea7aefa15e18b7dccd42eca6a4fa9a79cb9",
  "d817683e35f6d36d3881077058207f02adbb065d",
  "961cd0c68abe1c8509f50637994a7cbbfd4683b1",
  "69444ca71160baece87fabec2f17038dad828fce",
]) ancestor(ui, head);

const readJson = (root, relativePath) => JSON.parse(readFileSync(resolve(root, relativePath), "utf8"));
const sourceReceipt = readJson(ui, "evidence/presentation-shared-visual-proof/source-package-receipt.json");
assert.equal(sourceReceipt.schema, "presentation-shared-visual-source-package-receipt/1");
assert.equal(sourceReceipt.status, "PASS");
assert.equal(sourceReceipt.input.sha256, "728bc26c64f20d8d0ecbc1a1f1ca96f15d817b16742a53fc92d06d031713417f");
assert.equal(sourceReceipt.knownIntentLoss, 0);
assert(sourceReceipt.currentProof.browserAssertions >= sourceReceipt.historicalProof.browserAssertions);

mkdirSync(workRoot);
execFileSync(process.execPath, ["scripts/build-presentation-shared-visual-proof.mjs"], { cwd: ui, stdio: "pipe" });
const state = resolve(ui, "evidence/presentation-shared-visual-proof/seq-state.jsonl");
const outputs = [join(workRoot, "carrier.run1.html"), join(workRoot, "carrier.run2.html")];
for (const output of outputs) {
  execFileSync("python3", [
    resolve(mobile, "scripts/build_semantic_artifact.py"),
    "--state", state,
    "--output", output,
    "--title", "Presentation shared visual Seq",
    "--map-id", "semantic-map:presentation:shared-visual",
    "--pattern", "seq/1",
    "--seq-axis", "ordinal",
    "--seq-group", "actor",
  ], { cwd: mobile, stdio: "pipe" });
}
const first = readFileSync(outputs[0]);
const second = readFileSync(outputs[1]);
assert.deepEqual(first, second, "semantic Seq carrier is not deterministic");
const carrierBytes = first.length;
const carrierSha256 = createHash("sha256").update(first).digest("hex");

const browser = readJson(ui, "evidence/presentation-shared-visual-proof/browser/browser-proof.json");
assert.equal(browser.pass, true);
assert.equal(browser.status, "PASS");
assert(browser.assertions >= 62);
assert.deepEqual(browser.isolatedRegions, []);
assert.equal(browser.requests.every((item) => item.host === "present.owner.test"), true, "external request escaped proof host");
assert.equal(browser.artifacts.semanticSeq.sha256, carrierSha256, "browser proof does not bind the current deterministic carrier");
assert.equal(browser.artifacts.semanticSeq.bytes, carrierBytes, "browser proof carrier byte count changed");
assert.equal(browser.artifacts.semanticSeq.path, "artifact://mobile-agent/semantic-seq/shared-visual.html");
for (const required of [
  "presentation-envelope-v3", "slides-order-authority", "three-presentation-templates",
  "trusted-a2ui-without-canvas", "existing-seq-1-projector", "one-persistent-seq-instance",
  "seq-click-to-slide", "slide-to-seq-focus", "generic-non-seq-resource-path",
  "missing-focus-fail-closed", "no-isolated-slide-regions", "no-persisted-storygraph", "no-external-network",
]) assert(browser.verified.includes(required), `missing browser criterion: ${required}`);
const sharedMetrics = browser.observations.initialMetrics.resources.find((item) => item.id === "shared-seq")?.metrics;
assert.equal(sharedMetrics?.initCount, 1);
assert(sharedMetrics?.stateApplyCount >= 1);

const build = readJson(ui, "evidence/presentation-shared-visual-proof/build-receipt.json");
assert.equal(build.pass, true);
assert.equal(build.presentationSchema, "presentation-envelope/3");
assert.deepEqual(build.templates, ["content-only", "content-visual", "visual-only"]);
assert.equal(build.persistedStoryGraph, false);
assert.equal(build.orderAuthority, "slides[]");
assert(build.seqResourceReferences > 0 && build.nonSeqResourceReferences > 0);

const { SEMANTIC_MAP_MODULE_IDENTITY } = await import(pathToFileURL(resolve(mobile, "packages/app/artifact-module.js")));
const html = readFileSync(resolve(ui, "generated/presentation-shared-visual-proof/index.html"), "utf8");
const match = html.match(/<script id="artifact-module-registry" type="application\/json">([\s\S]*?)<\/script>/u);
assert(match, "artifact module registry missing from shared visual artifact");
const manifests = JSON.parse(match[1]);
const semanticManifest = manifests.find((item) => item.appId === "semantic-map");
assert(semanticManifest, "semantic-map manifest missing");
assert.equal(semanticManifest.contractVersion, SEMANTIC_MAP_MODULE_IDENTITY.contractVersion);
assert.equal(semanticManifest.rendererVersion, SEMANTIC_MAP_MODULE_IDENTITY.rendererVersion);

const mobileCheck = JSON.parse(execFileSync(process.execPath, ["tests/artifact_module_bridge_test.mjs"], { cwd: mobile, encoding: "utf8" }).trim());
assert.equal(mobileCheck.pass, true);
assert.equal(mobileCheck.overviewMarkerWithoutCameraFocus, true);
assert.equal(mobileCheck.failClosedMissingFocus, true);
const uiCheck = JSON.parse(execFileSync(process.execPath, ["tests/check-presentation-shared-visual-merge.mjs"], { cwd: ui, encoding: "utf8" }).trim());
assert.equal(uiCheck.pass, true);

const receipt = {
  schema: "roccho.presentation-shared-visual-closure/2",
  status: "PASS",
  authority: false,
  repositories: {
    mobileAgent: { head: git(mobile, "rev-parse", "HEAD"), tree: git(mobile, "rev-parse", "HEAD^{tree}") },
    ui: { head: git(ui, "rev-parse", "HEAD"), tree: git(ui, "rev-parse", "HEAD^{tree}") },
  },
  sourcePackageSha256: sourceReceipt.input.sha256,
  historicalAssertions: sourceReceipt.historicalProof.browserAssertions,
  currentAssertions: browser.assertions,
  sharedSeqInitCount: sharedMetrics.initCount,
  rendererVersion: SEMANTIC_MAP_MODULE_IDENTITY.rendererVersion,
  deterministicCarrier: { sha256: carrierSha256, bytes: carrierBytes, runs: 2 },
  externalNetworkRequests: 0,
  isolatedRegions: 0,
  knownIntentLoss: 0,
  retainedWork: ["carrier.run1.html", "carrier.run2.html"],
};
const receiptPath = join(workRoot, "presentation-shared-visual.receipt.json");
writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ schema: receipt.schema, status: receipt.status, receiptPath }));
