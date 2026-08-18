#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const fail = (code, message, details = {}) => {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
};
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const gitBlobOid = (bytes) => crypto.createHash("sha1")
  .update(Buffer.from(`blob ${bytes.length}\0`))
  .update(bytes)
  .digest("hex");
const canonicalBase64 = (text, label) => {
  if (typeof text !== "string" || /\s/u.test(text) || text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) fail("REMOTE_READBACK_MISMATCH", `${label} is not canonical Base64`);
  const bytes = Buffer.from(text, "base64");
  if (bytes.toString("base64") !== text) fail("REMOTE_READBACK_MISMATCH", `${label} is not canonical Base64`);
  return bytes;
};
const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
};
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: options.encoding ?? "utf8",
    input: options.input,
    maxBuffer: options.maxBuffer ?? 128 * 1024 * 1024,
    timeout: options.timeoutMs,
  });
  if (result.error) fail(result.error.code === "ETIMEDOUT" ? "CHECK_TIMEOUT" : "PROCESS_ERROR", `${command}: ${result.error.message}`);
  if (!(options.allowed ?? [0]).includes(result.status)) fail(options.failureCode ?? "PROCESS_FAILED", `${command} ${args.join(" ")} exited ${result.status}`, { stdout: result.stdout, stderr: result.stderr, exit: result.status });
  return result;
};
const git = (repo, args, options = {}) => run("git", ["-C", repo, ...args], options);
const argMap = (args) => {
  const out = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i]?.startsWith("--") || args[i + 1] === undefined) fail("USAGE", `invalid argument near ${args[i] ?? "end"}`);
    out[args[i].slice(2)] = args[i + 1];
  }
  return out;
};
const requireHex = (value, length, label) => {
  if (typeof value !== "string" || !new RegExp(`^[0-9a-f]{${length}}$`).test(value)) fail("INVALID_REQUEST", `${label} must be ${length} lowercase hex characters`);
  return value;
};
const validateRequest = (request) => {
  if (request.schema !== "ops.gitWriteRequest.v1") fail("INVALID_REQUEST", "request schema mismatch");
  if (!/^[a-z0-9][a-z0-9._-]{2,127}$/.test(request.requestId ?? "")) fail("INVALID_REQUEST", "invalid requestId");
  if (request.sourceRepo !== "roccho-dev/ops") fail("INVALID_REQUEST", "v1 sourceRepo must be roccho-dev/ops");
  if (request.baseRef !== "proposals") fail("INVALID_REQUEST", "v1 baseRef must be proposals");
  requireHex(request.baseSha, 40, "baseSha");
  if (request.force === true) fail("FORBIDDEN_EFFECT", "force is forbidden");
  const expectedBranch = `proposal/connector/${request.requestId}`;
  if (request.targetBranch !== expectedBranch) fail("FORBIDDEN_EFFECT", `targetBranch must be ${expectedBranch}`);
  if (!request.pullRequest || request.pullRequest.base !== "proposals" || request.pullRequest.head !== expectedBranch || request.pullRequest.draft !== true) fail("INVALID_REQUEST", "draft PR metadata must use exact proposals base and target head");
  if (!Array.isArray(request.checks) || request.checks.length === 0) fail("INVALID_REQUEST", "at least one check is required");
  for (const check of request.checks) if (!check.id || !Array.isArray(check.command) || check.command.length === 0 || check.command.some((x) => typeof x !== "string")) fail("INVALID_REQUEST", "invalid check command");
  const adapter = request.adapter;
  const flags = ["supportsBase64", "supportsCreateTree", "supportsCreateCommit", "supportsRefWrite", "supportsPrCreate"];
  if (!adapter || !Number.isInteger(adapter.maxBlobBytes) || !Number.isInteger(adapter.maxTotalBytes)) fail("INVALID_REQUEST", "invalid adapter budget");
  const missing = flags.filter((key) => adapter[key] !== true);
  if (missing.length) fail("ADAPTER_UNAVAILABLE", `adapter lacks required operations: ${missing.join(", ")}`);
  return request;
};
const statusBytes = (repo) => git(repo, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { encoding: "buffer" }).stdout;
const parseDiffTree = (buffer) => {
  const fields = buffer.toString("utf8").split("\0");
  const changes = [];
  let i = 0;
  while (i < fields.length && fields[i]) {
    const status = fields[i++];
    const path1 = fields[i++];
    if (!status || !path1) break;
    if (status.startsWith("R") || status.startsWith("C")) {
      const path2 = fields[i++];
      changes.push({ status, oldPath: path1, path: path2 });
    } else changes.push({ status, path: path1 });
  }
  return changes;
};
const treeEntry = (repo, tree, filePath) => {
  const result = git(repo, ["ls-tree", "-z", tree, "--", filePath], { encoding: "buffer" }).stdout;
  if (!result.length) return null;
  const text = result.toString("utf8").replace(/\0$/, "");
  const match = /^(\d+) ([^ ]+) ([0-9a-f]{40})\t([\s\S]+)$/.exec(text);
  if (!match || match[4] !== filePath) fail("GIT_INSPECTION_FAILED", `cannot parse tree entry for ${filePath}`);
  return { mode: match[1], type: match[2], sha: match[3], path: match[4] };
};
const classifyBlob = (bytes) => {
  if (!bytes.includes(0)) {
    const text = bytes.toString("utf8");
    if (Buffer.from(text, "utf8").equals(bytes)) return { encoding: "utf-8", content: text };
  }
  return { encoding: "base64", content: bytes.toString("base64") };
};
const snapshotTree = (repo) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ops-git-write-snapshot-"));
  try {
    const indexFile = path.join(tempDir, "index");
    fs.copyFileSync(path.join(repo, ".git", "index"), indexFile);
    const env = { ...process.env, GIT_INDEX_FILE: indexFile };
    git(repo, ["add", "-A", "--", "."], { env });
    const tree = git(repo, ["write-tree"], { env }).stdout.trim();
    requireHex(tree, 40, "snapshot tree");
    return tree;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

function prepare(requestFile, outDir, stateDir) {
  const request = validateRequest(readJson(requestFile));
  const repo = path.resolve(request.worktree);
  if (!fs.existsSync(path.join(repo, ".git"))) fail("INVALID_WORKTREE", "worktree is not a Git repository");
  const head = git(repo, ["rev-parse", "HEAD"]).stdout.trim();
  if (head !== request.baseSha) fail("STALE_BASE", `worktree HEAD ${head} differs from baseSha ${request.baseSha}`);
  const baseTree = git(repo, ["rev-parse", `${request.baseSha}^{tree}`]).stdout.trim();
  requireHex(baseTree, 40, "base tree");
  git(repo, ["fsck", "--no-dangling"]);

  const beforeChecksTree = snapshotTree(repo);
  const beforeChecks = statusBytes(repo);
  const checksReceipt = [];
  for (const check of request.checks) {
    const started = process.hrtime.bigint();
    const result = run(check.command[0], check.command.slice(1), {
      cwd: repo,
      allowed: [0],
      timeoutMs: (check.timeoutSeconds ?? 300) * 1000,
      failureCode: "CHECK_FAILED",
    });
    checksReceipt.push({
      id: check.id,
      command: check.command,
      exit: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: Number(process.hrtime.bigint() - started) / 1e6,
      status: "PASS",
    });
  }
  const afterChecks = statusBytes(repo);
  const afterChecksTree = snapshotTree(repo);
  if (!beforeChecks.equals(afterChecks) || beforeChecksTree !== afterChecksTree) fail("CHECK_MUTATED_WORKTREE", "checks changed the candidate worktree");

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ops-git-write-"));
  try {
    const indexFile = path.join(tempDir, "index");
    fs.copyFileSync(path.join(repo, ".git", "index"), indexFile);
    const env = { ...process.env, GIT_INDEX_FILE: indexFile };
    git(repo, ["add", "-A", "--", "."], { env });
    const candidateTree = git(repo, ["write-tree"], { env }).stdout.trim();
    requireHex(candidateTree, 40, "candidate tree");
    if (candidateTree !== afterChecksTree) fail("CANDIDATE_SNAPSHOT_MISMATCH", "candidate tree differs from the checked snapshot");
    if (candidateTree === baseTree) fail("NO_CHANGES", "candidate tree equals base tree");
    const diffRaw = git(repo, ["diff-tree", "--no-commit-id", "--name-status", "-r", "-z", request.baseSha, candidateTree], { encoding: "buffer" }).stdout;
    const changes = parseDiffTree(diffRaw);
    if (!changes.length) fail("NO_CHANGES", "no changed paths found");

    const treeOperations = [];
    const blobOperations = [];
    let totalBytes = 0;
    for (const change of changes) {
      const current = treeEntry(repo, candidateTree, change.path);
      const previous = change.oldPath ? treeEntry(repo, baseTree, change.oldPath) : treeEntry(repo, baseTree, change.path);
      if (!current) {
        treeOperations.push({ operationId: `tree:${change.path}`, action: "delete", path: change.path, oldPath: change.oldPath ?? null, previous });
        continue;
      }
      if (current.type !== "blob" || !["100644", "100755", "120000"].includes(current.mode)) fail("UNSUPPORTED_TREE_ENTRY", `unsupported ${current.type}/${current.mode} at ${change.path}`);
      const bytes = git(repo, ["cat-file", "blob", current.sha], { encoding: "buffer" }).stdout;
      const gitOid = git(repo, ["hash-object", "--stdin"], { input: bytes }).stdout.trim();
      if (gitOid !== current.sha) fail("GIT_OID_MISMATCH", `local Git OID mismatch for ${change.path}`);
      if (bytes.length > request.adapter.maxBlobBytes) fail("NEEDS_BYTE_INGRESS", `${change.path} is ${bytes.length} bytes, adapter maximum is ${request.adapter.maxBlobBytes}`);
      totalBytes += bytes.length;
      const content = classifyBlob(bytes);
      blobOperations.push({
        operationId: `blob:${change.path}`,
        path: change.path,
        bytes: bytes.length,
        payloadSha256: sha256(bytes),
        expectedOid: current.sha,
        ...content,
      });
      treeOperations.push({ operationId: `tree:${change.path}`, action: previous ? "upsert" : "add", path: change.path, oldPath: change.oldPath ?? null, mode: current.mode, type: current.type, expectedBlobOid: current.sha, previous });
    }
    if (totalBytes > request.adapter.maxTotalBytes) fail("NEEDS_BYTE_INGRESS", `changed blobs total ${totalBytes} bytes, adapter maximum is ${request.adapter.maxTotalBytes}`);

    const planBase = {
      schema: "ops.gitWritePlan.v1",
      requestId: request.requestId,
      sourceRepo: request.sourceRepo,
      base: { ref: request.baseRef, commit: request.baseSha, tree: baseTree },
      candidate: { tree: candidateTree },
      changedPaths: changes.map((x) => x.path).sort(),
      blobOperations,
      treeOperations,
      commit: { message: request.commitMessage, parent: request.baseSha, tree: candidateTree },
      targetBranch: request.targetBranch,
      pullRequest: request.pullRequest,
      checksReceipt,
      adapter: request.adapter,
      forbiddenEffects: ["protected-ref-write", "default-ref-write", "force", "merge", "automatic-rebase", "tag", "release"],
    };
    const planSha256 = sha256(Buffer.from(stable(planBase)));
    const plan = { ...planBase, planSha256 };

    fs.mkdirSync(outDir, { recursive: true });
    const identityDir = stateDir ? path.resolve(stateDir) : path.join(repo, ".git", "ops-git-write-closure");
    fs.mkdirSync(identityDir, { recursive: true });
    const stateFile = path.join(identityDir, `${request.requestId}.json`);
    if (fs.existsSync(stateFile)) {
      const prior = readJson(stateFile);
      if (prior.planSha256 !== planSha256) fail("REQUEST_ID_REUSED_WITH_DIFFERENT_PLAN", `requestId ${request.requestId} already maps to another plan`);
    } else writeJson(stateFile, { schema: "ops.gitWriteRequestIdentity.v1", requestId: request.requestId, planSha256 });
    writeJson(path.join(outDir, "effect-plan.json"), plan);
    const receipt = {
      schema: "ops.gitWritePreparedReceipt.v1",
      status: "PREPARED",
      requestId: request.requestId,
      planSha256,
      baseSha: request.baseSha,
      baseTree,
      candidateTree,
      changedPathCount: plan.changedPaths.length,
      changedBlobCount: blobOperations.length,
      changedBlobBytes: totalBytes,
      checks: checksReceipt,
      adapter: request.adapter,
    };
    writeJson(path.join(outDir, "prepared-receipt.json"), receipt);
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    return receipt;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function verify(planFile, effectResultFile, outFile) {
  const plan = readJson(planFile);
  const effect = readJson(effectResultFile);
  if (plan.schema !== "ops.gitWritePlan.v1" || effect.schema !== "ops.gitWriteEffectResult.v1") fail("INVALID_VERIFY_INPUT", "verify input schema mismatch");
  const computed = { ...plan };
  delete computed.planSha256;
  if (sha256(Buffer.from(stable(computed))) !== plan.planSha256) fail("PLAN_HASH_MISMATCH", "effect plan hash does not verify");
  if (effect.requestId !== plan.requestId || effect.planSha256 !== plan.planSha256) fail("EFFECT_IDENTITY_MISMATCH", "effect result does not belong to plan");
  if (effect.status !== "PR_OPENED") {
    const receipt = {
      schema: "ops.gitWriteReceipt.v1",
      status: effect.status,
      requestId: plan.requestId,
      planSha256: plan.planSha256,
      baseSha: plan.base.commit,
      candidateTree: plan.candidate.tree,
      candidateCommit: effect.commit?.sha ?? null,
      targetBranch: plan.targetBranch,
      pullRequest: effect.pullRequest ?? {},
      checks: plan.checksReceipt,
      readback: effect,
      limitations: effect.limitations ?? [],
    };
    writeJson(outFile, receipt);
    fail(effect.status, `remote effect is ${effect.status}`, { receipt: outFile });
  }
  const errors = [];
  const add = (condition, message) => { if (!condition) errors.push(message); };
  add(effect.baseReadback?.ref === plan.base.ref, "base ref mismatch");
  add(effect.baseReadback?.sha === plan.base.commit, "base SHA mismatch");
  const blobResults = Array.isArray(effect.blobs) ? effect.blobs : [];
  const actualBlobs = new Map();
  for (const actual of blobResults) {
    if (!actual || typeof actual.operationId !== "string") { errors.push("blob operation id missing"); continue; }
    if (actualBlobs.has(actual.operationId)) errors.push(`duplicate blob result ${actual.operationId}`);
    else actualBlobs.set(actual.operationId, actual);
  }
  add(blobResults.length === plan.blobOperations.length, "blob result count mismatch");
  const expectedBlobIds = new Set(plan.blobOperations.map((x) => x.operationId));
  for (const operationId of actualBlobs.keys()) add(expectedBlobIds.has(operationId), `unexpected blob ${operationId}`);
  for (const expected of plan.blobOperations) {
    const actual = actualBlobs.get(expected.operationId);
    add(Boolean(actual), `missing blob ${expected.operationId}`);
    if (actual) {
      add(actual.expectedOid === expected.expectedOid, `blob expected OID echo mismatch: ${expected.path}`);
      add(actual.actualOid === expected.expectedOid, `blob actual OID mismatch: ${expected.path}`);
      add(typeof actual.readbackBase64 === "string", `blob authoritative readback missing: ${expected.path}`);
      if (typeof actual.readbackBase64 === "string") {
        try {
          const bytes = canonicalBase64(actual.readbackBase64, `blob readback ${expected.path}`);
          add(bytes.length === expected.bytes, `blob readback byte count mismatch: ${expected.path}`);
          add(sha256(bytes) === expected.payloadSha256, `blob readback payload mismatch: ${expected.path}`);
          add(gitBlobOid(bytes) === expected.expectedOid, `blob readback Git OID mismatch: ${expected.path}`);
        } catch (error) { errors.push(error.message); }
      }
    }
  }
  add(effect.tree?.actualSha === plan.candidate.tree, "candidate tree mismatch");
  add(effect.tree?.expectedSha === plan.candidate.tree, "tree expected SHA echo mismatch");
  add(effect.commit?.parent === plan.base.commit, "commit parent mismatch");
  add(effect.commit?.tree === plan.candidate.tree, "commit tree mismatch");
  add(effect.commit?.message === plan.commit.message, "commit message mismatch");
  add(/^[0-9a-f]{40}$/.test(effect.commit?.sha ?? ""), "candidate commit SHA invalid");
  add(effect.ref?.name === plan.targetBranch, "ref name mismatch");
  add(effect.ref?.sha === effect.commit?.sha, "ref does not point to candidate commit");
  add(effect.pullRequest?.head === plan.pullRequest.head, "PR head mismatch");
  add(effect.pullRequest?.base === plan.pullRequest.base, "PR base mismatch");
  add(effect.pullRequest?.draft === true, "PR is not draft");
  add(Number.isInteger(effect.pullRequest?.number) && effect.pullRequest.number > 0, "PR number invalid");
  add(typeof effect.pullRequest?.url === "string" && effect.pullRequest.url.length > 0, "PR URL invalid");
  add(effect.pullRequest?.matchingCount === 1, "matching PR count is not exactly one");
  if (errors.length) fail("REMOTE_READBACK_MISMATCH", errors.join("; "), { errors });

  const receipt = {
    schema: "ops.gitWriteReceipt.v1",
    status: "PASS",
    requestId: plan.requestId,
    planSha256: plan.planSha256,
    baseSha: plan.base.commit,
    candidateTree: plan.candidate.tree,
    candidateCommit: effect.commit.sha,
    targetBranch: plan.targetBranch,
    pullRequest: effect.pullRequest,
    checks: plan.checksReceipt,
    readback: effect,
    limitations: effect.limitations ?? [],
  };
  writeJson(outFile, receipt);
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  return receipt;
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = argMap(rest);
  try {
    if (command === "prepare") {
      if (!args.request || !args["out-dir"]) fail("USAGE", "prepare requires --request and --out-dir");
      prepare(args.request, args["out-dir"], args["state-dir"]);
    } else if (command === "verify") {
      if (!args.plan || !args["effect-result"] || !args.out) fail("USAGE", "verify requires --plan --effect-result --out");
      verify(args.plan, args["effect-result"], args.out);
    } else fail("USAGE", "usage: prepare|verify");
  } catch (error) {
    const failure = { schema: "ops.gitWriteFailure.v1", status: error.code ?? "FAILED", message: error.message, details: error.details ?? {} };
    process.stderr.write(`${JSON.stringify(failure)}\n`);
    process.exit(1);
  }
}

main();
