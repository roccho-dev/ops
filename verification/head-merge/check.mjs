#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCanonicalJsonl } from "../../packages/artifact-assembly/src/index.mjs";
import { normalizeHeadClosures, readJsonl, validateAtomicIntents, validateInternalCommits } from "./lib.mjs";
import { execFileSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const rows = parseCanonicalJsonl(fs.readFileSync(path.join(here, "closure.jsonl"), "utf8"), "ops head closure");
const expected = [
  "0f757ed5fa67f8109aacfdf740a813a71004ffd2",
  "2039a7a2bb99693379cc18b99c0cfc6c6cb8170e",
  "32de01a8916ecf53e2e5766c270634936c16e154",
  "3d9ca4ac605bb553857e2ca728fb92d25e2ebf6a",
  "d657587a9844752710a88c9a3fa0e7fd4741cf9d",
  "f15e7d761fff838f5e8598ea0fc51c3ca29f005d",
  "8eb6b1d485afba9253a6e29188f6ff5641cb9b73",
  "84d4592d2191b32855d1ad048b6f117ba6629515",
  "86c70f626f6df8412f8529a9cf487ae6f89bb5b1",
  "80a56b28e97115aa5978bb6f994b62fc1881c066",
  "5ac204d7b71bbff956b5cd71a32770e19d079161",
  "6afef1beb7ccdb079e9aaf39b57edfe5e9a425e5",
  "dde539e6ec129d1056e4bd4a7347da146972dbfc",
  "76a8a288c12d50d2d8b88ec878ca4651ffd113bc",
  "4b0b60414c43513d092d143f41f424004b321003",
].sort();
assert.deepEqual(rows.map(row => row.head).sort(), expected);
assert.equal(new Set(rows.map(row => row.head)).size, expected.length);
for (const row of rows) {
  assert.equal(row.schema, "roccho.head-intent-closure/1");
  assert.equal(row.repo, "ops");
  assert.equal(row.status, "satisfied");
  assert.ok(["frontier", "intermediate", "baseline-anchor"].includes(row.candidateState));
  assert.ok(row.intent.length > 0 && row.finalOwner.length > 0 && row.resolution.length > 0);
  assert.ok(Array.isArray(row.proof) && row.proof.length > 0);
  for (const proof of row.proof) assert.equal(fs.existsSync(path.join(repo, proof)), true, `missing proof: ${proof}`);
}


const atomic = readJsonl(path.join(here, "atomic-intent-ledger.jsonl"), "atomic intent ledger");
const atomicSummary = validateAtomicIntents(atomic);
const internal = readJsonl(path.join(here, "internal-commit-coverage.jsonl"), "internal commit coverage");
validateInternalCommits(internal, atomicSummary.commitSet);

const mobileRoot = process.env.MOBILE_AGENT_ROOT ? path.resolve(process.env.MOBILE_AGENT_ROOT) : path.resolve(repo, "../mobile-agent");
const uiRoot = process.env.UI_ROOT ? path.resolve(process.env.UI_ROOT) : path.resolve(repo, "../ui");
const crossRepoRootsAvailable = fs.existsSync(mobileRoot) && fs.existsSync(uiRoot);
if (crossRepoRootsAvailable) {
  execFileSync(process.execPath, [
    path.join(here, "project-release.mjs"),
    "--mobile", mobileRoot,
    "--ui", uiRoot,
    "--ops", repo,
    "--out", path.join(here, "generated"),
    "--check",
  ], {cwd: repo, stdio: "pipe"});
}

assert.throws(() => validateAtomicIntents(atomic.map((row, index) => index === 0 ? {...row, finalOwner: null} : row)), /finalOwner/u);
assert.throws(() => normalizeHeadClosures({
  mobileRows: [{schema:"roccho.head-merge-closure/1", source_head:"0".repeat(40), requirements:["x"], final_owner:null, verification:["x"], status:"SATISFIED"}],
  uiRows: [],
  opsRows: [],
}), /finalOwner/u);

const summary = JSON.parse(fs.readFileSync(path.join(here, "generated/release-intent-summary.json"), "utf8"));
assert.equal(summary.historicalHeadIntents, 62);
assert.equal(summary.atomicIntents, 67);
assert.equal(summary.currentAtomicHeads, 31);
assert.equal(summary.internalCommits, 8);
assert.equal(summary.missingFinalOwner, 0);
assert.equal(summary.openAtomicIntents, 0);
assert.equal(summary.knownFunctionalIntentLoss, 0);
assert.equal(summary.compatibilityIntent, "M-COMPAT-001:CLOSED");

console.log(JSON.stringify({
  heads: rows.length,
  historicalHeadIntents: 62,
  atomicIntents: atomicSummary.intents,
  featureHeads: atomicSummary.featureHeads,
  internalCommits: atomicSummary.internalCommits,
  missingFinalOwner: 0,
  openAtomicIntents: 0,
  negativeNullOwnerGate: "PASS",
  crossRepoProjectionCheck: crossRepoRootsAvailable ? "PASS" : "NOT_RUN_STANDALONE",
  status: "ops-head-and-atomic-intent-closure-pass",
}));
