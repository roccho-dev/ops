#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const packageRoot = path.join(root, "packages/ops-decision-closure");
const cli = path.join(packageRoot, "bin/final-proof.py");
const selectedCli = path.join(packageRoot, "bin/query.py");
const cleanRoomCli = path.join(packageRoot, "bin/clean-room.py");
const pythonCommand = process.env.OPS_PYTHON || "python3";
const gitCommand = process.env.OPS_GIT || "git";
const duckdb = process.env.OPS_DUCKDB || "duckdb";
process.env.PYTHONDONTWRITEBYTECODE = "1";
const out = fs.mkdtempSync(path.join(os.tmpdir(), "ops-decision-final-"));
const takeoverRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ops-decision-takeover-"));
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const invokeSelected = (projection, manifestSha, query = "current_decisions", params = { domain: "decision-ledger" }) =>
  spawnSync(pythonCommand, [selectedCli, "--projection", projection, "--manifest-sha256", manifestSha, "--query", query, "--params-json", JSON.stringify(params)], { encoding: "utf8" });
const requireRejected = (result, pattern) => {
  if (result.error) throw result.error;
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}${result.stdout}`, pattern);
};
const clonedProjection = (name, source) => {
  const target = path.join(out, name);
  fs.cpSync(source, target, { recursive: true });
  return target;
};
const invoke = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
};

try {
  const proof = spawnSync(pythonCommand, [cli, "--out-dir", out, "--duckdb", duckdb, "--source-commit", "0000000000000000000000000000000000000000", "--source-tree", "0000000000000000000000000000000000000000"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (proof.error) throw proof.error;
  if (proof.status !== 0) throw new Error(`${proof.stdout}\n${proof.stderr}`);
  const summary = JSON.parse(proof.stdout.trim());
  assert.equal(summary.status, "PASS_IMPLEMENTATION_READY_FOR_RELEASE");
  assert.equal(summary.selectedEngine, "sqlite-shards");
  assert.equal(summary.semanticMismatchCount, 0);
  assert.equal(summary.failClosedMismatchCount, 0);
  assert.equal(summary.decisionEconomics, "PASS_DECISION_ECONOMICS_G9");

  const receipt = JSON.parse(fs.readFileSync(path.join(out, "final-closure-receipt.json"), "utf8"));
  assert.equal(receipt.terminalStates.L1, "PASS_SQLITE_SHARDS");
  assert.equal(receipt.terminalStates.L3, "PASS_DECISION_ECONOMICS_G9");
  assert.equal(receipt.humanAI.actionCandidateCount, 5);
  assert.equal(receipt.humanAI.machineAnswerability, "PASS_MACHINE_ANSWERABILITY");
  assert.equal(receipt.humanAI.directAuthorityWriteCount, 0);
  assert.ok(fs.statSync(path.join(out, "decision-room.html")).size > 1000);
  assert.ok(fs.statSync(path.join(out, "dd-packet", "known-limitations.json")).size > 10);

  const querySource = fs.readFileSync(selectedCli, "utf8");
  assert.equal(querySource.includes("duckdb"), false);
  const selectedProjection = path.join(out, "checkpoint-selected");
  const selectedManifest = path.join(selectedProjection, "manifest.json");
  const selectedManifestSha = sha256(fs.readFileSync(selectedManifest));
  const selected = invokeSelected(selectedProjection, selectedManifestSha);
  if (selected.error) throw selected.error;
  if (selected.status !== 0) throw new Error(`${selected.stdout}\n${selected.stderr}`);
  const selectedResult = JSON.parse(selected.stdout);
  assert.equal(selectedResult.status, "PASS");
  assert.equal(selectedResult.manifestSha256, selectedManifestSha);
  assert.deepEqual(selectedResult.rows.map((row) => row.id), ["d-lease-current"]);
  assert.equal(selectedResult.semanticDigest, JSON.parse(fs.readFileSync(path.join(out, "decision-packet.json"), "utf8")).canonical_result_digests.current_decisions);

  requireRejected(invokeSelected(selectedProjection, "0".repeat(64)), /MANIFEST_IDENTITY_MISMATCH/);

  const extraPath = path.join(selectedProjection, "unexpected.txt");
  fs.writeFileSync(extraPath, "unexpected");
  requireRejected(invokeSelected(selectedProjection, selectedManifestSha), /ASSET_SET_MISMATCH/);
  fs.unlinkSync(extraPath);

  const duplicateProjection = clonedProjection("checkpoint-duplicate-asset", selectedProjection);
  const duplicateManifestPath = path.join(duplicateProjection, "manifest.json");
  const duplicateManifest = JSON.parse(fs.readFileSync(duplicateManifestPath, "utf8"));
  duplicateManifest.assets.push(structuredClone(duplicateManifest.assets[0]));
  fs.writeFileSync(duplicateManifestPath, `${JSON.stringify(duplicateManifest, null, 2)}\n`);
  requireRejected(invokeSelected(duplicateProjection, sha256(fs.readFileSync(duplicateManifestPath))), /ASSET_NAME_DUPLICATE/);

  const pathProjection = clonedProjection("checkpoint-invalid-path", selectedProjection);
  const pathManifestPath = path.join(pathProjection, "manifest.json");
  const pathManifest = JSON.parse(fs.readFileSync(pathManifestPath, "utf8"));
  pathManifest.assets[0].name = "../outside.sqlite";
  fs.writeFileSync(pathManifestPath, `${JSON.stringify(pathManifest, null, 2)}\n`);
  requireRejected(invokeSelected(pathProjection, sha256(fs.readFileSync(pathManifestPath))), /ASSET_PATH_INVALID/);

  const missingProjection = clonedProjection("checkpoint-missing-asset", selectedProjection);
  const missingManifestPath = path.join(missingProjection, "manifest.json");
  const missingManifest = JSON.parse(fs.readFileSync(missingManifestPath, "utf8"));
  fs.unlinkSync(path.join(missingProjection, missingManifest.assets[0].name));
  requireRejected(invokeSelected(missingProjection, sha256(fs.readFileSync(missingManifestPath))), /ASSET_SET_MISMATCH/);

  const tamperedProjection = clonedProjection("checkpoint-tampered-asset", selectedProjection);
  const tamperedManifestPath = path.join(tamperedProjection, "manifest.json");
  const tamperedManifest = JSON.parse(fs.readFileSync(tamperedManifestPath, "utf8"));
  const tamperedAssetPath = path.join(tamperedProjection, tamperedManifest.assets[0].name);
  fs.chmodSync(tamperedAssetPath, 0o644);
  fs.appendFileSync(tamperedAssetPath, "tamper");
  requireRejected(invokeSelected(tamperedProjection, sha256(fs.readFileSync(tamperedManifestPath))), /ASSET_IDENTITY_MISMATCH/);

  const repoFixture = path.join(takeoverRoot, "repo");
  const fixturePackage = path.join(repoFixture, "packages/ops-decision-closure");
  fs.mkdirSync(path.dirname(fixturePackage), { recursive: true });
  fs.cpSync(fs.realpathSync(packageRoot), fixturePackage, { recursive: true, dereference: true });
  invoke(gitCommand, ["init", "--quiet", repoFixture]);
  invoke(gitCommand, ["-C", repoFixture, "config", "user.name", "independent-takeover-fixture"]);
  invoke(gitCommand, ["-C", repoFixture, "config", "user.email", "takeover@example.invalid"]);
  invoke(gitCommand, ["-C", repoFixture, "add", "packages/ops-decision-closure"]);
  invoke(gitCommand, ["-C", repoFixture, "commit", "--quiet", "-m", "fixture: exact decision closure source"]);
  const fixtureCommit = invoke(gitCommand, ["-C", repoFixture, "rev-parse", "HEAD"]);
  const fixtureTree = invoke(gitCommand, ["-C", repoFixture, "rev-parse", "HEAD^{tree}"]);

  const releaseProof = path.join(takeoverRoot, "release-proof");
  invoke(pythonCommand, [path.join(fixturePackage, "bin/final-proof.py"), "--out-dir", releaseProof, "--duckdb", duckdb, "--source-commit", fixtureCommit, "--source-tree", fixtureTree]);
  const releaseManifestSha = sha256(fs.readFileSync(path.join(releaseProof, "artifact-manifest.json")));
  const takeoverOut = path.join(takeoverRoot, "takeover");
  const cleanHome = path.join(takeoverRoot, "home");
  const cleanTmp = path.join(takeoverRoot, "tmp");
  fs.mkdirSync(cleanHome);
  fs.mkdirSync(cleanTmp);
  const cleanEnvironment = {
    PATH: process.env.PATH || "",
    HOME: cleanHome,
    TMPDIR: cleanTmp,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PYTHONDONTWRITEBYTECODE: "1",
  };
  const takeover = spawnSync(pythonCommand, [
    path.join(fixturePackage, "bin/clean-room.py"),
    "--repo-root", repoFixture,
    "--release-proof-dir", releaseProof,
    "--release-manifest-sha256", releaseManifestSha,
    "--out-dir", takeoverOut,
    "--duckdb", duckdb,
    "--exact-commit", fixtureCommit,
    "--exact-tree", fixtureTree,
    "--release-tag", `decision-ledger-proof-${fixtureCommit.slice(0, 12)}`,
    "--operator-id", "nix-clean-room-fixture",
  ], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: cleanEnvironment });
  if (takeover.error) throw takeover.error;
  if (takeover.status !== 0) throw new Error(`${takeover.stdout}\n${takeover.stderr}`);
  const takeoverSummary = JSON.parse(takeover.stdout.trim());
  assert.equal(takeoverSummary.status, "PASS_INDEPENDENT_TRANSFER_DD_G10");
  const takeoverReceipt = JSON.parse(fs.readFileSync(path.join(takeoverOut, "independent-takeover.receipt.json"), "utf8"));
  assert.equal(takeoverReceipt.verdict, "PASS_INDEPENDENT_TRANSFER_DD_G10");
  assert.equal(takeoverReceipt.secret_count, 0);
  assert.equal(takeoverReceipt.owner_intervention_count, 0);
  assert.equal(takeoverReceipt.repository_identity_result.commit, fixtureCommit);
  assert.equal(takeoverReceipt.repository_identity_result.tree, fixtureTree);
  assert.equal(takeoverReceipt.release_manifest_sha256, releaseManifestSha);
  assert.equal(takeoverReceipt.selected_query_result.status, "PASS");
  assert.equal(takeoverReceipt.alternate_host_result.status, "PASS");
  assert.equal(takeoverReceipt.impact_result.status, "PASS");
  assert.equal(takeoverReceipt.source_checkpoint_unchanged, true);

  const wrongReleaseManifest = spawnSync(pythonCommand, [
    path.join(fixturePackage, "bin/clean-room.py"),
    "--repo-root", repoFixture,
    "--release-proof-dir", releaseProof,
    "--release-manifest-sha256", "0".repeat(64),
    "--out-dir", path.join(takeoverRoot, "takeover-wrong-manifest"),
    "--duckdb", duckdb,
    "--exact-commit", fixtureCommit,
    "--exact-tree", fixtureTree,
    "--release-tag", "decision-ledger-proof-invalid",
  ], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: cleanEnvironment });
  requireRejected(wrongReleaseManifest, /release manifest SHA mismatch/);

  process.stdout.write(`${JSON.stringify({ ...summary, cleanRoom: takeoverSummary.status })}\n`);
} finally {
  fs.rmSync(out, { recursive: true, force: true });
  fs.rmSync(takeoverRoot, { recursive: true, force: true });
}
