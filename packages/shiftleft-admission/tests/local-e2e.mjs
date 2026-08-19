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
const packageRoot = path.resolve(here, "..");
const repoRoot = path.resolve(packageRoot, "../..");
const fixtureRoot = path.join(packageRoot, "local-fixtures");
const policyctl = findExecutable(process.env.POLICYCTL_BIN ?? "policyctl");
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (!(options.allowed ?? [0]).includes(result.status)) {
    throw new Error(`${command} ${args.join(" ")} => ${result.status}\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

function findExecutable(command) {
  if (command.includes(path.sep)) return path.resolve(command);
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const candidate = path.join(dir, command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {}
  }
  throw new Error(`executable not found: ${command}`);
}

function filesUnder(root) {
  const out = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const rel = path.relative(root, full).split(path.sep).join("/");
        if (rel !== "SHA256SUMS") out.push(rel);
      } else throw new Error(`special file: ${full}`);
    }
  }
  walk(root);
  return out.sort();
}

function writeManifest(root) {
  const rows = filesUnder(root).map((rel) => `${sha256(fs.readFileSync(path.join(root, rel)))}  ${rel}`);
  const bytes = `${rows.join("\n")}\n`;
  fs.writeFileSync(path.join(root, "SHA256SUMS"), bytes);
  return `sha256:${sha256(Buffer.from(bytes))}`;
}

function copyFixture(kind, target) {
  fs.cpSync(path.join(fixtureRoot, kind, "workspace"), target, { recursive: true });
  return path.join(fixtureRoot, kind, "task.json");
}

function formalIntake(source, sourceSHA, policyHash, policyRef, target, options = {}) {
  return run(policyctl, [
    "intake",
    "--source-dir", source,
    "--source-kind", "actions-artifact",
    "--source-id", options.sourceID ?? "161",
    "--source-sha256", sourceSHA,
    "--policy-ref", policyRef,
    "--policy-sha256", policyHash,
    "--out-dir", target,
  ], options);
}

function localRun(session, workspace, contract, out, options = {}) {
  return run(path.join(session, "bin", "policyctl"), [
    "run",
    "--session", session,
    "--workspace", workspace,
    "--contract", contract,
    "--out-dir", out,
  ], options);
}

function initArbitraryGitRepo(workspace) {
  run("git", ["init", "--quiet", "--initial-branch=main", workspace]);
  run("git", ["-C", workspace, "config", "user.name", "issue161-proof"]);
  run("git", ["-C", workspace, "config", "user.email", "issue161@example.invalid"]);
  fs.writeFileSync(path.join(workspace, "baseline.txt"), "baseline\n");
  run("git", ["-C", workspace, "add", "baseline.txt"]);
  run("git", ["-C", workspace, "commit", "--quiet", "-m", "baseline"]);
}

function completion(out) {
  return fs.readFileSync(path.join(out, "completion-receipt.json"));
}

function assertFailure(result, pattern) {
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, pattern);
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "issue161-local-e2e-"));
try {
  const source = path.join(temp, "source");
  fs.mkdirSync(source);
  fs.cpSync(path.join(packageRoot, "policy"), path.join(source, "policy"), { recursive: true });
  fs.cpSync(path.join(packageRoot, "adapters"), path.join(source, "adapters"), { recursive: true });
  fs.copyFileSync(policyctl, path.join(source, "policyctl"));
  fs.chmodSync(path.join(source, "policyctl"), 0o755);
  const sourceSHA = writeManifest(source);
  const policyHash = run(policyctl, ["hash", "--bundle", path.join(source, "policy")]).stdout.trim();
  let policyRef = "0123456789abcdef0123456789abcdef01234567";
  const head = run("git", ["-C", repoRoot, "rev-parse", "HEAD"], { allowed: [0, 128] });
  if (head.status === 0 && /^[0-9a-f]{40}$/.test(head.stdout.trim())) policyRef = head.stdout.trim();

  const sessionA = path.join(temp, "session-a");
  const sessionB = path.join(temp, "session-b");
  formalIntake(source, sourceSHA, policyHash, policyRef, sessionA);
  formalIntake(source, sourceSHA, policyHash, policyRef, sessionB);
  assert.deepEqual(
    fs.readFileSync(path.join(sessionA, "intake-receipt.json")),
    fs.readFileSync(path.join(sessionB, "intake-receipt.json")),
  );

  const pyA = path.join(temp, "py-a");
  const pyB = path.join(temp, "py-b");
  const pyContract = copyFixture("python", pyA);
  copyFixture("python", pyB);
  const pyOutA = path.join(temp, "py-out-a");
  const pyOutB = path.join(temp, "py-out-b");
  localRun(sessionA, pyA, pyContract, pyOutA);
  localRun(sessionA, pyB, pyContract, pyOutB);
  assert.deepEqual(completion(pyOutA), completion(pyOutB));
  assert.equal(readJson(path.join(pyOutA, "completion-receipt.json")).status, "COMPLETE");
  assert.equal(readJson(path.join(pyOutA, "completion-receipt.json")).workspaceKind, "directory");

  const jsA = path.join(temp, "js-a");
  const jsB = path.join(temp, "js-b");
  const jsContract = copyFixture("javascript", jsA);
  copyFixture("javascript", jsB);
  initArbitraryGitRepo(jsA);
  initArbitraryGitRepo(jsB);
  const jsOutA = path.join(temp, "js-out-a");
  const jsOutB = path.join(temp, "js-out-b");
  localRun(sessionA, jsA, jsContract, jsOutA);
  localRun(sessionA, jsB, jsContract, jsOutB);
  assert.deepEqual(completion(jsOutA), completion(jsOutB));
  assert.equal(readJson(path.join(jsOutA, "completion-receipt.json")).status, "COMPLETE");
  assert.equal(readJson(path.join(jsOutA, "completion-receipt.json")).workspaceKind, "git");

  const experimentSource = path.join(temp, "experiment-source");
  fs.cpSync(source, experimentSource, { recursive: true });
  fs.rmSync(path.join(experimentSource, "SHA256SUMS"));
  const rulesPath = path.join(experimentSource, "policy", "rules.jsonl");
  fs.writeFileSync(rulesPath, fs.readFileSync(rulesPath, "utf8").replace(
    "Core code does not import runtime or effect adapters.",
    "Local experiment: core code does not import runtime or effect adapters.",
  ));
  const experimentSession = path.join(temp, "experiment-session");
  run(policyctl, [
    "intake",
    "--source-dir", experimentSource,
    "--source-kind", "local-experiment",
    "--out-dir", experimentSession,
  ]);
  const experimentIntake = readJson(path.join(experimentSession, "intake-receipt.json"));
  assert.match(experimentIntake.policyRef, /^local-policy-sha256:[0-9a-f]{64}$/);
  const experimentWorkspace = path.join(temp, "experiment-workspace");
  copyFixture("python", experimentWorkspace);
  const experimentOut = path.join(temp, "experiment-out");
  localRun(experimentSession, experimentWorkspace, pyContract, experimentOut);
  assert.equal(readJson(path.join(experimentOut, "completion-receipt.json")).status, "COMPLETE");

  const experimentGit = path.join(temp, "experiment-git");
  copyFixture("javascript", experimentGit);
  initArbitraryGitRepo(experimentGit);
  const experimentGitOut = path.join(temp, "experiment-git-out");
  localRun(experimentSession, experimentGit, jsContract, experimentGitOut);
  const localAdmission = readJson(path.join(experimentGitOut, "completion-receipt.json")).admission;
  const localAdmissionPath = path.join(temp, "local-admission.json");
  writeJson(localAdmissionPath, localAdmission);
  const formalPromotion = run(path.join(experimentSession, "bin", "policyctl"), [
    "verify-worktree",
    "--receipt", localAdmissionPath,
    "--policy-sha256", experimentIntake.policyHash,
    "--repo", experimentGit,
  ], { allowed: [1] });
  assertFailure(formalPromotion, /FORMAL_POLICY_REQUIRED/);

  const tamperedSource = path.join(temp, "tampered-source");
  fs.cpSync(source, tamperedSource, { recursive: true });
  fs.appendFileSync(path.join(tamperedSource, "adapters", "python_imports.py"), "\n# tampered\n");
  const tampered = formalIntake(
    tamperedSource,
    sourceSHA,
    policyHash,
    policyRef,
    path.join(temp, "tampered-session"),
    { sourceID: "162", allowed: [1] },
  );
  assertFailure(tampered, /SOURCE_FILE_SHA256_MISMATCH/);

  const unmetWorkspace = path.join(temp, "unmet-workspace");
  copyFixture("python", unmetWorkspace);
  fs.writeFileSync(path.join(unmetWorkspace, "core.py"), `import os\n${fs.readFileSync(path.join(unmetWorkspace, "core.py"), "utf8")}`);
  const unmetOut = path.join(temp, "unmet-out");
  const unmet = localRun(sessionA, unmetWorkspace, pyContract, unmetOut, { allowed: [3] });
  assertFailure(unmet, /BLOCKED_RULE/);
  assert.equal(readJson(path.join(unmetOut, "completion-receipt.json")).status, "DRAFT");

  const missingToolWorkspace = path.join(temp, "missing-tool-workspace");
  copyFixture("python", missingToolWorkspace);
  const missingToolOut = path.join(temp, "missing-tool-out");
  const emptyPath = path.join(temp, "empty-path");
  fs.mkdirSync(emptyPath);
  const missingTool = localRun(sessionA, missingToolWorkspace, pyContract, missingToolOut, {
    allowed: [3],
    env: { ...process.env, PATH: emptyPath },
  });
  assertFailure(missingTool, /UNSUPPORTED_REQUIRED_ADAPTER/);
  assert.equal(readJson(path.join(missingToolOut, "completion-receipt.json")).status, "DRAFT");

  const skippedWorkspace = path.join(temp, "skipped-workspace");
  copyFixture("python", skippedWorkspace);
  const skippedContract = readJson(pyContract);
  skippedContract.taskId = "issue161-skipped";
  skippedContract.package.packageId = "issue161-skipped";
  skippedContract.tests = [];
  const skippedPath = path.join(temp, "skipped.json");
  writeJson(skippedPath, skippedContract);
  const skipped = localRun(sessionA, skippedWorkspace, skippedPath, path.join(temp, "skipped-out"), { allowed: [1] });
  assertFailure(skipped, /TASK_TEST_REQUIRED/);

  const driftWorkspace = path.join(temp, "drift-workspace");
  copyFixture("python", driftWorkspace);
  fs.writeFileSync(path.join(driftWorkspace, "drift.py"), "from pathlib import Path\nPath('generated.txt').write_text('drift\\n')\n");
  const driftContract = readJson(pyContract);
  driftContract.taskId = "issue161-drift";
  driftContract.package.packageId = "issue161-drift";
  driftContract.tests.push({ id: "drift", command: ["python3", "drift.py"], timeoutSeconds: 30 });
  const driftPath = path.join(temp, "drift.json");
  writeJson(driftPath, driftContract);
  const driftOut = path.join(temp, "drift-out");
  const drift = localRun(sessionA, driftWorkspace, driftPath, driftOut, { allowed: [3] });
  assertFailure(drift, /CANDIDATE_DRIFT/);
  assert.equal(readJson(path.join(driftOut, "completion-receipt.json")).terminalState, "CANDIDATE_DRIFT");

  process.stdout.write(`${JSON.stringify({
    schema: "issue-161-local-e2e/1",
    status: "PASS",
    formalIntake: "PASS",
    pythonDirectory: "PASS",
    javascriptGit: "PASS",
    localExperiment: "PASS",
    localExperimentFormalPromotion: "BLOCKED",
    tamper: "BLOCKED",
    missingTool: "BLOCKED",
    skippedTest: "BLOCKED",
    unmetRule: "BLOCKED",
    candidateDrift: "BLOCKED",
  })}\n`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
