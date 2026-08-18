#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const cli = path.join(repoRoot, "packages/ops-git-write-closure/bin/ops-git-write-closure.mjs");
const run = (cmd, args, options = {}) => {
  const r = spawnSync(cmd, args, { encoding: options.encoding ?? "utf8", cwd: options.cwd, env: options.env ?? process.env, input: options.input, maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (!(options.allowed ?? [0]).includes(r.status)) throw new Error(`${cmd} ${args.join(" ")} => ${r.status}\n${r.stdout}\n${r.stderr}`);
  return r;
};
const git = (repo, ...args) => run("git", ["-C", repo, ...args]).stdout.trim();
const writeJson = (file, x) => fs.writeFileSync(file, `${JSON.stringify(x, null, 2)}\n`);
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const invoke = (args, allowed = [0]) => run(process.execPath, [cli, ...args], { allowed });

function fixture(root) {
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo);
  run("git", ["init", "--quiet", "--initial-branch=proposals", repo]);
  git(repo, "config", "user.name", "proof");
  git(repo, "config", "user.email", "proof@example.invalid");
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src", "update.txt"), "before\n");
  fs.writeFileSync(path.join(repo, "src", "delete.txt"), "delete me\n");
  fs.writeFileSync(path.join(repo, "src", "mode.sh"), "#!/bin/sh\necho mode\n", { mode: 0o644 });
  const fd = fs.openSync(path.join(repo, "large.bin"), "w");
  try {
    const block = Buffer.alloc(1024 * 1024, 0x5a);
    for (let i = 0; i < 24; i++) fs.writeSync(fd, block);
  } finally { fs.closeSync(fd); }
  git(repo, "add", ".");
  git(repo, "commit", "--quiet", "-m", "base");
  const base = git(repo, "rev-parse", "HEAD");
  const baseTree = git(repo, "rev-parse", "HEAD^{tree}");
  const largeOid = git(repo, "rev-parse", "HEAD:large.bin");

  fs.writeFileSync(path.join(repo, "src", "update.txt"), "after\n");
  fs.rmSync(path.join(repo, "src", "delete.txt"));
  fs.chmodSync(path.join(repo, "src", "mode.sh"), 0o755);
  fs.writeFileSync(path.join(repo, "src", "added.txt"), "new\n");
  return { repo, base, baseTree, largeOid };
}

function requestFor(repo, base, requestId = "ops-114-e2e", overrides = {}) {
  const targetBranch = `proposal/connector/${requestId}`;
  return {
    schema: "ops.gitWriteRequest.v1",
    requestId,
    sourceRepo: "roccho-dev/ops",
    baseRef: "proposals",
    baseSha: base,
    worktree: repo,
    targetBranch,
    commitMessage: "proof: candidate",
    force: false,
    pullRequest: { base: "proposals", head: targetBranch, title: "proof", body: "proof body", draft: true },
    checks: [{ id: "syntax", command: ["sh", "-n", path.join(repo, "src", "mode.sh")], timeoutSeconds: 30 }],
    adapter: { id: "local-forge", maxBlobBytes: 1024 * 1024, maxTotalBytes: 4 * 1024 * 1024, supportsBase64: true, supportsCreateTree: true, supportsCreateCommit: true, supportsRefWrite: true, supportsPrCreate: true },
    ...overrides,
  };
}

function localEffect(plan, baseRepo, remoteDir) {
  run("git", ["clone", "--quiet", `file://${baseRepo}`, remoteDir]);
  const index = path.join(path.dirname(remoteDir), "effect.index");
  const env = { ...process.env, GIT_INDEX_FILE: index };
  run("git", ["-C", remoteDir, "read-tree", plan.base.tree], { env });
  const blobs = [];
  for (const operation of plan.blobOperations) {
    const bytes = operation.encoding === "base64" ? Buffer.from(operation.content, "base64") : Buffer.from(operation.content, "utf8");
    const actualOid = run("git", ["-C", remoteDir, "hash-object", "-w", "--stdin"], { input: bytes }).stdout.trim();
    assert.equal(actualOid, operation.expectedOid);
    blobs.push({ operationId: operation.operationId, expectedOid: operation.expectedOid, actualOid, readbackBase64: bytes.toString("base64") });
  }
  for (const operation of plan.treeOperations) {
    if (operation.action === "delete") run("git", ["-C", remoteDir, "update-index", "--force-remove", "--", operation.path], { env });
    else run("git", ["-C", remoteDir, "update-index", "--add", "--cacheinfo", `${operation.mode},${operation.expectedBlobOid},${operation.path}`], { env });
  }
  const actualTree = run("git", ["-C", remoteDir, "write-tree"], { env }).stdout.trim();
  assert.equal(actualTree, plan.candidate.tree);
  const commit = run("git", ["-C", remoteDir, "commit-tree", actualTree, "-p", plan.base.commit, "-m", plan.commit.message], { env: { ...process.env, GIT_AUTHOR_NAME: "proof", GIT_AUTHOR_EMAIL: "proof@example.invalid", GIT_COMMITTER_NAME: "proof", GIT_COMMITTER_EMAIL: "proof@example.invalid" } }).stdout.trim();
  run("git", ["-C", remoteDir, "update-ref", `refs/heads/${plan.targetBranch}`, commit]);
  const commitText = run("git", ["-C", remoteDir, "cat-file", "commit", commit]).stdout;
  const parent = /^parent ([0-9a-f]{40})$/m.exec(commitText)?.[1];
  const tree = /^tree ([0-9a-f]{40})$/m.exec(commitText)?.[1];
  const message = commitText.split("\n\n").slice(1).join("\n\n").trimEnd();
  return {
    schema: "ops.gitWriteEffectResult.v1",
    requestId: plan.requestId,
    planSha256: plan.planSha256,
    status: "PR_OPENED",
    baseReadback: { ref: plan.base.ref, sha: plan.base.commit },
    blobs,
    tree: { expectedSha: plan.candidate.tree, actualSha: actualTree },
    commit: { sha: commit, parent, tree, message },
    ref: { name: plan.targetBranch, sha: run("git", ["-C", remoteDir, "rev-parse", `refs/heads/${plan.targetBranch}`]).stdout.trim() },
    pullRequest: { number: 1, url: "https://example.invalid/pr/1", head: plan.pullRequest.head, base: plan.pullRequest.base, draft: true, matchingCount: 1 },
    limitations: ["local bare repository substitutes for authenticated GitHub effect in this test"],
  };
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ops-git-write-closure-"));
try {
  const f = fixture(tmp);
  const requestFile = path.join(tmp, "request.json");
  const outDir = path.join(tmp, "prepared");
  const stateDir = path.join(tmp, "state");
  const request = requestFor(f.repo, f.base);
  writeJson(requestFile, request);
  const prepared = JSON.parse(invoke(["prepare", "--request", requestFile, "--out-dir", outDir, "--state-dir", stateDir]).stdout);
  assert.equal(prepared.status, "PREPARED");
  const plan = readJson(path.join(outDir, "effect-plan.json"));
  assert.deepEqual(plan.changedPaths, ["src/added.txt", "src/delete.txt", "src/mode.sh", "src/update.txt"]);
  assert.equal(plan.blobOperations.some((x) => x.path === "large.bin"), false);
  assert.equal(plan.treeOperations.find((x) => x.path === "src/delete.txt").action, "delete");
  assert.equal(plan.treeOperations.find((x) => x.path === "src/mode.sh").mode, "100755");
  assert.equal(git(f.repo, "rev-parse", `${plan.candidate.tree}:large.bin`), f.largeOid);
  assert.ok(plan.blobOperations.every((x) => x.bytes < 1024));

  const effect = localEffect(plan, f.repo, path.join(tmp, "remote"));
  const effectFile = path.join(tmp, "effect.json");
  const receiptFile = path.join(tmp, "receipt.json");
  writeJson(effectFile, effect);
  const verified = JSON.parse(invoke(["verify", "--plan", path.join(outDir, "effect-plan.json"), "--effect-result", effectFile, "--out", receiptFile]).stdout);
  assert.equal(verified.status, "PASS");

  const staleFile = path.join(tmp, "stale.json");
  writeJson(staleFile, requestFor(f.repo, "0".repeat(40), "ops-114-stale"));
  assert.match(invoke(["prepare", "--request", staleFile, "--out-dir", path.join(tmp, "stale")], [1]).stderr, /STALE_BASE/);

  const failedCheck = requestFor(f.repo, f.base, "ops-114-check-fail", { checks: [{ id: "fail", command: [process.execPath, "-e", "process.exit(9)"] }] });
  const failedCheckFile = path.join(tmp, "failed-check.json"); writeJson(failedCheckFile, failedCheck);
  assert.match(invoke(["prepare", "--request", failedCheckFile, "--out-dir", path.join(tmp, "failed-check")], [1]).stderr, /CHECK_FAILED/);

  const over = requestFor(f.repo, f.base, "ops-114-oversize", { adapter: { ...request.adapter, maxBlobBytes: 1 } });
  const overFile = path.join(tmp, "over.json"); writeJson(overFile, over);
  assert.match(invoke(["prepare", "--request", overFile, "--out-dir", path.join(tmp, "over")], [1]).stderr, /NEEDS_BYTE_INGRESS/);

  const protectedReq = { ...requestFor(f.repo, f.base, "ops-114-protected"), targetBranch: "proposals" };
  const protectedFile = path.join(tmp, "protected.json"); writeJson(protectedFile, protectedReq);
  assert.match(invoke(["prepare", "--request", protectedFile, "--out-dir", path.join(tmp, "protected")], [1]).stderr, /FORBIDDEN_EFFECT/);

  const reused = { ...request, commitMessage: "different plan" };
  const reusedFile = path.join(tmp, "reused.json"); writeJson(reusedFile, reused);
  assert.match(invoke(["prepare", "--request", reusedFile, "--out-dir", path.join(tmp, "reused"), "--state-dir", stateDir], [1]).stderr, /REQUEST_ID_REUSED_WITH_DIFFERENT_PLAN/);

  const tampered = structuredClone(effect); tampered.commit.tree = "f".repeat(40);
  const tamperedFile = path.join(tmp, "tampered.json"); writeJson(tamperedFile, tampered);
  assert.match(invoke(["verify", "--plan", path.join(outDir, "effect-plan.json"), "--effect-result", tamperedFile, "--out", path.join(tmp, "tampered-receipt.json")], [1]).stderr, /REMOTE_READBACK_MISMATCH/);

  const partial = structuredClone(effect); partial.status = "PARTIAL_EFFECT"; partial.pullRequest = {};
  const partialFile = path.join(tmp, "partial.json"); const partialReceipt = path.join(tmp, "partial-receipt.json"); writeJson(partialFile, partial);
  assert.match(invoke(["verify", "--plan", path.join(outDir, "effect-plan.json"), "--effect-result", partialFile, "--out", partialReceipt], [1]).stderr, /PARTIAL_EFFECT/);
  assert.equal(readJson(partialReceipt).status, "PARTIAL_EFFECT");

  const forceReq = { ...requestFor(f.repo, f.base, "ops-114-force"), force: true };
  const forceFile = path.join(tmp, "force.json"); writeJson(forceFile, forceReq);
  assert.match(invoke(["prepare", "--request", forceFile, "--out-dir", path.join(tmp, "force")], [1]).stderr, /FORBIDDEN_EFFECT/);

  const unavailableReq = requestFor(f.repo, f.base, "ops-114-adapter", { adapter: { ...request.adapter, supportsPrCreate: false } });
  const unavailableFile = path.join(tmp, "unavailable.json"); writeJson(unavailableFile, unavailableReq);
  assert.match(invoke(["prepare", "--request", unavailableFile, "--out-dir", path.join(tmp, "unavailable")], [1]).stderr, /ADAPTER_UNAVAILABLE/);

  const tamperedBlob = structuredClone(effect); tamperedBlob.blobs[0].actualOid = "0".repeat(40);
  const tamperedBlobFile = path.join(tmp, "tampered-blob.json"); writeJson(tamperedBlobFile, tamperedBlob);
  assert.match(invoke(["verify", "--plan", path.join(outDir, "effect-plan.json"), "--effect-result", tamperedBlobFile, "--out", path.join(tmp, "tampered-blob-receipt.json")], [1]).stderr, /REMOTE_READBACK_MISMATCH/);

  const missingBlobReadback = structuredClone(effect); delete missingBlobReadback.blobs[0].readbackBase64;
  const missingBlobReadbackFile = path.join(tmp, "missing-blob-readback.json"); writeJson(missingBlobReadbackFile, missingBlobReadback);
  assert.match(invoke(["verify", "--plan", path.join(outDir, "effect-plan.json"), "--effect-result", missingBlobReadbackFile, "--out", path.join(tmp, "missing-blob-readback-receipt.json")], [1]).stderr, /REMOTE_READBACK_MISMATCH/);

  const nonCanonicalBlobReadback = structuredClone(effect); nonCanonicalBlobReadback.blobs[0].readbackBase64 += "\n";
  const nonCanonicalBlobReadbackFile = path.join(tmp, "noncanonical-blob-readback.json"); writeJson(nonCanonicalBlobReadbackFile, nonCanonicalBlobReadback);
  assert.match(invoke(["verify", "--plan", path.join(outDir, "effect-plan.json"), "--effect-result", nonCanonicalBlobReadbackFile, "--out", path.join(tmp, "noncanonical-blob-readback-receipt.json")], [1]).stderr, /REMOTE_READBACK_MISMATCH/);

  const duplicateBlobReadback = structuredClone(effect); duplicateBlobReadback.blobs.push(structuredClone(duplicateBlobReadback.blobs[0]));
  const duplicateBlobReadbackFile = path.join(tmp, "duplicate-blob-readback.json"); writeJson(duplicateBlobReadbackFile, duplicateBlobReadback);
  assert.match(invoke(["verify", "--plan", path.join(outDir, "effect-plan.json"), "--effect-result", duplicateBlobReadbackFile, "--out", path.join(tmp, "duplicate-blob-readback-receipt.json")], [1]).stderr, /REMOTE_READBACK_MISMATCH/);

  const tamperedRef = structuredClone(effect); tamperedRef.ref.sha = f.base;
  const tamperedRefFile = path.join(tmp, "tampered-ref.json"); writeJson(tamperedRefFile, tamperedRef);
  assert.match(invoke(["verify", "--plan", path.join(outDir, "effect-plan.json"), "--effect-result", tamperedRefFile, "--out", path.join(tmp, "tampered-ref-receipt.json")], [1]).stderr, /REMOTE_READBACK_MISMATCH/);

  const tamperedPr = structuredClone(effect); tamperedPr.pullRequest.base = "main";
  const tamperedPrFile = path.join(tmp, "tampered-pr.json"); writeJson(tamperedPrFile, tamperedPr);
  assert.match(invoke(["verify", "--plan", path.join(outDir, "effect-plan.json"), "--effect-result", tamperedPrFile, "--out", path.join(tmp, "tampered-pr-receipt.json")], [1]).stderr, /REMOTE_READBACK_MISMATCH/);

  const duplicatePr = structuredClone(effect); duplicatePr.pullRequest.matchingCount = 2;
  const duplicatePrFile = path.join(tmp, "duplicate-pr.json"); writeJson(duplicatePrFile, duplicatePr);
  assert.match(invoke(["verify", "--plan", path.join(outDir, "effect-plan.json"), "--effect-result", duplicatePrFile, "--out", path.join(tmp, "duplicate-pr-receipt.json")], [1]).stderr, /REMOTE_READBACK_MISMATCH/);

  const tamperedPlan = structuredClone(plan); tamperedPlan.commit.message = "tampered";
  const tamperedPlanFile = path.join(tmp, "tampered-plan.json"); writeJson(tamperedPlanFile, tamperedPlan);
  assert.match(invoke(["verify", "--plan", tamperedPlanFile, "--effect-result", effectFile, "--out", path.join(tmp, "tampered-plan-receipt.json")], [1]).stderr, /PLAN_HASH_MISMATCH/);

  for (const state of ["BRANCH_CONFLICT", "STALE_BASE"]) {
    const stopped = structuredClone(effect); stopped.status = state;
    const stoppedFile = path.join(tmp, `${state}.json`); const stoppedReceipt = path.join(tmp, `${state}.receipt.json`); writeJson(stoppedFile, stopped);
    assert.match(invoke(["verify", "--plan", path.join(outDir, "effect-plan.json"), "--effect-result", stoppedFile, "--out", stoppedReceipt], [1]).stderr, new RegExp(state));
    assert.equal(readJson(stoppedReceipt).status, state);
  }

  const mutRoot = path.join(tmp, "mut"); fs.mkdirSync(mutRoot); const mut = fixture(mutRoot);
  const mutateCheck = requestFor(mut.repo, mut.base, "ops-114-check-mutates", { checks: [{ id: "mutate", command: [process.execPath, "-e", "require('fs').writeFileSync('check-created.txt','x')"] }] });
  const mutateFile = path.join(tmp, "mutate-check.json"); writeJson(mutateFile, mutateCheck);
  assert.match(invoke(["prepare", "--request", mutateFile, "--out-dir", path.join(tmp, "mutate-check")], [1]).stderr, /CHECK_MUTATED_WORKTREE/);

  const sameStatusRoot = path.join(tmp, "same-status-mut"); fs.mkdirSync(sameStatusRoot); const sameStatus = fixture(sameStatusRoot);
  const sameStatusCheck = requestFor(sameStatus.repo, sameStatus.base, "ops-114-check-mutates-same-status", { checks: [{ id: "mutate", command: [process.execPath, "-e", "require('fs').writeFileSync('src/update.txt','mutated')"] }] });
  const sameStatusFile = path.join(tmp, "same-status-check.json"); writeJson(sameStatusFile, sameStatusCheck);
  assert.match(invoke(["prepare", "--request", sameStatusFile, "--out-dir", path.join(tmp, "same-status-check")], [1]).stderr, /CHECK_MUTATED_WORKTREE/);

  const identityRoot = path.join(tmp, "default-identity"); fs.mkdirSync(identityRoot); const identity = fixture(identityRoot);
  const identityRequest = requestFor(identity.repo, identity.base, "ops-114-default-identity");
  const identityFile = path.join(tmp, "default-identity.json"); writeJson(identityFile, identityRequest);
  invoke(["prepare", "--request", identityFile, "--out-dir", path.join(tmp, "default-identity-first")]);
  writeJson(identityFile, { ...identityRequest, commitMessage: "different plan" });
  assert.match(invoke(["prepare", "--request", identityFile, "--out-dir", path.join(tmp, "default-identity-second")], [1]).stderr, /REQUEST_ID_REUSED_WITH_DIFFERENT_PLAN/);

  const noChangeRoot = path.join(tmp, "no-change"); fs.mkdirSync(noChangeRoot); const noChange = fixture(noChangeRoot);
  git(noChange.repo, "add", "-A"); git(noChange.repo, "commit", "--quiet", "-m", "candidate becomes base"); const noChangeBase = git(noChange.repo, "rev-parse", "HEAD");
  const noChangeReq = requestFor(noChange.repo, noChangeBase, "ops-114-no-change");
  const noChangeFile = path.join(tmp, "no-change.json"); writeJson(noChangeFile, noChangeReq);
  assert.match(invoke(["prepare", "--request", noChangeFile, "--out-dir", path.join(tmp, "no-change-out")], [1]).stderr, /NO_CHANGES/);

  process.stdout.write(`${JSON.stringify({ status: "PASS", positive: 2, negative: 20, base: f.base, baseTree: f.baseTree, candidateTree: plan.candidate.tree, largeTrackedBlobBytes: 24 * 1024 * 1024, largeTrackedBlobOid: f.largeOid, changedBlobBytes: prepared.changedBlobBytes })}\n`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
