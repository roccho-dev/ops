import * as std from "./qjs-compat/std.mjs";

import { getDefaultAddr, getDefaultPort, parseArgs, run } from "./lib.mjs";
import {
  fileSha256,
  fileSize,
  gitRevParse,
  nowIso,
  pathExists,
  readJson,
  runCapture,
  shellQuote,
  writeJson,
} from "./core/host-git.mjs";
import { mkdirp } from "./core/io.mjs";

const KIND = "cdp.packageRun.v1";
const REVIEW_RESULT_SCHEMA = "cdp.packageReview.v1";
const REVIEW_QUALITY_CHECKS = [
  "requirementsDefined",
  "specTableComplete",
  "testsMeasureSpecs",
  "canonTddPriorityOrder",
  "canonTddCycleEvidence",
  "ciGateDefined",
  "implDidNotWeakenTests",
  "workerSourceReadbackValidated",
  "readOnlySourceValidated",
  "nativePathChecksRunOrCarried",
  "updatedTargetHonored",
];

function usage() {
  std.err.puts([
    "usage: qjs --std -m chromium-cdp-package-run-state.mjs <command> [options]",
    "",
    "commands:",
    "  init --runDir <dir> --package <name> --repo <repo> [--projectUrl <url>] [--sourceZip <zip>] [--baseRev <rev>]",
    "  status --runDir <dir> [--json]",
    "  record-timeout --runDir <dir> [--role impl|review] [--attempt <n>] [--reason <text>] [--json]",
    "  collect-impl --runDir <dir> (--threadUrl <url>|--fromDir <dir>) [--attempt <n>] [--json]",
    "  validate-host --runDir <dir> [--attempt <n>] [--testCmd <cmd>|--noTest] [--checkCommand <cmd>]... [--json]",
    "  retry-impl --runDir <dir> [--threadUrl <url>] [--dryRun] [--json]",
    "  review-prompt --runDir <dir> [--attempt <n>] [--out <path>] [--json]",
    "  collect-review --runDir <dir> (--threadUrl <url>|--fromDir <dir>) [--attempt <n>] [--json]",
    "  finalize --runDir <dir> [--json]",
    "",
  ].join("\n") + "\n");
  std.err.flush();
}

function scriptPath(name) {
  const root = String(std.getenv("HQ_CDP_SCRIPT_SRC") || "");
  if (root) return `${root}/${name}`;
  if (pathExists(`./${name}`)) return `./${name}`;
  return `parts/cdp/${name}`;
}

function qjsBin() {
  return String(std.getenv("HQ_CDP_QJS") || "qjs");
}

function safeName(value) {
  return String(value || "package").replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "package";
}

function runFile(runDir) {
  return `${runDir}/run.json`;
}

function loadRun(runDir) {
  const path = runFile(runDir);
  if (!pathExists(path)) throw new Error(`run.json not found: ${path}`);
  const doc = readJson(path);
  if (!doc || doc.kind !== KIND) throw new Error(`invalid run file kind: ${path}`);
  return doc;
}

function saveRun(run) {
  run.updatedAt = nowIso();
  writeJson(run.runFile, run);
}

function addEvent(run, type, detail) {
  if (!Array.isArray(run.history)) run.history = [];
  run.history.push({ at: nowIso(), type, detail: detail || null });
}

function ensureDir(path) {
  mkdirp(path);
  return path;
}

function attemptDir(run, role, attempt) {
  return ensureDir(`${run.runDir}/${role}-a${attempt}`);
}

function artifactNames(run, role, attempt) {
  const prefix = safeName(run.package);
  if (role === "review") {
    return {
      result: `${prefix}-review-a${attempt}.result.json`,
      text: `${prefix}-review-a${attempt}.txt`,
    };
  }
  return {
    result: `${prefix}-impl-a${attempt}.result.json`,
    patch: `${prefix}-impl-a${attempt}.changes.patch`,
  };
}

function reviewTargetRevision(run, attempt) {
  return `${safeName(run.package)}-a${attempt}`;
}

function reviewQualityContract() {
  return {
    schema: REVIEW_RESULT_SCHEMA,
    role: "review checks canon-tdd, CI/spec quality, and whether required host evidence is present",
    requiredChecks: REVIEW_QUALITY_CHECKS.slice(),
    resultJsonShape: {
      schema: REVIEW_RESULT_SCHEMA,
      targetRevision: "<package-aN from review prompt>",
      reviewedArtifacts: "array of exact implementation artifacts reviewed",
      previousTargetIgnored: true,
      formatOk: true,
      verdict: "pass|fail",
      baseRev: "<same as run.baseRev>",
      qualityGate: "object with every required check set to pass/fail/not-run",
      blockingIssues: "array; empty only when verdict=pass",
      retryInstruction: "object; required when verdict=fail",
    },
    passRule: "verdict=pass requires every qualityGate value to be pass, no blockingIssues, and matching targetRevision",
  };
}

function copyFile(src, dst) {
  runCapture(["cp", src, dst]);
}

function qjsJson(script, args) {
  const r = runCapture([qjsBin(), "--std", "-m", scriptPath(script), ...args]);
  try {
    return JSON.parse(r.out);
  } catch (e) {
    throw new Error(`failed to parse JSON from ${script}: ${String(e)}\n${r.out}`);
  }
}

function fetchArtifact(args, name, outDir) {
  if (args.fromDir) {
    const src = `${args.fromDir}/${name}`;
    if (!pathExists(src)) throw new Error(`artifact not found in fromDir: ${src}`);
    const dst = `${outDir}/${name}`;
    copyFile(src, dst);
    return { ok: true, mode: "copy", name, outPath: dst, size: fileSize(dst), sha256: fileSha256(dst) };
  }
  const cmd = [
    "--name", name,
    "--outDir", outDir,
    "--downloadsDir", args.downloadsDir,
    "--archiveDir", args.archiveDir,
    "--addr", String(args.addr),
    "--port", String(args.port),
    "--json",
  ];
  if (args.threadUrl) cmd.push("--url", args.threadUrl);
  else throw new Error("collect requires --threadUrl or --fromDir");
  return qjsJson("chromium-cdp-fetch-artifact-strict.mjs", cmd);
}

function parseCommon(argv, defaults, flags, finalize) {
  return parseArgs(argv, {
    defaults,
    flags,
    onError: "null",
    reportError: true,
    finalize,
  });
}

function printResult(value, json) {
  if (json) std.out.puts(JSON.stringify(value, null, 2) + "\n");
  else {
    std.out.puts(`state=${value.state || value.run?.state || "unknown"}\n`);
    if (value.next) std.out.puts(`next=${value.next}\n`);
    if (value.runFile || value.run?.runFile) std.out.puts(`runFile=${value.runFile || value.run.runFile}\n`);
  }
}

function nextFor(run) {
  switch (run.state) {
    case "initialized": return "collect-impl or retry-impl after impl thread exists";
    case "impl-retry-started": return "collect-impl";
    case "impl-artifacts-timeout": return "retry-impl with timeout evidence";
    case "impl-artifacts-ready": return "validate-host";
    case "host-validation-failed": return "retry-impl";
    case "host-validation-pass": return "review-prompt then collect-review";
    case "review-artifacts-timeout": return "review-prompt then collect-review, or ask review for bounded artifacts";
    case "review-format-failed": return "rerun review-prompt or resend corrected review contract";
    case "review-quality-failed": return "retry-impl or update spec/tests";
    case "review-artifacts-ready": return "finalize";
    case "finalized": return "done";
    default: return "inspect";
  }
}

function validateReviewQualityResult(review, run, attempt) {
  const formatErrors = [];
  const qualityErrors = [];
  if (!review || typeof review !== "object") formatErrors.push("review result must be a JSON object");
  const expectedTargetRevision = reviewTargetRevision(run, attempt);
  const gate = review && review.qualityGate && typeof review.qualityGate === "object" ? review.qualityGate : null;
  if (review && String(review.schema || "") !== REVIEW_RESULT_SCHEMA) {
    formatErrors.push(`schema must be ${REVIEW_RESULT_SCHEMA}`);
  }
  if (review && String(review.targetRevision || "") !== expectedTargetRevision) {
    formatErrors.push(`targetRevision mismatch: expected ${expectedTargetRevision}, got ${review && review.targetRevision}`);
  }
  if (review && review.previousTargetIgnored !== true) {
    formatErrors.push("previousTargetIgnored must be true");
  }
  if (review && review.formatOk !== true) {
    formatErrors.push("formatOk must be true");
  }
  if (review && review.baseRev && String(review.baseRev) !== String(run.baseRev)) {
    formatErrors.push(`baseRev mismatch: expected ${run.baseRev}, got ${review.baseRev}`);
  }
  const reviewed = Array.isArray(review && review.reviewedArtifacts) ? review.reviewedArtifacts.map(String) : [];
  const expectedImpl = run.expected && run.expected.impl ? run.expected.impl : artifactNames(run, "impl", attempt);
  for (const artifact of [expectedImpl.result, expectedImpl.patch].filter(Boolean)) {
    if (reviewed.length > 0 && reviewed.indexOf(String(artifact)) < 0) {
      formatErrors.push(`reviewedArtifacts missing ${artifact}`);
    }
  }
  if (!gate) formatErrors.push("qualityGate object is required");
  for (const key of REVIEW_QUALITY_CHECKS) {
    const value = gate ? String(gate[key] || "") : "";
    if (!value) formatErrors.push(`qualityGate.${key} is required`);
    else if (!["pass", "fail", "not-run"].includes(value)) formatErrors.push(`qualityGate.${key} must be pass, fail, or not-run`);
    else if (value !== "pass") qualityErrors.push(`qualityGate.${key} is ${value}`);
  }
  const issues = Array.isArray(review && review.blockingIssues) ? review.blockingIssues : [];
  if (review && !Array.isArray(review.blockingIssues)) formatErrors.push("blockingIssues array is required");
  const verdict = String(review && review.verdict || "");
  if (!["pass", "fail"].includes(verdict)) formatErrors.push("verdict must be pass or fail");
  if (verdict === "pass" && issues.length > 0) formatErrors.push("blockingIssues must be empty when verdict=pass");
  if (verdict === "fail" && issues.length === 0) formatErrors.push("blockingIssues must be non-empty when verdict=fail");
  if (verdict === "pass" && qualityErrors.length > 0) formatErrors.push("verdict=pass requires every qualityGate value to be pass");
  if (verdict === "fail") {
    const retry = review && review.retryInstruction && typeof review.retryInstruction === "object" ? review.retryInstruction : null;
    if (!retry) formatErrors.push("retryInstruction object is required when verdict=fail");
    else if (!String(retry.sendTo || "")) formatErrors.push("retryInstruction.sendTo is required when verdict=fail");
  }
  const formatOk = formatErrors.length === 0;
  const reviewPassed = formatOk && verdict === "pass" && qualityErrors.length === 0 && issues.length === 0;
  const state = !formatOk ? "review-format-failed" : (reviewPassed ? "review-artifacts-ready" : "review-quality-failed");
  return {
    ok: reviewPassed,
    formatOk,
    reviewPassed,
    verdict,
    state,
    errors: formatErrors.concat(qualityErrors),
    formatErrors,
    qualityErrors,
    blockingIssues: issues,
    expectedTargetRevision,
    requiredChecks: REVIEW_QUALITY_CHECKS.slice(),
  };
}

function commandInit(argv) {
  const args = parseCommon(argv, {
    runDir: null,
    package: null,
    repo: null,
    projectUrl: null,
    sourceZip: null,
    baseRev: null,
    implThread: null,
    reviewThread: null,
    json: false,
  }, {
    runDir: { required: true },
    package: { required: true },
    repo: { required: true },
    projectUrl: {},
    sourceZip: {},
    baseRev: {},
    implThread: {},
    reviewThread: {},
    json: { type: "boolean" },
  });
  if (!args) return null;
  ensureDir(args.runDir);
  const baseRev = args.baseRev || gitRevParse(args.repo, "HEAD");
  const run = {
    kind: KIND,
    package: args.package,
    safePackage: safeName(args.package),
    repo: args.repo,
    projectUrl: args.projectUrl || null,
    sourceZip: args.sourceZip || null,
    baseRev,
    state: "initialized",
    attempt: 1,
    artifactWait: {
      intervalMs: 600000,
      timeoutMs: 1800000,
      timeoutRule: "If expected artifacts are still absent after timeout, record timeout and retry with bounded artifact names.",
    },
    runDir: args.runDir,
    runFile: runFile(args.runDir),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    threads: {
      impl: args.implThread || null,
      review: args.reviewThread || null,
    },
    artifacts: {},
    validations: {},
    qualityContract: reviewQualityContract(),
    history: [],
  };
  run.expected = {
    impl: artifactNames(run, "impl", run.attempt),
    review: artifactNames(run, "review", run.attempt),
  };
  addEvent(run, "init", { baseRev });
  saveRun(run);
  printResult({ ok: true, state: run.state, next: nextFor(run), runFile: run.runFile, run }, args.json);
  return 0;
}

function commandStatus(argv) {
  const args = parseCommon(argv, {
    runDir: null,
    json: false,
  }, {
    runDir: { required: true },
    json: { type: "boolean" },
  });
  if (!args) return null;
  const run = loadRun(args.runDir);
  printResult({ ok: true, state: run.state, next: nextFor(run), runFile: run.runFile, run }, args.json);
  return 0;
}

function commandRecordTimeout(argv) {
  const args = parseCommon(argv, {
    runDir: null,
    role: "impl",
    attempt: null,
    reason: "expected artifacts were not produced before timeout",
    json: false,
  }, {
    runDir: { required: true },
    role: {},
    attempt: { type: "number" },
    reason: {},
    json: { type: "boolean" },
  });
  if (!args) return null;
  const run = loadRun(args.runDir);
  const role = String(args.role || "impl");
  if (!["impl", "review"].includes(role)) throw new Error("--role must be impl or review");
  const attempt = args.attempt || run.attempt || 1;
  const names = artifactNames(run, role, attempt);
  const timeout = {
    role,
    attempt,
    names,
    reason: String(args.reason || ""),
    intervalMs: run.artifactWait && run.artifactWait.intervalMs,
    timeoutMs: run.artifactWait && run.artifactWait.timeoutMs,
    recordedAt: nowIso(),
  };
  if (!run.validations) run.validations = {};
  if (!run.validations.timeouts) run.validations.timeouts = [];
  run.validations.timeouts.push(timeout);
  run.state = role === "impl" ? "impl-artifacts-timeout" : "review-artifacts-timeout";
  addEvent(run, "record-timeout", timeout);
  saveRun(run);
  printResult({ ok: false, state: run.state, next: nextFor(run), runFile: run.runFile, timeout, run }, args.json);
  return 1;
}

function commandCollectImpl(argv) {
  const args = parseCommon(argv, {
    runDir: null,
    attempt: null,
    threadUrl: null,
    fromDir: null,
    resultName: null,
    patchName: null,
    downloadsDir: `${std.getenv("HOME") || "."}/Downloads`,
    archiveDir: null,
    addr: getDefaultAddr(),
    port: getDefaultPort(),
    json: false,
  }, {
    runDir: { required: true },
    attempt: { type: "number" },
    threadUrl: {},
    fromDir: {},
    resultName: {},
    patchName: {},
    downloadsDir: {},
    archiveDir: {},
    addr: {},
    port: { type: "number" },
    json: { type: "boolean" },
  }, (out) => (out.threadUrl || out.fromDir) ? out : null);
  if (!args) return null;
  const run = loadRun(args.runDir);
  const attempt = args.attempt || run.attempt || 1;
  const names = artifactNames(run, "impl", attempt);
  names.result = args.resultName || names.result;
  names.patch = args.patchName || names.patch;
  const dir = attemptDir(run, "impl", attempt);
  args.archiveDir = args.archiveDir || `${run.runDir}/archive-impl-a${attempt}`;
  ensureDir(args.archiveDir);
  const result = fetchArtifact(args, names.result, dir);
  const patch = fetchArtifact(args, names.patch, dir);
  run.attempt = attempt;
  if (args.threadUrl) run.threads.impl = args.threadUrl;
  run.artifacts.impl = { attempt, result, patch, names, dir };
  run.expected.impl = names;
  run.state = "impl-artifacts-ready";
  addEvent(run, "collect-impl", { attempt, names });
  saveRun(run);
  printResult({ ok: true, state: run.state, next: nextFor(run), runFile: run.runFile, result, patch, run }, args.json);
  return 0;
}

function commandValidateHost(argv) {
  const args = parseCommon(argv, {
    runDir: null,
    attempt: null,
    worktree: null,
    branch: null,
    testCmd: "./scripts/test.sh",
    checkCommand: [],
    message: null,
    json: false,
  }, {
    runDir: { required: true },
    attempt: { type: "number" },
    worktree: {},
    branch: {},
    testCmd: {},
    noTest: { type: "boolean", set: (out) => { out.testCmd = ""; } },
    checkCommand: { multiple: true },
    message: {},
    json: { type: "boolean" },
  });
  if (!args) return null;
  const run = loadRun(args.runDir);
  const attempt = args.attempt || run.attempt || 1;
  const impl = run.artifacts.impl;
  if (!impl || Number(impl.attempt) !== Number(attempt)) throw new Error(`impl artifacts for attempt ${attempt} are not collected`);
  const worktree = args.worktree || `${run.repo}/.worktrees/${run.safePackage}-impl-a${attempt}`;
  const branch = args.branch || `worker/${run.safePackage}-impl-a${attempt}`;
  const logDir = ensureDir(`${run.runDir}/logs`);
  const logPath = `${logDir}/host-validation-a${attempt}.log`;
  const workerApplyArgs = [
    qjsBin(),
    "--std",
    "-m",
    scriptPath("chromium-cdp-worker-apply.mjs"),
    "--repo", run.repo,
    "--worktree", worktree,
    "--branch", branch,
    "--result", impl.result.outPath,
    "--patch", impl.patch.outPath,
    "--baseRef", run.baseRev,
    "--expectedBaseRev", run.baseRev,
    "--json",
  ];
  if (args.testCmd) workerApplyArgs.push("--testCmd", args.testCmd);
  else workerApplyArgs.push("--noTest");
  if (args.message) workerApplyArgs.push("--message", args.message);
  const apply = runCapture(workerApplyArgs, { check: false });
  let logText = `$ ${workerApplyArgs.map(shellQuote).join(" ")}\nrc=${apply.rc}\n${apply.out}\n`;
  const checks = [];
  let ok = apply.rc === 0;
  if (ok) {
    for (const cmd of args.checkCommand) {
      const r = runCapture(String(cmd), { cwd: worktree, check: false });
      checks.push({ command: String(cmd), ok: r.rc === 0, rc: r.rc, output: r.out.trim() });
      logText += `\n$ ${cmd}\nrc=${r.rc}\n${r.out}\n`;
      if (r.rc !== 0) ok = false;
    }
  }
  std.writeFile(logPath, logText);
  let applyJson = null;
  if (apply.rc === 0) {
    try { applyJson = JSON.parse(apply.out); } catch {}
  }
  run.validations.host = {
    attempt,
    ok,
    worktree,
    branch,
    logPath,
    apply: applyJson,
    applyRc: apply.rc,
    checks,
  };
  run.state = ok ? "host-validation-pass" : "host-validation-failed";
  addEvent(run, "validate-host", { attempt, ok, logPath });
  saveRun(run);
  const out = { ok, state: run.state, next: nextFor(run), runFile: run.runFile, logPath, apply: applyJson, checks, run };
  printResult(out, args.json);
  return ok ? 0 : 1;
}

function commandRetryImpl(argv) {
  const args = parseCommon(argv, {
    runDir: null,
    threadUrl: null,
    dryRun: false,
    extraText: null,
    addr: getDefaultAddr(),
    port: getDefaultPort(),
    json: false,
  }, {
    runDir: { required: true },
    threadUrl: {},
    dryRun: { type: "boolean" },
    extraText: {},
    addr: {},
    port: { type: "number" },
    json: { type: "boolean" },
  });
  if (!args) return null;
  const run = loadRun(args.runDir);
  const prevAttempt = run.attempt || 1;
  const attempt = prevAttempt + 1;
  const names = artifactNames(run, "impl", attempt);
  const dir = attemptDir(run, "impl", attempt);
  const hostFailure = run.validations && run.validations.host && !run.validations.host.ok ? run.validations.host : null;
  const reviewFailure = run.validations && run.validations.review && !run.validations.review.ok ? run.validations.review : null;
  const failureLog = hostFailure && hostFailure.logPath && pathExists(hostFailure.logPath)
    ? String(std.loadFile(hostFailure.logPath) || "")
    : "";
  const reviewFailureText = reviewFailure
    ? JSON.stringify({
      state: reviewFailure.state || run.state,
      verdict: reviewFailure.verdict || null,
      targetRevision: reviewFailure.expectedTargetRevision || null,
      formatErrors: reviewFailure.formatErrors || [],
      qualityErrors: reviewFailure.qualityErrors || [],
      blockingIssues: reviewFailure.blockingIssues || [],
    }, null, 2)
    : "";
  const failureTitle = reviewFailure
    ? `Review quality failed for ${run.package} attempt ${prevAttempt}.`
    : (run.state === "impl-artifacts-timeout"
        ? `Implementation artifacts timed out for ${run.package} attempt ${prevAttempt}.`
        : `Host validation failed for ${run.package} attempt ${prevAttempt}.`);
  const timeoutFailure = run.validations && Array.isArray(run.validations.timeouts)
    ? run.validations.timeouts.filter((row) => row && row.role === "impl" && Number(row.attempt) === Number(prevAttempt)).slice(-1)[0]
    : null;
  const promptPath = `${dir}/retry-prompt.txt`;
  const prompt = [
    failureTitle,
    "",
    "Please revise the implementation and return new uniquely named artifacts.",
    "",
    `Required artifact names:`,
    `- ${names.result}`,
    `- ${names.patch}`,
    "",
    `Base rev remains: ${run.baseRev}`,
    "",
    "Do not reuse old artifact names. Mark unavailable runtime checks as not-run.",
    timeoutFailure ? "Previous attempt timed out without required artifacts. Keep the next attempt bounded: if you cannot emit artifacts, return a blocked result JSON and notes instead of continuing to stream." : "",
    args.extraText ? `\nExtra instruction:\n${args.extraText}` : "",
    failureLog ? `\nHost validation log:\n\`\`\`text\n${failureLog.slice(0, 12000)}\n\`\`\`\n` : "",
    reviewFailureText ? `\nReview failure:\n\`\`\`json\n${reviewFailureText.slice(0, 12000)}\n\`\`\`\n` : "",
  ].join("\n");
  std.writeFile(promptPath, prompt);
  let send = null;
  const threadUrl = args.threadUrl || (run.threads && run.threads.impl) || null;
  if (!args.dryRun) {
    if (!threadUrl) throw new Error("retry-impl requires --threadUrl or run.threads.impl");
    const r = runCapture([
      qjsBin(),
      "--std",
      "-m",
      scriptPath("send-chatgpt.mjs"),
      "--url", threadUrl,
      "--text-file", promptPath,
      "--addr", String(args.addr),
      "--port", String(args.port),
      "--requireDomPro",
    ], { check: false });
    send = { ok: r.rc === 0, rc: r.rc, output: r.out.trim() };
    if (r.rc !== 0) throw new Error(`send retry prompt failed rc=${r.rc}:\n${r.out}`);
  }
  run.attempt = attempt;
  run.expected.impl = names;
  if (threadUrl) run.threads.impl = threadUrl;
  run.state = "impl-retry-started";
  addEvent(run, "retry-impl", { attempt, promptPath, dryRun: args.dryRun });
  saveRun(run);
  printResult({ ok: true, state: run.state, next: nextFor(run), runFile: run.runFile, attempt, names, promptPath, send, run }, args.json);
  return 0;
}

function commandReviewPrompt(argv) {
  const args = parseCommon(argv, {
    runDir: null,
    attempt: null,
    out: null,
    json: false,
  }, {
    runDir: { required: true },
    attempt: { type: "number" },
    out: {},
    json: { type: "boolean" },
  });
  if (!args) return null;
  const run = loadRun(args.runDir);
  const attempt = args.attempt || run.attempt || 1;
  const impl = run.artifacts && run.artifacts.impl ? run.artifacts.impl : null;
  const host = run.validations && run.validations.host ? run.validations.host : null;
  if (!impl || Number(impl.attempt) !== Number(attempt)) throw new Error(`impl artifacts for attempt ${attempt} are not collected`);
  if (!host || !host.ok) throw new Error("review-prompt requires host-validation-pass");
  const names = artifactNames(run, "review", attempt);
  const targetRevision = reviewTargetRevision(run, attempt);
  const dir = attemptDir(run, "review", attempt);
  const outPath = args.out || `${dir}/review-prompt.txt`;
  const prompt = [
    `Review role for ${run.package} attempt ${attempt}.`,
    "",
    "Your task is not implementation. Do not fix the package yourself.",
    "Check canon-tdd quality, CI/spec quality, and whether required validation evidence is present.",
    "",
    "Updated review target:",
    `- targetRevision: ${targetRevision}`,
    `- impl result artifact: ${impl.names.result}`,
    `- impl patch artifact: ${impl.names.patch}`,
    `- host validation log: ${host.logPath}`,
    "",
    "Ignore older attempts and older review targets except as history.",
    `If you cannot confirm targetRevision=${targetRevision}, fail with blocker REVIEW_TARGET_STALE.`,
    "",
    "Quality means:",
    "- The package purpose has requirements/specs.",
    "- Those specs are measured by tests.",
    "- The spec/test coverage is managed without omissions in a DSV/CSV/JSON table.",
    "- Canon-TDD repeats test -> impl by highest-priority spec rows.",
    "- CI/package checks prove the stated output guarantees.",
    "- Impl did not weaken, delete, or bypass tests without a spec-table reason.",
    "- Worker proved the exact Project Source/runtime input it used by filename, hash, and readback evidence.",
    "- Read-only source and native path checks are either proven by host evidence or fail as missing evidence.",
    "",
    `Base rev: ${run.baseRev}`,
    "",
    "Return exactly these artifacts with unique names:",
    `- ${names.result}`,
    `- ${names.text}`,
    "",
    `${names.result} must be JSON with this shape:`,
    "```json",
    JSON.stringify({
      schema: REVIEW_RESULT_SCHEMA,
      targetRevision,
      reviewedArtifacts: [impl.names.result, impl.names.patch],
      previousTargetIgnored: true,
      formatOk: true,
      reviewer: "review-thread-name",
      baseRev: run.baseRev,
      verdict: "pass",
      qualityGate: Object.fromEntries(REVIEW_QUALITY_CHECKS.map((key) => [key, "pass"])),
      blockingIssues: [],
      retryInstruction: null,
      notes: ["short evidence only"],
    }, null, 2),
    "```",
    "",
    "Pass/fail rules:",
    "- verdict=pass is allowed only if every required qualityGate value is exactly pass.",
    "- If any required gate is fail or not-run, verdict must be fail.",
    "- Project Sources collect/find output alone is not enough for workerSourceReadbackValidated; require worker readback or host evidence.",
    "- If verdict=fail, blockingIssues must be non-empty and retryInstruction.sendTo must name impl, host, or review.",
    "- Missing host-owned validation evidence is still a review blocker for final acceptance; set retryInstruction.sendTo=host.",
  ].join("\n");
  std.writeFile(outPath, prompt);
  run.expected.review = names;
  run.reviewPrompt = { attempt, path: outPath, names, targetRevision, contract: reviewQualityContract() };
  addEvent(run, "review-prompt", { attempt, path: outPath, names, targetRevision });
  saveRun(run);
  printResult({ ok: true, state: run.state, next: nextFor(run), runFile: run.runFile, attempt, promptPath: outPath, names, run }, args.json);
  return 0;
}

function commandCollectReview(argv) {
  const args = parseCommon(argv, {
    runDir: null,
    attempt: null,
    threadUrl: null,
    fromDir: null,
    resultName: null,
    textName: null,
    downloadsDir: `${std.getenv("HOME") || "."}/Downloads`,
    archiveDir: null,
    addr: getDefaultAddr(),
    port: getDefaultPort(),
    json: false,
  }, {
    runDir: { required: true },
    attempt: { type: "number" },
    threadUrl: {},
    fromDir: {},
    resultName: {},
    textName: {},
    downloadsDir: {},
    archiveDir: {},
    addr: {},
    port: { type: "number" },
    json: { type: "boolean" },
  }, (out) => (out.threadUrl || out.fromDir) ? out : null);
  if (!args) return null;
  const run = loadRun(args.runDir);
  const attempt = args.attempt || run.attempt || 1;
  const names = artifactNames(run, "review", attempt);
  names.result = args.resultName || names.result;
  names.text = args.textName || names.text;
  const dir = attemptDir(run, "review", attempt);
  args.archiveDir = args.archiveDir || `${run.runDir}/archive-review-a${attempt}`;
  ensureDir(args.archiveDir);
  const result = fetchArtifact(args, names.result, dir);
  const text = fetchArtifact(args, names.text, dir);
  const reviewJson = readJson(result.outPath);
  const reviewValidation = validateReviewQualityResult(reviewJson, run, attempt);
  if (args.threadUrl) run.threads.review = args.threadUrl;
  run.artifacts.review = { attempt, result, text, names, dir };
  run.expected.review = names;
  run.validations.review = { attempt, ...reviewValidation };
  run.state = reviewValidation.state;
  addEvent(run, "collect-review", { attempt, names, ok: reviewValidation.ok });
  saveRun(run);
  printResult({ ok: reviewValidation.ok, state: run.state, next: nextFor(run), runFile: run.runFile, result, text, reviewValidation, run }, args.json);
  return reviewValidation.ok ? 0 : 1;
}

function commandFinalize(argv) {
  const args = parseCommon(argv, {
    runDir: null,
    json: false,
  }, {
    runDir: { required: true },
    json: { type: "boolean" },
  });
  if (!args) return null;
  const run = loadRun(args.runDir);
  const hostOk = !!(run.validations && run.validations.host && run.validations.host.ok);
  const reviewOk = !!(run.validations && run.validations.review && run.validations.review.ok);
  if (!hostOk) throw new Error("cannot finalize without host-validation-pass");
  if (!reviewOk) throw new Error("cannot finalize without review quality pass");
  run.state = "finalized";
  run.final = { ok: true, hostValidation: "pass", review: "quality-pass", finalizedAt: nowIso() };
  addEvent(run, "finalize", run.final);
  saveRun(run);
  printResult({ ok: true, state: run.state, next: nextFor(run), runFile: run.runFile, run }, args.json);
  return 0;
}

function main(argv) {
  const all = Array.prototype.slice.call(argv || []);
  const first = String(all[0] || "");
  const raw = (first.endsWith(".mjs") || first.indexOf("/") >= 0) ? all.slice(1) : all;
  const cmd = raw[0] || "";
  const rest = ["chromium-cdp-package-run-state.mjs", ...raw.slice(1)];
  const commandRc = (rc) => (rc === null || rc === undefined ? 2 : rc);
  if (!cmd || cmd === "-h" || cmd === "--help") {
    usage();
    return 2;
  }
  if (cmd === "init") return commandRc(commandInit(rest));
  if (cmd === "status") return commandRc(commandStatus(rest));
  if (cmd === "record-timeout") return commandRc(commandRecordTimeout(rest));
  if (cmd === "collect-impl") return commandRc(commandCollectImpl(rest));
  if (cmd === "validate-host") return commandRc(commandValidateHost(rest));
  if (cmd === "retry-impl") return commandRc(commandRetryImpl(rest));
  if (cmd === "review-prompt") return commandRc(commandReviewPrompt(rest));
  if (cmd === "collect-review") return commandRc(commandCollectReview(rest));
  if (cmd === "finalize") return commandRc(commandFinalize(rest));
  throw new Error(`unknown command: ${cmd}`);
}

run(scriptArgs, { usage, main });
