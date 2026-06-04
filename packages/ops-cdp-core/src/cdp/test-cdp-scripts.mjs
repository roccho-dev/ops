import * as std from './core/std.mjs';
import * as os from './core/os.mjs';

import { CdpError } from "./lib.mjs";
import { assertProjectThreadUrlMatchesProject, projectIdsCompatible } from "./domain/chatgpt/shared.mjs";
import {
  materializeThreadIr,
  materializeDownloadResolveIr,
  materializeInventoryIr,
  materializeSearchIr,
} from "./domain/chatgpt/ir.mjs";

let passed = 0;
let failed = 0;
let nextTmpId = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
    std.out.puts(`  PASS: ${msg}\n`);
  } else {
    failed++;
    std.out.puts(`  FAIL: ${msg}\n`);
  }
}

function tmpPath(prefix) {
  nextTmpId++;
  return `/tmp/${prefix}_${os.getpid()}_${Date.now()}_${nextTmpId}`;
}

function shellQuote(value) {
  const s = String(value);
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

function exitCode(status) {
  const n = Number(status) || 0;
  return n > 255 ? (n >> 8) : n;
}

function scriptPath(script) {
  let s = String(script || "");
  s = s.replace(/^parts\/cdp\//, "");
  if (s[0] === "/") return s;
  const root = String(std.getenv("HQ_CDP_SCRIPT_SRC") || ".").replace(/\/+$/, "");
  return `${root}/${s}`;
}

function runQjs(script, args) {
  const qjs = String(std.getenv("HQ_CDP_QJS") || "qjs");
  const outPath = tmpPath("cdp_test_out") + ".txt";
  const errPath = tmpPath("cdp_test_err") + ".txt";
  const argv = [qjs, "--std", "-m", scriptPath(script), ...(args || [])];
  const command = argv.map(shellQuote).join(" ") + ` >${shellQuote(outPath)} 2>${shellQuote(errPath)}`;
  try {
    const pipe = std.popen(command, "r");
    while (!pipe.eof()) {
      const line = pipe.getline();
      if (line === null) break;
    }
    const rc = exitCode(pipe.close());
    const stdoutText = std.loadFile(outPath) || "";
    const stderrText = std.loadFile(errPath) || "";
    return { rc, stdoutText: String(stdoutText), stderrText: String(stderrText), command };
  } finally {
    try { os.remove(outPath); } catch {}
    try { os.remove(errPath); } catch {}
  }
}

function runShell(command) {
  const pipe = std.popen(String(command || "") + " 2>&1", "r");
  let out = "";
  while (!pipe.eof()) {
    const line = pipe.getline();
    if (line === null) break;
    out += line + "\n";
  }
  const rc = exitCode(pipe.close());
  return { rc, out };
}

function mustShell(command) {
  const r = runShell(command);
  if (r.rc !== 0) throw new Error(`command failed rc=${r.rc}: ${command}\n${r.out}`);
  return r.out;
}

function writeJson(path, value) {
  std.writeFile(path, JSON.stringify(value, null, 2) + "\n");
}

std.out.puts("=== CDP Scripts Integration Tests ===\n");

std.out.puts("\n=== Project URL Guard Tests ===\n");
assert(projectIdsCompatible("abc", "abc"), "same project ids are compatible");
assert(projectIdsCompatible("abc", "abc-worker"), "project thread slug may suffix the project id");
try {
  const check = assertProjectThreadUrlMatchesProject(
    "https://chatgpt.com/g/g-p-abc-worker/c/6a06f8d0-b8ec-83aa-9e07-c675e0ef4f93",
    "https://chatgpt.com/g/g-p-abc/project",
    "test thread",
  );
  assert(check.projectId === "abc" && check.threadProjectId === "abc-worker", "thread URL is bound to projectUrl");
} catch (e) {
  assert(false, `project/thread compatibility unexpectedly failed: ${String(e)}`);
}
try {
  assertProjectThreadUrlMatchesProject("https://chatgpt.com/c/6a06f8d0-b8ec-83aa-9e07-c675e0ef4f93", "https://chatgpt.com/g/g-p-abc/project", "test thread");
  assert(false, "non-project thread URL should be rejected");
} catch (_) {
  assert(true, "non-project thread URL is rejected for Project Source dependent sends");
}

const testCases = [
  { script: "read-thread.mjs", args: ["--help"], helpRc: 2, helpStream: "stderr" },
  { script: "send-chatgpt.mjs", args: ["--help"], helpRc: 2, helpStream: "stderr" },
  { script: "search-chatgpt.mjs", args: ["--help"], helpRc: 0, helpStream: "stdout" },
  { script: "project-inventory.mjs", args: ["--help"], helpRc: 2, helpStream: "stderr" },
  { script: "download-chatgpt-artifacts.mjs", args: ["--help"], helpRc: 2, helpStream: "stderr" },
  { script: "chromium-cdp-downloads-quarantine.mjs", args: ["--help"], helpRc: 2, helpStream: "stderr" },
  { script: "chromium-cdp-fetch-artifact-strict.mjs", args: ["--help"], helpRc: 2, helpStream: "stderr" },
  { script: "chromium-cdp-recover-artifact-set.mjs", args: ["--help"], helpRc: 2, helpStream: "stderr" },
  { script: "chromium-cdp-wait-artifacts.mjs", args: ["--help"], helpRc: 2, helpStream: "stderr" },
  { script: "chromium-cdp-worker-artifact-validate.mjs", args: ["--help"], helpRc: 2, helpStream: "stderr" },
  { script: "chromium-cdp-worker-apply.mjs", args: ["--help"], helpRc: 2, helpStream: "stderr" },
  { script: "chromium-cdp-worker-am-apply.mjs", args: ["--help"], helpRc: 2, helpStream: "stderr" },
  { script: "chromium-cdp-worker-merge-queue.mjs", args: ["--help"], helpRc: 2, helpStream: "stderr" },
  { script: "chromium-cdp-upload-project-source-text.mjs", args: ["--help"], helpRc: 2, helpStream: "stderr" },
  { script: "chromium-cdp-upload-project-source-file.mjs", args: ["--help"], helpRc: 2, helpStream: "stderr" },
  { script: "chromium-cdp-project-access-probe.mjs", args: ["--help"], helpRc: 2, helpStream: "stderr" },
  { script: "chromium-cdp-source-snapshot-text.mjs", args: ["--help"], helpRc: 2, helpStream: "stderr" },
  { script: "chromium-cdp-project-source-reread.mjs", args: ["--help"], helpRc: 2, helpStream: "stderr" },
  { script: "chromium-cdp-host-git-two-worker-smoke.mjs", args: ["--help"], helpRc: 2, helpStream: "stderr" },
  { script: "chromium-cdp-host-git-workflow-regression.mjs", args: ["--help"], helpRc: 2, helpStream: "stderr" },
  { script: "chromium-cdp-package-run.mjs", args: ["--help"], helpRc: 2, helpStream: "stderr" },
  { script: "chromium-cdp-package-run-state.mjs", args: ["--help"], helpRc: 2, helpStream: "stderr" },
  { script: "chromium-cdp-git-ref-health.mjs", args: ["--help"], helpRc: 2, helpStream: "stderr" },
  { script: "chromium-cdp-thread-ledger.mjs", args: ["--help"], helpRc: 2, helpStream: "stderr" },
  { script: "projectize-thread.mjs", args: ["--help"], helpRc: 2, helpStream: "stderr" },
  { script: "hq-threads.mjs", args: ["--help"], helpRc: 2, helpStream: "stderr" },
];

for (const tc of testCases) {
  std.out.puts(`\nTesting: ${tc.script} ${tc.args.join(" ")}\n`);
  const r = runQjs(tc.script, tc.args);
  const helpText = tc.helpStream === "stdout" ? r.stdoutText : r.stderrText;
  if (r.rc === tc.helpRc && /usage:/i.test(helpText)) {
    passed++;
    std.out.puts(`  PASS: ${tc.script} returns usage on --help\n`);
  } else {
    failed++;
    std.out.puts(`  FAIL: ${tc.script} did not return usage on --help\n`);
    std.out.puts(`    rc=${r.rc}, stdout=${r.stdoutText.slice(0, 120)}, stderr=${r.stderrText.slice(0, 120)}\n`);
  }
}

std.out.puts("\n=== Host Artifact Orchestration Contract Test ===\n");

const hostWorkflowDoc = String(std.loadFile(scriptPath("docs/host-git-project-workflow.md")) || "");
const commandMapDoc = String(std.loadFile(scriptPath("docs/chatgpt-command-map.md")) || "");
const canonMatrixDoc = String(std.loadFile(scriptPath("docs/refactoring-canon-tdd.md")) || "");
const packageThreadSchemasDoc = String(std.loadFile(scriptPath("docs/package-thread-schemas.md")) || "");
const validateSrc = String(std.loadFile(scriptPath("chromium-cdp-worker-artifact-validate.mjs")) || "");
const applySrc = String(std.loadFile(scriptPath("chromium-cdp-worker-apply.mjs")) || "");
const amApplySrc = String(std.loadFile(scriptPath("chromium-cdp-worker-am-apply.mjs")) || "");
const packageRunStateSrc = String(std.loadFile(scriptPath("chromium-cdp-package-run-state.mjs")) || "");

assert(
  hostWorkflowDoc.includes("cdp/package-run") &&
  hostWorkflowDoc.includes("host orchestration") &&
  hostWorkflowDoc.includes("patch") &&
  hostWorkflowDoc.includes("mbox") &&
  hostWorkflowDoc.includes("bundle") &&
  hostWorkflowDoc.includes("result.json"),
  "package-run artifact contract is documented as host orchestration",
);
assert(
  commandMapDoc.includes("thread/package 成果物を形式別に受け取り・検証・適用する") &&
  commandMapDoc.includes("chromium-cdp-package-run") &&
  commandMapDoc.includes("patch") &&
  commandMapDoc.includes("mbox") &&
  commandMapDoc.includes("bundle"),
  "command map routes package/thread artifact integration through host orchestration commands",
);
assert(
  commandMapDoc.includes("chromium-cdp-package-run-state") &&
  commandMapDoc.includes("run.json") &&
  hostWorkflowDoc.includes("package-run state contract"),
  "package-run state machine is documented separately from artifact application",
);
assert(
  packageThreadSchemasDoc.includes("TASK_QUEUE.tsv") &&
  packageThreadSchemasDoc.includes("SPEC_MATRIX.tsv") &&
  packageThreadSchemasDoc.includes("REVIEW_GATE.tsv") &&
  packageThreadSchemasDoc.includes("MERGE_COVERAGE.tsv") &&
  packageThreadSchemasDoc.includes("HOST_VALIDATION.json") &&
  packageThreadSchemasDoc.includes("RETRY_REQUEST.json") &&
  packageThreadSchemasDoc.includes("FINAL_REPORT.json"),
  "phase schemas document plan, impl, review, host validation, retry, merge coverage, and final report contracts",
);
assert(
  canonMatrixDoc.includes("| 35 | package-run artifact contract |") &&
  canonMatrixDoc.includes("`cdp/package-run`, `chromium-cdp-package-run`, host-git orchestration") &&
  canonMatrixDoc.includes("| refactored |"),
  "canon-tdd matrix has refactored package-run artifact contract row",
);
assert(
  validateSrc.includes("--result <result.json> --patch <changes.patch>") &&
  validateSrc.includes('["apply", "--check", args.patch]') &&
  validateSrc.includes("baseRev mismatch"),
  "result.json plus patch validation is owned by host worker-artifact-validate",
);
assert(
  applySrc.includes('git(args.worktree, ["apply", "--check", args.patch]') &&
  applySrc.includes("testCmd") &&
  applySrc.includes("commit"),
  "patch apply, test, and commit are owned by host worker-apply",
);
assert(
  amApplySrc.includes("patchFormat") &&
  amApplySrc.includes("git-format-patch-mbox") &&
  amApplySrc.includes('["am", "--3way", args.mbox]') &&
  amApplySrc.includes("patchCount"),
  "mbox series apply is owned by host worker-am-apply",
);
assert(
  packageRunStateSrc.includes("qualityGate") &&
  packageRunStateSrc.includes("record-timeout") &&
  packageRunStateSrc.includes("implDidNotWeakenTests") &&
  packageRunStateSrc.includes("workerSourceReadbackValidated") &&
  packageRunStateSrc.includes("updatedTargetHonored") &&
  packageRunStateSrc.includes("review-format-failed") &&
  packageRunStateSrc.includes("cannot finalize without review quality pass"),
  "package-run-state keeps canon-tdd/source-readback review quality gates and separates review format failures",
);

std.out.puts("\n=== Thread Ledger Contract Test ===\n");

const ledgerPath = tmpPath("thread_ledger") + ".json";
const ledgerPromptPath = tmpPath("thread_ledger_prompt") + ".txt";
std.writeFile(ledgerPromptPath, "short prompt\n");
const ledgerInit = runQjs("chromium-cdp-thread-ledger.mjs", [
  "init",
  "--ledger", ledgerPath,
  "--owner", "zeal0/9",
  "--task", "thread-ledger-test",
  "--json",
]);
const ledgerRegister = runQjs("chromium-cdp-thread-ledger.mjs", [
  "register",
  "--ledger", ledgerPath,
  "--owner", "zeal0/9",
  "--index", "3",
  "--role", "review",
  "--url", "https://chatgpt.com/c/thread-ledger-test",
  "--json",
]);
const ledgerPrompt = runQjs("chromium-cdp-thread-ledger.mjs", [
  "interaction",
  "--ledger", ledgerPath,
  "--thread", "zeal0/9/thread/3",
  "--kind", "prompt",
  "--promptPath", ledgerPromptPath,
  "--ok",
  "--json",
]);
const ledgerReport = runQjs("chromium-cdp-thread-ledger.mjs", [
  "interaction",
  "--ledger", ledgerPath,
  "--thread", "zeal0/9/thread/3",
  "--kind", "report",
  "--summary", "review returned expected schema",
  "--artifact", "review.result.json",
  "--ok",
  "--json",
]);
const ledgerSummary = runQjs("chromium-cdp-thread-ledger.mjs", [
  "summary",
  "--ledger", ledgerPath,
  "--json",
]);
let ledgerParsed = null;
try { ledgerParsed = JSON.parse(ledgerSummary.stdoutText); } catch {}
assert(
  ledgerInit.rc === 0 &&
  ledgerRegister.rc === 0 &&
  ledgerPrompt.rc === 0 &&
  ledgerReport.rc === 0 &&
  ledgerSummary.rc === 0 &&
  ledgerParsed &&
  ledgerParsed.summary.threadCount === 1 &&
  ledgerParsed.summary.interactionCount === 2 &&
  ledgerParsed.summary.promptCount === 1 &&
  ledgerParsed.summary.reportCount === 1 &&
  ledgerParsed.summary.promptChars === 13 &&
  ledgerParsed.summary.threads[0].actor === "zeal0/9/thread/3",
  "thread-ledger records 0/N/thread numbering, prompt size, and reports",
);
try { os.remove(ledgerPath); } catch {}
try { os.remove(ledgerPromptPath); } catch {}

std.out.puts("\n=== Package Run State Machine Test ===\n");

const stateRoot = tmpPath("package_run_state");
const stateRepo = `${stateRoot}/repo`;
const stateArtifacts = `${stateRoot}/artifacts`;
const stateRunDir = `${stateRoot}/run`;
mustShell(`mkdir -p ${shellQuote(stateRepo)} ${shellQuote(stateArtifacts)} ${shellQuote(stateRunDir)}`);
mustShell(`git -C ${shellQuote(stateRepo)} init -q`);
mustShell(`git -C ${shellQuote(stateRepo)} config user.email cdp-state@example.invalid`);
mustShell(`git -C ${shellQuote(stateRepo)} config user.name 'CDP State'`);
std.writeFile(`${stateRepo}/pkg.txt`, "base\n");
mustShell(`git -C ${shellQuote(stateRepo)} add pkg.txt`);
mustShell(`git -C ${shellQuote(stateRepo)} commit -q -m base`);
const stateBaseRev = mustShell(`git -C ${shellQuote(stateRepo)} rev-parse HEAD`).trim();
writeJson(`${stateArtifacts}/pkg-state-impl-a1.result.json`, {
  worker: "pkg-state-impl",
  baseRev: stateBaseRev,
  status: "ready",
  filesChanged: ["pkg.txt"],
});
std.writeFile(`${stateArtifacts}/pkg-state-impl-a1.changes.patch`, [
  "--- a/pkg.txt",
  "+++ b/pkg.txt",
  "@@ -1 +1 @@",
  "-base",
  "+state",
  "",
].join("\n"));
writeJson(`${stateArtifacts}/pkg-state-review-a1.result.json`, {
  schema: "cdp.packageReview.v1",
  reviewer: "pkg-state-review",
  targetRevision: "pkg-state-a1",
  reviewedArtifacts: [
    "pkg-state-impl-a1.result.json",
    "pkg-state-impl-a1.changes.patch",
  ],
  previousTargetIgnored: true,
  formatOk: true,
  baseRev: stateBaseRev,
  verdict: "pass",
  qualityGate: {
    requirementsDefined: "pass",
    specTableComplete: "pass",
    testsMeasureSpecs: "pass",
    canonTddPriorityOrder: "pass",
    canonTddCycleEvidence: "pass",
    ciGateDefined: "pass",
    implDidNotWeakenTests: "pass",
    workerSourceReadbackValidated: "pass",
    readOnlySourceValidated: "pass",
    nativePathChecksRunOrCarried: "pass",
    updatedTargetHonored: "pass",
  },
  blockingIssues: [],
  retryInstruction: null,
});
std.writeFile(`${stateArtifacts}/pkg-state-review-a1.txt`, "review quality pass\n");

const stateInit = runQjs("chromium-cdp-package-run-state.mjs", [
  "init",
  "--runDir", stateRunDir,
  "--package", "pkg-state",
  "--repo", stateRepo,
  "--baseRev", stateBaseRev,
  "--json",
]);
const stateCollect = runQjs("chromium-cdp-package-run-state.mjs", [
  "collect-impl",
  "--runDir", stateRunDir,
  "--fromDir", stateArtifacts,
  "--json",
]);
const stateValidate = runQjs("chromium-cdp-package-run-state.mjs", [
  "validate-host",
  "--runDir", stateRunDir,
  "--noTest",
  "--json",
]);
const stateReviewPrompt = runQjs("chromium-cdp-package-run-state.mjs", [
  "review-prompt",
  "--runDir", stateRunDir,
  "--json",
]);
const stateReview = runQjs("chromium-cdp-package-run-state.mjs", [
  "collect-review",
  "--runDir", stateRunDir,
  "--fromDir", stateArtifacts,
  "--json",
]);
const stateFinalize = runQjs("chromium-cdp-package-run-state.mjs", [
  "finalize",
  "--runDir", stateRunDir,
  "--json",
]);
assert(
  stateInit.rc === 0 &&
  stateCollect.rc === 0 &&
  stateValidate.rc === 0 &&
  stateReviewPrompt.rc === 0 &&
  stateReview.rc === 0 &&
  stateFinalize.rc === 0 &&
  JSON.parse(stateFinalize.stdoutText).state === "finalized",
  "package-run-state reaches finalized only after host validation and review quality pass",
);

const timeoutRunDir = `${stateRoot}/run-timeout`;
const timeoutInit = runQjs("chromium-cdp-package-run-state.mjs", [
  "init",
  "--runDir", timeoutRunDir,
  "--package", "pkg-timeout",
  "--repo", stateRepo,
  "--baseRev", stateBaseRev,
  "--json",
]);
const timeoutRecord = runQjs("chromium-cdp-package-run-state.mjs", [
  "record-timeout",
  "--runDir", timeoutRunDir,
  "--role", "impl",
  "--reason", "artifact wait exceeded",
  "--json",
]);
const timeoutRetry = runQjs("chromium-cdp-package-run-state.mjs", [
  "retry-impl",
  "--runDir", timeoutRunDir,
  "--dryRun",
  "--json",
]);
let timeoutParsed = null;
let retryParsed = null;
try { timeoutParsed = JSON.parse(timeoutRecord.stdoutText); } catch {}
try { retryParsed = JSON.parse(timeoutRetry.stdoutText); } catch {}
assert(
  timeoutInit.rc === 0 &&
  timeoutRecord.rc === 1 &&
  timeoutRetry.rc === 0 &&
  timeoutParsed &&
  timeoutParsed.state === "impl-artifacts-timeout" &&
  retryParsed &&
  String(std.loadFile(retryParsed.promptPath) || "").includes("timed out without required artifacts"),
  "package-run-state records artifact timeout and turns it into bounded retry prompt",
);

const reviewFailRunDir = `${stateRoot}/run-review-fail`;
const reviewFailArtifacts = `${stateRoot}/artifacts-review-fail`;
mustShell(`mkdir -p ${shellQuote(reviewFailRunDir)} ${shellQuote(reviewFailArtifacts)}`);
writeJson(`${reviewFailArtifacts}/pkg-review-fail-review-a1.result.json`, {
  schema: "cdp.packageReview.v1",
  reviewer: "pkg-review-fail-review",
  targetRevision: "pkg-review-fail-a1",
  reviewedArtifacts: [
    "pkg-review-fail-impl-a1.result.json",
    "pkg-review-fail-impl-a1.changes.patch",
  ],
  previousTargetIgnored: true,
  formatOk: true,
  baseRev: stateBaseRev,
  verdict: "fail",
  qualityGate: {
    requirementsDefined: "pass",
    specTableComplete: "pass",
    testsMeasureSpecs: "pass",
    canonTddPriorityOrder: "pass",
    canonTddCycleEvidence: "pass",
    ciGateDefined: "pass",
    implDidNotWeakenTests: "pass",
    workerSourceReadbackValidated: "pass",
    readOnlySourceValidated: "not-run",
    nativePathChecksRunOrCarried: "not-run",
    updatedTargetHonored: "pass",
  },
  blockingIssues: [{
    id: "HOST_VALIDATION_MISSING",
    severity: "blocker",
    summary: "host evidence missing",
    requiredResolution: "run host validation",
  }],
  retryInstruction: { sendTo: "host", summary: "run host validation" },
});
std.writeFile(`${reviewFailArtifacts}/pkg-review-fail-review-a1.txt`, "review quality fail\n");
const reviewFailInit = runQjs("chromium-cdp-package-run-state.mjs", [
  "init",
  "--runDir", reviewFailRunDir,
  "--package", "pkg-review-fail",
  "--repo", stateRepo,
  "--baseRev", stateBaseRev,
  "--json",
]);
const reviewFailCollect = runQjs("chromium-cdp-package-run-state.mjs", [
  "collect-review",
  "--runDir", reviewFailRunDir,
  "--fromDir", reviewFailArtifacts,
  "--json",
]);
let reviewFailParsed = null;
try { reviewFailParsed = JSON.parse(reviewFailCollect.stdoutText); } catch {}
assert(
  reviewFailInit.rc === 0 &&
  reviewFailCollect.rc === 1 &&
  reviewFailParsed &&
  reviewFailParsed.state === "review-quality-failed" &&
  reviewFailParsed.reviewValidation &&
  reviewFailParsed.reviewValidation.formatOk === true,
  "package-run-state treats a well-formed review fail as quality failure, not format failure",
);

const reviewStaleRunDir = `${stateRoot}/run-review-stale`;
const reviewStaleArtifacts = `${stateRoot}/artifacts-review-stale`;
mustShell(`mkdir -p ${shellQuote(reviewStaleRunDir)} ${shellQuote(reviewStaleArtifacts)}`);
writeJson(`${reviewStaleArtifacts}/pkg-review-stale-review-a1.result.json`, {
  schema: "cdp.packageReview.v1",
  reviewer: "pkg-review-stale-review",
  targetRevision: "old-target",
  reviewedArtifacts: [
    "pkg-review-stale-impl-a1.result.json",
    "pkg-review-stale-impl-a1.changes.patch",
  ],
  previousTargetIgnored: true,
  formatOk: true,
  baseRev: stateBaseRev,
  verdict: "fail",
  qualityGate: {
    requirementsDefined: "pass",
    specTableComplete: "pass",
    testsMeasureSpecs: "pass",
    canonTddPriorityOrder: "pass",
    canonTddCycleEvidence: "pass",
    ciGateDefined: "pass",
    implDidNotWeakenTests: "pass",
    workerSourceReadbackValidated: "not-run",
    readOnlySourceValidated: "not-run",
    nativePathChecksRunOrCarried: "not-run",
    updatedTargetHonored: "fail",
  },
  blockingIssues: [{
    id: "REVIEW_TARGET_STALE",
    severity: "blocker",
    summary: "old target reviewed",
    requiredResolution: "review latest target",
  }],
  retryInstruction: { sendTo: "review", summary: "review latest target" },
});
std.writeFile(`${reviewStaleArtifacts}/pkg-review-stale-review-a1.txt`, "review stale\n");
const reviewStaleInit = runQjs("chromium-cdp-package-run-state.mjs", [
  "init",
  "--runDir", reviewStaleRunDir,
  "--package", "pkg-review-stale",
  "--repo", stateRepo,
  "--baseRev", stateBaseRev,
  "--json",
]);
const reviewStaleCollect = runQjs("chromium-cdp-package-run-state.mjs", [
  "collect-review",
  "--runDir", reviewStaleRunDir,
  "--fromDir", reviewStaleArtifacts,
  "--json",
]);
let reviewStaleParsed = null;
try { reviewStaleParsed = JSON.parse(reviewStaleCollect.stdoutText); } catch {}
assert(
  reviewStaleInit.rc === 0 &&
  reviewStaleCollect.rc === 1 &&
  reviewStaleParsed &&
  reviewStaleParsed.state === "review-format-failed" &&
  reviewStaleParsed.reviewValidation &&
  reviewStaleParsed.reviewValidation.formatOk === false,
  "package-run-state rejects stale review target revisions as review format failures",
);

std.out.puts("\n=== IR Warm Path Test ===\n");

std.out.puts("\n=== CDP Wait Clock Contract Test ===\n");

const readThreadSrc = String(std.loadFile(scriptPath("read-thread.mjs")) || "");
const waitArtifactsSrc = String(std.loadFile(scriptPath("chromium-cdp-wait-artifacts.mjs")) || "");
assert(
  readThreadSrc.includes("Date.now() + Math.max(0, Number(args.waitMs)") &&
  !readThreadSrc.includes("os.now() + Math.max(0, Number(args.waitMs)") &&
  !readThreadSrc.includes("os.now() < deadline"),
  "read-thread waitMs deadline uses Date.now milliseconds, not qjs os.now microseconds",
);
assert(
  waitArtifactsSrc.includes("const start = Date.now()") &&
  waitArtifactsSrc.includes("Date.now() >= deadline") &&
  !waitArtifactsSrc.includes("os.now()"),
  "wait-artifacts timeoutMs and elapsedMs use Date.now milliseconds",
);
assert(
  waitArtifactsSrc.includes("timeoutMs: 1800000") &&
  waitArtifactsSrc.includes("intervalMs: 600000"),
  "wait-artifacts defaults to account-safe 10 minute polling for Extended Pro workflows",
);

const irPath = `/tmp/test-chatgpt-ir-${os.getpid()}.json`;
writeJson(irPath, materializeThreadIr({
  captured_at: new Date().toISOString(),
  url: "https://chatgpt.com/c/11111111-2222-3333-4444-555555555555",
  title: "Warm path thread",
  source: { kind: "cdp-live", addr: "127.0.0.1", port: 9222, target_id: "page-1" },
  visible_messages: [
    { idx: 0, role: "user", text: "hello" },
    { idx: 1, role: "assistant", text: "world" },
  ],
  artifacts: [
    {
      name: "warm.zip",
      locator: { kind: "chip", label: "warm.zip", href: "", match: "button" },
      download: { method: "chip_click", filename_expected: "warm.zip" },
    },
  ],
  final_result: {
    href: "https://chatgpt.com/c/11111111-2222-3333-4444-555555555555",
    title: "Warm path thread",
    readyState: "complete",
    msgCount: 2,
    hasPrompt: true,
    isStreaming: false,
    stableRounds: 1,
    hits: [],
    last: [{ idx: 1, role: "assistant", preview: "world", textLen: 5 }],
  },
}));
try {
  const r = runQjs("read-thread.mjs", [
    "--url", "https://chatgpt.com/c/11111111-2222-3333-4444-555555555555",
    "--irPath", irPath,
    "--preferIr",
    "--maxAgeSec", "3600",
    "--stats",
    "--addr", "127.0.0.1",
    "--port", "1",
  ]);
  try {
    const parsed = JSON.parse(r.stdoutText);
    const stats = parsed && parsed.stats ? parsed.stats : null;
    const noCdp = !!(stats && stats.ir_hit === true && stats.cdp &&
      Number(stats.cdp.list_count) === 0 && Number(stats.cdp.call_count) === 0 &&
      Number(stats.cdp.evaluate_count) === 0 && Number(stats.cdp.navigate_count) === 0);
    const hasArtifacts = Array.isArray(parsed.artifacts) && parsed.artifacts.length === 1 && parsed.artifacts[0].name === "warm.zip";
    assert(r.rc === 0 && noCdp && hasArtifacts, "read-thread warm path uses IR without live CDP access and restores artifacts");
  } catch (e) {
    failed++;
    std.out.puts(`  FAIL: IR warm path parse error: ${e}\n`);
    std.out.puts(`    stderr=${r.stderrText.slice(0, 200)}\n`);
  }
} finally {
  try { os.remove(irPath); } catch {}
}

std.out.puts("\n=== Search IR Warm Path Test ===\n");

const searchIrPath = `/tmp/test-chatgpt-search-ir-${os.getpid()}.json`;
writeJson(searchIrPath, materializeSearchIr({
  captured_at: new Date().toISOString(),
  query: "world",
  source: { kind: "cdp-live", addr: "127.0.0.1", port: 9222, target_id: "page-search" },
  results: [
    { href: "https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", title: "hello world" },
  ],
}));
try {
  const r = runQjs("search-chatgpt.mjs", [
    "--search", "world",
    "--irPath", searchIrPath,
    "--preferIr",
    "--maxAgeSec", "3600",
    "--stats",
    "--addr", "127.0.0.1",
    "--port", "1",
  ]);
  try {
    const parsed = JSON.parse(r.stdoutText);
    const stats = parsed && parsed.stats ? parsed.stats : null;
    const noCdp = !!(stats && stats.ir_hit === true && stats.cdp &&
      Number(stats.cdp.list_count) === 0 && Number(stats.cdp.call_count) === 0 &&
      Number(stats.cdp.evaluate_count) === 0 && Number(stats.cdp.navigate_count) === 0);
    assert(r.rc === 0 && noCdp, "search-chatgpt warm path uses IR without live CDP access");
  } catch (e) {
    failed++;
    std.out.puts(`  FAIL: search IR warm path parse error: ${e}\n`);
    std.out.puts(`    stderr=${r.stderrText.slice(0, 200)}\n`);
  }
} finally {
  try { os.remove(searchIrPath); } catch {}
}

std.out.puts("\n=== Inventory IR Warm Path Test ===\n");

const inventoryIrPath = `/tmp/test-chatgpt-inventory-ir-${os.getpid()}.json`;
writeJson(inventoryIrPath, materializeInventoryIr({
  ts_utc: new Date().toISOString(),
  addr: "127.0.0.1",
  port: 9222,
  base: { url: "https://chatgpt.com/" },
  projects: [
    { name: "Project A", project_id: "abc123", url: "https://chatgpt.com/g/g-p-abc123/project" },
  ],
  unprojected_threads: [
    { title: "Loose thread", thread_id: "11111111-2222-3333-4444-555555555555", url: "https://chatgpt.com/c/11111111-2222-3333-4444-555555555555" },
  ],
  projected_threads: {
    abc123: [
      { title: "Project thread", thread_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", date: "Today", url: "https://chatgpt.com/g/g-p-abc123/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
    ],
  },
}));
try {
  const r = runQjs("project-inventory.mjs", [
    "--irPath", inventoryIrPath,
    "--preferIr",
    "--maxAgeSec", "3600",
    "--addr", "127.0.0.1",
    "--port", "1",
  ]);
  const ok = r.rc === 0 && /PROJECT_INVENTORY/.test(r.stdoutText) && !/error/i.test(r.stderrText);
  assert(ok, "project-inventory warm path renders from IR without live CDP access");
} finally {
  try { os.remove(inventoryIrPath); } catch {}
}

function assertDownloadNoCdp(stdoutText, rc, label, filePath) {
  try {
    const parsed = JSON.parse(stdoutText);
    const stats = parsed && parsed.stats ? parsed.stats : null;
    const noCdp = !!(stats && stats.ir_hit === true && stats.cdp &&
      Number(stats.cdp.list_count) === 0 && Number(stats.cdp.call_count) === 0 &&
      Number(stats.cdp.evaluate_count) === 0 && Number(stats.cdp.navigate_count) === 0);
    const copied = !filePath || std.loadFile(filePath) !== null;
    assert(rc === 0 && copied && noCdp, label);
  } catch (e) {
    failed++;
    std.out.puts(`  FAIL: ${label} parse error: ${e}\n`);
  }
}

std.out.puts("\n=== Download IR Warm Path Test ===\n");

const downloadIrPath = `/tmp/test-chatgpt-download-ir-${os.getpid()}.json`;
const downloadOutDir = `/tmp/test-chatgpt-download-out-${os.getpid()}`;
try { os.mkdir(downloadOutDir, 0o755); } catch {}
writeJson(downloadIrPath, materializeDownloadResolveIr({
  captured_at: new Date().toISOString(),
  url: "https://chatgpt.com/c/11111111-2222-3333-4444-555555555555",
  source: { kind: "cdp-live", addr: "127.0.0.1", port: 9222, target_id: "page-download" },
  targets: [{ name: "PATCH.diff", locator: { kind: "chip", label: "PATCH.diff", href: "", match: "button" }, download: { method: "chip_click", filename_expected: "PATCH.diff" } }],
}));
try {
  const r = runQjs("download-chatgpt-artifacts.mjs", [
    "--outDir", downloadOutDir,
    "--irPath", downloadIrPath,
    "--preferIr",
    "--maxAgeSec", "3600",
    "--resolveOnly",
    "--stats",
    "--addr", "127.0.0.1",
    "--port", "1",
  ]);
  assertDownloadNoCdp(r.stdoutText, r.rc, "download resolve warm path uses IR without live CDP access", null);
} finally {
  try { os.remove(downloadIrPath); } catch {}
  try { os.remove(downloadOutDir); } catch {}
}

std.out.puts("\n=== Download IR Fetch From IR Test ===\n");

const downloadFetchIrPath = `/tmp/test-chatgpt-download-fetch-ir-${os.getpid()}.json`;
const downloadFetchOutDir = `/tmp/test-chatgpt-download-fetch-out-${os.getpid()}`;
const downloadFetchDownloadsDir = `/tmp/test-chatgpt-download-fetch-downloads-${os.getpid()}`;
try { os.mkdir(downloadFetchOutDir, 0o755); } catch {}
try { os.mkdir(downloadFetchDownloadsDir, 0o755); } catch {}
std.writeFile(`${downloadFetchDownloadsDir}/PATCH.diff`, "hello from ir-only fetch\n");
writeJson(downloadFetchIrPath, materializeDownloadResolveIr({
  captured_at: new Date().toISOString(),
  url: "https://chatgpt.com/c/11111111-2222-3333-4444-555555555555",
  source: { kind: "cdp-live", addr: "127.0.0.1", port: 9222, target_id: "page-download" },
  targets: [{ name: "PATCH.diff", locator: { kind: "chip", label: "PATCH.diff", href: "", match: "button" }, download: { method: "chip_click", filename_expected: "PATCH.diff" } }],
}));
try {
  const r = runQjs("download-chatgpt-artifacts.mjs", [
    "--outDir", downloadFetchOutDir,
    "--downloadsDir", downloadFetchDownloadsDir,
    "--irPath", downloadFetchIrPath,
    "--preferIr",
    "--reuseExisting",
    "--maxAgeSec", "3600",
    "--stats",
    "--addr", "127.0.0.1",
    "--port", "1",
  ]);
  assertDownloadNoCdp(r.stdoutText, r.rc, "download fetch can run from IR without url/name or live CDP when file already exists", `${downloadFetchOutDir}/PATCH.diff`);
} finally {
  try { os.remove(downloadFetchIrPath); } catch {}
  try { os.remove(`${downloadFetchOutDir}/PATCH.diff`); } catch {}
  try { os.remove(downloadFetchOutDir); } catch {}
  try { os.remove(`${downloadFetchDownloadsDir}/PATCH.diff`); } catch {}
  try { os.remove(downloadFetchDownloadsDir); } catch {}
}

std.out.puts("\n=== Download Fetch From Thread IR Test ===\n");

const threadDownloadIrPath = `/tmp/test-chatgpt-thread-download-ir-${os.getpid()}.json`;
const threadDownloadOutDir = `/tmp/test-chatgpt-thread-download-out-${os.getpid()}`;
const threadDownloadDownloadsDir = `/tmp/test-chatgpt-thread-download-downloads-${os.getpid()}`;
try { os.mkdir(threadDownloadOutDir, 0o755); } catch {}
try { os.mkdir(threadDownloadDownloadsDir, 0o755); } catch {}
std.writeFile(`${threadDownloadDownloadsDir}/thread-report.zip`, "thread artifact bytes\n");
writeJson(threadDownloadIrPath, materializeThreadIr({
  captured_at: new Date().toISOString(),
  url: "https://chatgpt.com/c/thread-download",
  title: "Thread with artifact",
  source: { kind: "cdp-live", addr: "127.0.0.1", port: 9222, target_id: "page-thread-download" },
  artifacts: [{ name: "thread-report.zip", locator: { kind: "chip", label: "thread-report.zip", href: "", match: "button" }, download: { method: "chip_click", filename_expected: "thread-report.zip" } }],
  visible_messages: [],
}));
try {
  const r = runQjs("download-chatgpt-artifacts.mjs", [
    "--outDir", threadDownloadOutDir,
    "--downloadsDir", threadDownloadDownloadsDir,
    "--irPath", threadDownloadIrPath,
    "--preferIr",
    "--reuseExisting",
    "--maxAgeSec", "3600",
    "--stats",
    "--addr", "127.0.0.1",
    "--port", "1",
  ]);
  assertDownloadNoCdp(r.stdoutText, r.rc, "download fetch can run from thread detail IR without live CDP", `${threadDownloadOutDir}/thread-report.zip`);
} finally {
  try { os.remove(threadDownloadIrPath); } catch {}
  try { os.remove(`${threadDownloadOutDir}/thread-report.zip`); } catch {}
  try { os.remove(threadDownloadOutDir); } catch {}
  try { os.remove(`${threadDownloadDownloadsDir}/thread-report.zip`); } catch {}
  try { os.remove(threadDownloadDownloadsDir); } catch {}
}

std.out.puts("\n=== Project Sources IR Warm Path Test ===\n");

const sourceIrPath = `/tmp/test-chatgpt-project-source-ir-${os.getpid()}.json`;
const sourceOutDir = `/tmp/test-chatgpt-project-source-out-${os.getpid()}`;
try { os.mkdir(sourceOutDir, 0o755); } catch {}
writeJson(sourceIrPath, materializeDownloadResolveIr({
  captured_at: new Date().toISOString(),
  url: "https://chatgpt.com/c/source-thread",
  projectUrl: "https://chatgpt.com/g/g-p-project/project",
  sourceUrl: "https://chatgpt.com/c/source-thread",
  needle: "SOURCE_ID: demo",
  targets: [{ name: "repo.bundle", locator: { kind: "chip", label: "repo.bundle", href: "", match: "button" }, download: { method: "chip_click", filename_expected: "repo.bundle" } }],
}));
try {
  const r = runQjs("project-sources-collect-files.mjs", [
    "--outDir", sourceOutDir,
    "--irPath", sourceIrPath,
    "--preferIr",
    "--maxAgeSec", "3600",
    "--resolveOnly",
    "--stats",
    "--addr", "127.0.0.1",
    "--port", "1",
  ]);
  assertDownloadNoCdp(r.stdoutText, r.rc, "project-sources resolve warm path uses IR without live CDP access", null);
} finally {
  try { os.remove(sourceIrPath); } catch {}
  try { os.remove(sourceOutDir); } catch {}
}

std.out.puts("\n=== Project Sources IR Fetch From IR Test ===\n");

const sourceFetchIrPath = `/tmp/test-chatgpt-project-source-fetch-ir-${os.getpid()}.json`;
const sourceFetchOutDir = `/tmp/test-chatgpt-project-source-fetch-out-${os.getpid()}`;
const sourceFetchDownloadsDir = `/tmp/test-chatgpt-project-source-fetch-downloads-${os.getpid()}`;
try { os.mkdir(sourceFetchOutDir, 0o755); } catch {}
try { os.mkdir(sourceFetchDownloadsDir, 0o755); } catch {}
std.writeFile(`${sourceFetchDownloadsDir}/repo.bundle`, "bundle bytes\n");
writeJson(sourceFetchIrPath, materializeDownloadResolveIr({
  captured_at: new Date().toISOString(),
  url: "https://chatgpt.com/c/source-thread",
  projectUrl: "https://chatgpt.com/g/g-p-project/project",
  sourceUrl: "https://chatgpt.com/c/source-thread",
  needle: "SOURCE_ID: demo",
  targets: [{ name: "repo.bundle", locator: { kind: "chip", label: "repo.bundle", href: "", match: "button" }, download: { method: "chip_click", filename_expected: "repo.bundle" } }],
}));
try {
  const r = runQjs("project-sources-collect-files.mjs", [
    "--outDir", sourceFetchOutDir,
    "--downloadsDir", sourceFetchDownloadsDir,
    "--irPath", sourceFetchIrPath,
    "--preferIr",
    "--maxAgeSec", "3600",
    "--stats",
    "--addr", "127.0.0.1",
    "--port", "1",
  ]);
  assertDownloadNoCdp(r.stdoutText, r.rc, "project-sources fetch can run from IR without projectUrl/needle/name or live CDP when file already exists", `${sourceFetchOutDir}/repo.bundle`);
} finally {
  try { os.remove(sourceFetchIrPath); } catch {}
  try { os.remove(`${sourceFetchOutDir}/repo.bundle`); } catch {}
  try { os.remove(sourceFetchOutDir); } catch {}
  try { os.remove(`${sourceFetchDownloadsDir}/repo.bundle`); } catch {}
  try { os.remove(sourceFetchDownloadsDir); } catch {}
}

std.out.puts("\n=== Package Run Host Orchestration Test ===\n");

const pkgRepo = tmpPath("cdp_pkg_repo");
const pkgPatchWorktree = tmpPath("cdp_pkg_patch_wt");
const pkgMboxWorktree = tmpPath("cdp_pkg_mbox_wt");
const pkgBundleWorktree = tmpPath("cdp_pkg_bundle_wt");
const pkgArtifacts = tmpPath("cdp_pkg_artifacts");
try {
  mustShell(`mkdir -p ${shellQuote(pkgRepo)} ${shellQuote(pkgArtifacts)}`);
  mustShell(`git -C ${shellQuote(pkgRepo)} init -q`);
  mustShell(`git -C ${shellQuote(pkgRepo)} config user.email ${shellQuote("cdp-test@example.invalid")}`);
  mustShell(`git -C ${shellQuote(pkgRepo)} config user.name ${shellQuote("CDP Test")}`);
  std.writeFile(`${pkgRepo}/file.txt`, "old\n");
  mustShell(`git -C ${shellQuote(pkgRepo)} add file.txt`);
  mustShell(`git -C ${shellQuote(pkgRepo)} commit -q -m base`);
  const baseRev = mustShell(`git -C ${shellQuote(pkgRepo)} rev-parse HEAD`).trim();

  std.writeFile(`${pkgRepo}/file.txt`, "new\n");
  mustShell(`git -C ${shellQuote(pkgRepo)} diff --binary > ${shellQuote(`${pkgArtifacts}/thread-a.changes.patch`)}`);
  mustShell(`git -C ${shellQuote(pkgRepo)} checkout -q -- file.txt`);
  writeJson(`${pkgArtifacts}/thread-a.result.json`, {
    worker: "thread-a",
    baseRev,
    status: "ready",
    filesChanged: ["file.txt"],
  });

  const patchRun = runQjs("chromium-cdp-package-run.mjs", [
    "--inbox", pkgArtifacts,
    "--worker", "thread-a",
    "--format", "patch",
    "--repo", pkgRepo,
    "--worktree", pkgPatchWorktree,
    "--branch", "worker/package-run-patch",
    "--expectedBaseRev", baseRev,
    "--noTest",
    "--json",
  ]);
  let patchParsed = null;
  try { patchParsed = JSON.parse(patchRun.stdoutText); } catch (_) {}
  const patchFileText = mustShell(`git -C ${shellQuote(pkgPatchWorktree)} show HEAD:file.txt`).trim();
  assert(patchRun.rc === 0 && patchParsed && patchParsed.ok === true && patchParsed.format === "patch" && patchFileText === "new", "package-run applies patch/result artifacts on host side");

  mustShell(`git -C ${shellQuote(pkgRepo)} format-patch --stdout ${shellQuote(baseRev)}..refs/heads/worker/package-run-patch > ${shellQuote(`${pkgArtifacts}/thread-a.series.mbox`)}`);
  writeJson(`${pkgArtifacts}/thread-a.series.json`, {
    worker: "thread-a",
    baseRev,
    status: "ready",
    patchFormat: "git-format-patch-mbox",
    patchCount: 1,
    filesChanged: ["file.txt"],
  });
  const mboxRun = runQjs("chromium-cdp-package-run.mjs", [
    "--format", "mbox",
    "--series", `${pkgArtifacts}/thread-a.series.json`,
    "--mbox", `${pkgArtifacts}/thread-a.series.mbox`,
    "--repo", pkgRepo,
    "--worktree", pkgMboxWorktree,
    "--branch", "worker/package-run-mbox",
    "--expectedBaseRev", baseRev,
    "--noTest",
    "--json",
  ]);
  let mboxParsed = null;
  try { mboxParsed = JSON.parse(mboxRun.stdoutText); } catch (_) {}
  const mboxFileText = mustShell(`git -C ${shellQuote(pkgMboxWorktree)} show HEAD:file.txt`).trim();
  assert(mboxRun.rc === 0 && mboxParsed && mboxParsed.ok === true && mboxParsed.format === "mbox" && mboxFileText === "new", "package-run applies git-format-patch mbox artifacts on host side");

  mustShell(`git -C ${shellQuote(pkgRepo)} bundle create ${shellQuote(`${pkgArtifacts}/thread-a.repo.bundle`)} refs/heads/worker/package-run-patch`);
  writeJson(`${pkgArtifacts}/thread-a.bundle.result.json`, {
    worker: "thread-a",
    baseRev,
    status: "ready",
    bundleRef: "refs/heads/worker/package-run-patch",
    filesChanged: ["file.txt"],
  });
  const bundleRun = runQjs("chromium-cdp-package-run.mjs", [
    "--format", "bundle",
    "--result", `${pkgArtifacts}/thread-a.bundle.result.json`,
    "--bundle", `${pkgArtifacts}/thread-a.repo.bundle`,
    "--repo", pkgRepo,
    "--worktree", pkgBundleWorktree,
    "--branch", "worker/package-run-bundle",
    "--expectedBaseRev", baseRev,
    "--noTest",
    "--json",
  ]);
  let bundleParsed = null;
  try { bundleParsed = JSON.parse(bundleRun.stdoutText); } catch (_) {}
  const bundleFileText = mustShell(`git -C ${shellQuote(pkgBundleWorktree)} show HEAD:file.txt`).trim();
  assert(bundleRun.rc === 0 && bundleParsed && bundleParsed.ok === true && bundleParsed.format === "bundle" && bundleFileText === "new", "package-run verifies and applies git bundle artifacts on host side");
} catch (e) {
  failed++;
  std.out.puts(`  FAIL: package-run orchestration fixture failed: ${e}\n`);
} finally {
  try { mustShell(`rm -rf ${shellQuote(pkgPatchWorktree)} ${shellQuote(pkgMboxWorktree)} ${shellQuote(pkgBundleWorktree)} ${shellQuote(pkgRepo)} ${shellQuote(pkgArtifacts)}`); } catch {}
}

std.out.puts("\n=== CdpError JSON Output Test ===\n");

const testErr = new CdpError("TEST_CODE", "Test message", null, "Test hint");
try {
  const parsed = JSON.parse(JSON.stringify(testErr.toJSON()));
  assert(parsed.ok === false && parsed.code === "TEST_CODE" && parsed.docRef.includes("TEST_CODE"), "CdpError JSON output is valid");
} catch (e) {
  failed++;
  std.out.puts(`  FAIL: JSON parse error: ${e}\n`);
}

std.out.puts("\n=== Summary ===\n");
std.out.puts(`Passed: ${passed}\n`);
std.out.puts(`Failed: ${failed}\n`);

if (failed > 0) {
  std.exit(1);
}
