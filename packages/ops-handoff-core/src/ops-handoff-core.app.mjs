#!/usr/bin/env node
// Generate and validate ops handoff directories.
//
// The tool is intentionally local-only. It does not call CDP, upload Project
// Source files, fetch artifacts, merge, push, or approve work.
//
// Node ESM port of ops-handoff-core.py (stdlib only, behavior-identical).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import process from "node:process";

process.on("unhandledRejection", (e) => {
  console.error(e);
  process.exit(1);
});

const THREAD_FUNCTIONS = ["impl-work", "impl-review", "merge-work", "merge-review"];

const WORK_ROLE_BY_FUNCTION = {
  "impl-work": "role.implWorker",
  "impl-review": "role.implReviewer",
  "merge-work": "role.mergeExecutor",
  "merge-review": "role.mergeReviewer",
};

const FORBIDDEN_BY_FUNCTION = {
  "impl-work": [
    "do not self-review implementation work",
    "do not issue impl-review-pass or merge-review-pass",
    "do not perform merge-work, merge-review, canonical merge, push, or cleanup",
    "do not treat transport/readback as approval",
  ],
  "impl-review": [
    "do not edit or create the implementation candidate being reviewed",
    "do not perform merge-work, merge-review, canonical merge, push, or cleanup",
    "do not approve generic review-pass prose; require explicit impl-review-pass or reject/blocker",
    "do not treat transport/readback as approval",
  ],
  "merge-work": [
    "do not issue merge-review-pass",
    "do not perform canonical merge, push, or cleanup",
    "do not change the reviewed implementation outside the merge target scope",
    "do not treat transport/readback as approval",
  ],
  "merge-review": [
    "do not create or edit the merge candidate being reviewed",
    "do not localize, push, cleanup, or close the workflow",
    "do not accept generic review-pass prose; require explicit merge-review-pass or reject/blocker",
    "do not treat transport/readback as approval",
  ],
};

const EXPECTED_BY_FUNCTION = {
  "impl-work": [
    "implementation artifact or patch",
    "diff summary",
    "gate log",
    "RUN_REPORT.md",
    "residual risks",
    "completion claim candidate",
  ],
  "impl-review": [
    "first non-empty line verdict: impl-review-pass, impl-review-reject, or blocker",
    "review report",
    "evidence table",
    "residual risks",
  ],
  "merge-work": [
    "merge candidate or merge handoff bundle",
    "base/candidate/merge target refs",
    "gate log",
    "RUN_REPORT.md",
    "residual risks",
  ],
  "merge-review": [
    "first non-empty line verdict: merge-review-pass, merge-review-reject, or blocker",
    "merge review report",
    "rollback or stop conditions",
    "evidence table",
  ],
};

class HandoffError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.msg = message;
  }
}

// --- Python json.dumps serializers (ensure_ascii=True) ---
function jsonString(s) {
  let out = '"';
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\f") out += "\\f";
    else if (code < 0x20) out += "\\u" + code.toString(16).padStart(4, "0");
    else if (code < 0x7f) out += ch;
    else if (code > 0xffff) {
      const c = code - 0x10000;
      const hi = 0xd800 + (c >> 10);
      const lo = 0xdc00 + (c & 0x3ff);
      out += "\\u" + hi.toString(16).padStart(4, "0") + "\\u" + lo.toString(16).padStart(4, "0");
    } else {
      out += "\\u" + code.toString(16).padStart(4, "0");
    }
  }
  return out + '"';
}

function ser(value, sortKeys, indent, depth) {
  if (value === null || value === undefined) return "null";
  const t = typeof value;
  if (t === "string") return jsonString(value);
  if (t === "boolean") return value ? "true" : "false";
  if (t === "number") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (indent) {
      const pad = " ".repeat(indent * (depth + 1));
      const closePad = " ".repeat(indent * depth);
      return "[\n" + value.map((v) => pad + ser(v, sortKeys, indent, depth + 1)).join(",\n") + "\n" + closePad + "]";
    }
    return "[" + value.map((v) => ser(v, sortKeys, indent, depth + 1)).join(", ") + "]";
  }
  let keys = Object.keys(value);
  if (sortKeys) keys = keys.sort();
  if (keys.length === 0) return "{}";
  if (indent) {
    const pad = " ".repeat(indent * (depth + 1));
    const closePad = " ".repeat(indent * depth);
    return (
      "{\n" +
      keys.map((k) => pad + jsonString(k) + ": " + ser(value[k], sortKeys, indent, depth + 1)).join(",\n") +
      "\n" +
      closePad +
      "}"
    );
  }
  return "{" + keys.map((k) => jsonString(k) + ": " + ser(value[k], sortKeys, indent, depth + 1)).join(", ") + "}";
}

function dumpsSorted2(value) {
  return ser(value, true, 2, 0);
}
function dumpsSortedCompact(value) {
  return ser(value, true, 0, 0);
}

// Python datetime.now(timezone.utc).isoformat() -> "YYYY-MM-DDTHH:MM:SS.ssssss+00:00"
function nowIsoUtc() {
  const d = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const micros = pad(d.getUTCMilliseconds(), 3) + "000";
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${micros}+00:00`
  );
}

function sha256File(p) {
  const data = fs.readFileSync(p);
  return crypto.createHash("sha256").update(data).digest("hex");
}

function fileSize(p) {
  return fs.statSync(p).size;
}

function loadJson(p, label) {
  let raw;
  try {
    raw = fs.readFileSync(p, { encoding: "utf-8" });
  } catch (e) {
    throw new HandoffError("invalid-json", `${label} is not valid JSON: ${p}: ${e.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new HandoffError("invalid-json", `${label} is not valid JSON: ${p}: ${e.message}`);
  }
}

function requireFile(pathText, label) {
  if (!pathText) {
    throw new HandoffError("missing-required-input", `missing required input: ${label}`);
  }
  let st;
  try {
    st = fs.statSync(pathText);
  } catch {
    throw new HandoffError("missing-required-input", `required input does not exist: ${label}: ${pathText}`);
  }
  if (!st.isFile()) {
    throw new HandoffError("missing-required-input", `required input does not exist: ${label}: ${pathText}`);
  }
  return pathText;
}

function writeText(p, text) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, { encoding: "utf-8" });
}

function writeJson(p, value) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, dumpsSorted2(value) + "\n", { encoding: "utf-8" });
}

function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  return {
    sourcePath: String(src),
    relativePath: String(dst),
    sha256: sha256File(src),
    bytes: fileSize(src),
  };
}

function readTextReplace(p) {
  // Node utf-8 decode substitutes invalid bytes with U+FFFD (== errors="replace").
  return fs.readFileSync(p, { encoding: "utf-8" });
}

function extractRoleIds(roleCatalog) {
  const text = readTextReplace(roleCatalog);
  const re = /`(role\.[A-Za-z0-9_.-]+|actor\.chatgpt\.project(?:\.[A-Za-z0-9_\[\].-]+)?)`/g;
  const found = new Set();
  let m;
  while ((m = re.exec(text)) !== null) found.add(m[1]);
  return [...found].sort();
}

function normalizeRoster(value) {
  let threads;
  if (value !== null && typeof value === "object" && !Array.isArray(value) && Array.isArray(value.threads)) {
    threads = value.threads;
  } else if (Array.isArray(value)) {
    threads = value;
  } else {
    throw new HandoffError("invalid-thread-roster", "thread roster must be an array or object with threads[]");
  }

  const byFunction = {};
  for (const row of threads) {
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      throw new HandoffError("invalid-thread-roster", "thread roster entries must be objects");
    }
    const fn = String(row.threadFunction !== undefined ? row.threadFunction : "");
    if (!THREAD_FUNCTIONS.includes(fn)) {
      throw new HandoffError("invalid-thread-roster", `invalid threadFunction: ${fn}`);
    }
    if (fn in byFunction) {
      throw new HandoffError("invalid-thread-roster", `duplicate threadFunction: ${fn}`);
    }
    const actorId = row.actorId;
    const parent = row.parentActor;
    if (!actorId || !parent) {
      throw new HandoffError("invalid-thread-roster", `${fn} needs actorId and parentActor`);
    }
    const normalized = { ...row };
    if (normalized.roleId === undefined) normalized.roleId = "role.chatgpt.thread";
    if (normalized.workRoleId === undefined) normalized.workRoleId = WORK_ROLE_BY_FUNCTION[fn];
    if (normalized.scope === undefined) normalized.scope = {};
    byFunction[fn] = normalized;
  }

  const missing = THREAD_FUNCTIONS.filter((fn) => !(fn in byFunction));
  if (missing.length) {
    throw new HandoffError("invalid-thread-roster", `missing threadFunction entries: ${missing.join(", ")}`);
  }
  return THREAD_FUNCTIONS.map((fn) => byFunction[fn]);
}

function rel(p, root) {
  return path.relative(root, p);
}

function readbackChecklist(thread, manifest) {
  const fn = thread.threadFunction;
  const files = [
    "HANDOFF_MANIFEST.json",
    "REQUEST.md",
    "COMMON/role-catalog.ref.json",
    "COMMON/organization-topology.a2ui.jsonl",
    "COMMON/source-manifest.json",
    "COMMON/runtime-manifest.json",
    `THREADS/${fn}/BOOTSTRAP.md`,
  ];
  const roleRef = manifest.sourceRefs.roleCatalog;
  const requestRef = manifest.sourceRefs.request;
  return [
    `# Readback checklist: ${fn}`,
    "",
    "Before doing assigned work, return a short readback that includes:",
    "",
    `- actorId: ${thread.actorId}`,
    `- roleId: ${thread.roleId}`,
    `- threadFunction: ${fn}`,
    `- workRoleId: ${thread.workRoleId}`,
    `- parentActor: ${thread.parentActor}`,
    `- role catalog sha256: ${roleRef.sha256}`,
    `- request sha256: ${requestRef.sha256}`,
    "- file names read:",
    ...files.map((name) => `  - ${name}`),
    "- your goal in one sentence",
    "- forbidden actions you must obey",
    "- proposed completion criteria",
    "",
    "Do not start implementation, review, merge-work, or merge-review before parent approval of criteria.",
    "",
  ].join("\n");
}

function bootstrap(thread, requestTitle) {
  const fn = thread.threadFunction;
  const forbidden = FORBIDDEN_BY_FUNCTION[fn].map((item) => `- ${item}`).join("\n");
  const expected = EXPECTED_BY_FUNCTION[fn].map((item) => `- ${item}`).join("\n");
  const scope = dumpsSorted2(thread.scope !== undefined ? thread.scope : {});
  return `# Bootstrap: ${fn}

You are a bound Project thread actor.

## Identity

- actorId: ${thread.actorId}
- roleId: ${thread.roleId}
- workRoleId: ${thread.workRoleId}
- threadFunction: ${fn}
- parentActor: ${thread.parentActor}

## Request

- request title: ${requestTitle}
- request file: REQUEST.md
- handoff manifest: HANDOFF_MANIFEST.json

## Scope

\`\`\`json
${scope}
\`\`\`

## Authority refs

- role catalog ref: COMMON/role-catalog.ref.json
- organization topology: COMMON/organization-topology.a2ui.jsonl
- command/request ref: COMMON/command-board.ref.json
- source manifest: COMMON/source-manifest.json
- runtime manifest: COMMON/runtime-manifest.json
- payload manifest: PAYLOAD/MANIFEST.json

These refs are inputs. They do not grant semantic approval or completion approval.

## Required first response

Read READBACK_CHECKLIST.md and return the requested short readback plus proposed
completion criteria. Do not start the assigned work until the parent approves
the criteria.

## Expected output

${expected}

## Forbidden actions

${forbidden}
- do not paste source, diff, review report, handoff body, or result artifact inline
- do not rely on conversation history when the Project Source files disagree
- do not claim complete-approved; only the direct parent can approve completion

## Handoff state

\`handoff-created\` is non-terminal. It only proves this input exists. Work is not
complete until the direct parent verifies evidence and appends approval.
`;
}

function expectedOutputText(fn) {
  const title = fn === "impl-work" || fn === "merge-work" ? "Expected output" : "Review checklist";
  const lines = [`# ${title}: ${fn}`, ""];
  for (const item of EXPECTED_BY_FUNCTION[fn]) lines.push(`- ${item}`);
  lines.push(
    "",
    "Always include evidence paths or artifact filenames and sha256 where available.",
    "Never treat upload, readback, or artifact visibility as semantic approval.",
    "",
  );
  return lines.join("\n");
}

function buildSourceRef(p) {
  return {
    path: String(p),
    sha256: sha256File(p),
    bytes: fileSize(p),
  };
}

// Python str.lstrip("# "): remove any leading chars in the set {'#',' '}.
function lstripHashSpace(s) {
  let i = 0;
  while (i < s.length && (s[i] === "#" || s[i] === " ")) i++;
  return s.slice(i);
}
function pyStripEnds(s) {
  return s.replace(/^\s+/u, "").replace(/\s+$/u, "");
}
function splitlines(s) {
  if (s === "") return [];
  return s.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/);
}

function generate(args) {
  const roleCatalog = requireFile(args["role-catalog"], "role catalog");
  const topology = requireFile(args.topology, "organization topology");
  const commandBoard = requireFile(args["command-board"], "command board or request record");
  const request = requireFile(args.request, "request");
  const sourceManifest = requireFile(args["source-manifest"], "source manifest");
  const runtimeManifest = requireFile(args["runtime-manifest"], "runtime manifest");
  const mergeTarget = requireFile(args["merge-target"], "merge target");
  const threadRoster = requireFile(args["thread-roster"], "thread roster");

  const sourceValue = loadJson(sourceManifest, "source manifest");
  const runtimeValue = loadJson(runtimeManifest, "runtime manifest");
  const mergeValue = loadJson(mergeTarget, "merge target");
  const roster = normalizeRoster(loadJson(threadRoster, "thread roster"));

  const outDir = args["out-dir"];
  const outExists = fs.existsSync(outDir);
  if (outExists && !args.force) {
    throw new HandoffError("output-exists", `output directory already exists: ${outDir}`);
  }
  if (outExists) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outDir, { recursive: true });

  const firstLine = splitlines(readTextReplace(request))[0] || "";
  const requestTitle = args.title || pyStripEnds(lstripHashSpace(firstLine)) || "handoff request";
  const createdAt = nowIsoUtc();

  const common = path.join(outDir, "COMMON");
  const threadsDir = path.join(outDir, "THREADS");
  const payloadDir = path.join(outDir, "PAYLOAD");
  fs.mkdirSync(payloadDir, { recursive: true });

  const commonRefs = {
    roleCatalog: buildSourceRef(roleCatalog),
    organizationTopology: buildSourceRef(topology),
    commandBoard: buildSourceRef(commandBoard),
    request: buildSourceRef(request),
    sourceManifest: buildSourceRef(sourceManifest),
    runtimeManifest: buildSourceRef(runtimeManifest),
    mergeTarget: buildSourceRef(mergeTarget),
    threadRoster: buildSourceRef(threadRoster),
  };

  copyFile(request, path.join(outDir, "REQUEST.md"));
  copyFile(topology, path.join(common, "organization-topology.a2ui.jsonl"));
  writeJson(path.join(common, "role-catalog.ref.json"), {
    kind: "ops.handoff.roleCatalogRef.v1",
    source: commonRefs.roleCatalog,
    knownRoleIds: extractRoleIds(roleCatalog),
    note: "Role definitions remain in the role catalog. This handoff stores a reference and readable summaries only.",
  });
  writeJson(path.join(common, "command-board.ref.json"), {
    kind: "ops.handoff.commandBoardRef.v1",
    source: commonRefs.commandBoard,
  });
  writeJson(path.join(common, "source-manifest.json"), sourceValue);
  writeJson(path.join(common, "runtime-manifest.json"), runtimeValue);
  writeJson(path.join(common, "merge-target.json"), mergeValue);

  let payloadValue;
  let payloadRef;
  if (args["payload-manifest"]) {
    const payloadManifest = requireFile(args["payload-manifest"], "payload manifest");
    payloadValue = loadJson(payloadManifest, "payload manifest");
    payloadRef = buildSourceRef(payloadManifest);
  } else {
    payloadValue = {
      kind: "ops.handoff.payloadManifest.v1",
      payloadKind: "stub",
      provider: "stub-provider-for-ops-handoff-core-proof",
      sourceManifest: "COMMON/source-manifest.json",
      runtimeManifest: "COMMON/runtime-manifest.json",
      note: "Stub payload proves core independence from Src Pack + Offline Nix Cache.",
    };
    const encoded = Buffer.from(dumpsSortedCompact(payloadValue), "utf-8");
    payloadRef = {
      path: "generated:stub",
      sha256: crypto.createHash("sha256").update(encoded).digest("hex"),
      bytes: encoded.length,
    };
  }
  writeJson(path.join(payloadDir, "MANIFEST.json"), payloadValue);

  let handoffId = args["handoff-id"];
  if (!handoffId) {
    const handoffSeed = [requestTitle, createdAt, commonRefs.request.sha256, path.resolve(outDir)].join("|");
    handoffId = "handoff:" + crypto.createHash("sha256").update(Buffer.from(handoffSeed, "utf-8")).digest("hex").slice(0, 24);
  }

  const manifest = {
    kind: "ops.handoff.v1",
    handoffId,
    createdAt,
    title: requestTitle,
    state: {
      current: "handoff-created",
      terminal: false,
      nextRequired: [
        "worker-readable-readback",
        "completion-criteria-proposed",
        "parent-criteria-approval",
        "thread-function-work",
      ],
    },
    sourceRefs: commonRefs,
    payload: {
      payloadKind: String(payloadValue.payloadKind !== undefined ? payloadValue.payloadKind : "unknown"),
      provider: String(payloadValue.provider !== undefined ? payloadValue.provider : "unknown"),
      manifestPath: "PAYLOAD/MANIFEST.json",
      source: payloadRef,
    },
    mergeTarget: mergeValue,
    threads: [],
    projectSource: {
      entrypoint: "HANDOFF_MANIFEST.json",
      inlineAllowed: ["short control", "pointer", "status", "filename", "sha256"],
      inlineForbidden: ["source body", "diff body", "handoff body", "review report body", "artifact body"],
    },
    approvalBoundary: {
      transportReadbackIsApproval: false,
      semanticApproval: false,
      completionApproval: false,
    },
    issues: [
      "ops/issues/001-thread-fsm-handoff-created-not-terminal.md",
      "ops/issues/002-project-transport-live-proof-hardening.md",
      "ops/issues/003-end-to-end-handoff-generator.md",
      "ops/issues/004-src-pack-offline-nix-cache-payload.md",
    ],
  };

  for (const thread of roster) {
    const fn = thread.threadFunction;
    const threadPath = path.join(threadsDir, fn);
    fs.mkdirSync(threadPath, { recursive: true });
    manifest.threads.push({
      actorId: thread.actorId,
      roleId: thread.roleId,
      workRoleId: thread.workRoleId,
      threadFunction: fn,
      parentActor: thread.parentActor,
      scope: thread.scope !== undefined ? thread.scope : {},
      bootstrapPath: `THREADS/${fn}/BOOTSTRAP.md`,
      readbackChecklistPath: `THREADS/${fn}/READBACK_CHECKLIST.md`,
    });
    writeText(path.join(threadPath, "BOOTSTRAP.md"), bootstrap(thread, requestTitle));
    writeText(path.join(threadPath, "READBACK_CHECKLIST.md"), readbackChecklist(thread, manifest));
    let fileName;
    if (fn === "impl-work" || fn === "merge-work") fileName = "EXPECTED_OUTPUT.md";
    else if (fn === "impl-review") fileName = "REVIEW_CHECKLIST.md";
    else fileName = "MERGE_REVIEW_CHECKLIST.md";
    writeText(path.join(threadPath, fileName), expectedOutputText(fn));
  }

  writeJson(path.join(outDir, "HANDOFF_MANIFEST.json"), manifest);

  const result = {
    ok: true,
    status: "handoff-generated",
    handoffDir: String(outDir),
    manifest: path.join(outDir, "HANDOFF_MANIFEST.json"),
    threadFunctions: [...THREAD_FUNCTIONS],
    terminal: false,
  };
  process.stdout.write((args.json ? dumpsSorted2(result) : `handoff generated: ${outDir}`) + "\n");
  return 0;
}

function validate(args) {
  const root = args["handoff-dir"];
  const manifestPath = path.join(root, "HANDOFF_MANIFEST.json");
  if (!(fs.existsSync(manifestPath) && fs.statSync(manifestPath).isFile())) {
    throw new HandoffError("missing-manifest", `missing HANDOFF_MANIFEST.json: ${manifestPath}`);
  }
  const manifest = loadJson(manifestPath, "handoff manifest");
  const errors = [];

  const g = (o, k) => (o && typeof o === "object" ? o[k] : undefined);

  if (g(manifest, "kind") !== "ops.handoff.v1") errors.push("manifest kind must be ops.handoff.v1");
  const state = g(manifest, "state") || {};
  if (g(state, "current") === "handoff-created" && g(state, "terminal") !== false) {
    errors.push("handoff-created must be non-terminal");
  }
  const ab = g(manifest, "approvalBoundary") || {};
  if (g(ab, "transportReadbackIsApproval") !== false) {
    errors.push("transport/readback must not be approval");
  }

  const threads = g(manifest, "threads") || [];
  const seen = new Set(
    threads.filter((row) => row && typeof row === "object" && !Array.isArray(row)).map((row) => row.threadFunction),
  );
  for (const fn of THREAD_FUNCTIONS) {
    if (!seen.has(fn)) errors.push(`missing threadFunction in manifest: ${fn}`);
    const tdir = path.join(root, "THREADS", fn);
    if (!isFile(path.join(tdir, "BOOTSTRAP.md"))) errors.push(`missing bootstrap: ${fn}`);
    if (!isFile(path.join(tdir, "READBACK_CHECKLIST.md"))) errors.push(`missing readback checklist: ${fn}`);
  }

  const requiredFiles = [
    path.join(root, "REQUEST.md"),
    path.join(root, "COMMON", "role-catalog.ref.json"),
    path.join(root, "COMMON", "organization-topology.a2ui.jsonl"),
    path.join(root, "COMMON", "command-board.ref.json"),
    path.join(root, "COMMON", "source-manifest.json"),
    path.join(root, "COMMON", "runtime-manifest.json"),
    path.join(root, "PAYLOAD", "MANIFEST.json"),
  ];
  for (const p of requiredFiles) {
    if (!isFile(p)) {
      errors.push(`missing required generated file: ${isRelativeTo(p, root) ? rel(p, root) : p}`);
    }
  }

  const roleRefPath = path.join(root, "COMMON", "role-catalog.ref.json");
  const roleRef = isFile(roleRefPath) ? loadJson(roleRefPath, "role catalog ref") : {};
  if (!(g(roleRef, "source") && g(g(roleRef, "source"), "sha256"))) {
    errors.push("role catalog ref must include source sha256");
  }
  const srcRefs = g(manifest, "sourceRefs") || {};
  const orgTopo = g(srcRefs, "organizationTopology") || {};
  if (!g(orgTopo, "sha256")) {
    errors.push("manifest must include organization topology sha256");
  }

  const sentinel = args["no-role-body-sentinel"];
  if (sentinel) {
    const threadsRoot = path.join(root, "THREADS");
    for (const bp of globBootstrap(threadsRoot)) {
      if (readTextReplace(bp).includes(sentinel)) {
        errors.push(`role catalog body leaked into ${rel(bp, root)}`);
      }
    }
  }

  if (errors.length) {
    process.stdout.write(dumpsSorted2({ ok: false, status: "handoff-invalid", errors }) + "\n");
    return 1;
  }

  process.stdout.write(
    dumpsSorted2({ ok: true, status: "handoff-valid", handoffDir: String(root), threadFunctions: [...THREAD_FUNCTIONS] }) + "\n",
  );
  return 0;
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function isRelativeTo(p, root) {
  const r = path.relative(root, p);
  return !r.startsWith("..") && !path.isAbsolute(r);
}

// Python (root/"THREADS").glob("*/BOOTSTRAP.md") in sorted order.
function globBootstrap(threadsRoot) {
  let entries;
  try {
    entries = fs.readdirSync(threadsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const result = [];
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (e.isDirectory()) {
      const candidate = path.join(threadsRoot, e.name, "BOOTSTRAP.md");
      if (isFile(candidate)) result.push(candidate);
    }
  }
  return result;
}

function importResult(args) {
  if (!THREAD_FUNCTIONS.includes(args["thread-function"])) {
    throw new HandoffError("invalid-thread-function", `invalid threadFunction: ${args["thread-function"]}`);
  }
  const artifacts = [];
  for (const item of args.artifact || []) {
    const p = requireFile(item, "artifact");
    artifacts.push({
      path: String(p),
      name: path.basename(p),
      sha256: sha256File(p),
      bytes: fileSize(p),
    });
  }
  const runReport = requireFile(args["run-report"], "RUN_REPORT");
  let verdictText = "";
  let verdictSource = null;
  if (args["verdict-file"]) {
    const verdictFile = requireFile(args["verdict-file"], "verdict file");
    verdictText = readTextReplace(verdictFile);
    verdictSource = {
      path: String(verdictFile),
      sha256: sha256File(verdictFile),
      bytes: fileSize(verdictFile),
    };
  } else if (args.verdict !== undefined && args.verdict !== null) {
    verdictText = args.verdict;
    verdictSource = { inlineControl: true };
  } else {
    throw new HandoffError("missing-required-input", "missing verdict or verdict-file");
  }

  const expectedPrefix =
    args["thread-function"] === "impl-review"
      ? "impl-review-"
      : args["thread-function"] === "merge-review"
        ? "merge-review-"
        : "";
  let firstLine = "";
  for (const line of splitlines(verdictText)) {
    const s = pyStripEnds(line);
    if (s) {
      firstLine = s;
      break;
    }
  }
  const verdictStatus = expectedPrefix && !firstLine.startsWith(expectedPrefix) ? "verdict-not-gate-specific" : "verdict-recorded";

  const claim = {
    kind: "ops.handoffResultClaim.v1",
    createdAt: nowIsoUtc(),
    threadFunction: args["thread-function"],
    status: "handoff-result-imported",
    verdictStatus,
    verdict: firstLine,
    verdictSource,
    artifacts,
    runReport: {
      path: String(runReport),
      sha256: sha256File(runReport),
      bytes: fileSize(runReport),
    },
    approvalBoundary: {
      transportReadbackIsApproval: false,
      semanticApproval: false,
      completionApproval: false,
      localizerApproval: false,
    },
  };
  if (args["claim-path"]) {
    const claimPath = args["claim-path"];
    fs.mkdirSync(path.dirname(claimPath), { recursive: true });
    fs.appendFileSync(claimPath, dumpsSortedCompact(claim) + "\n", { encoding: "utf-8" });
  }
  const result = {
    ok: true,
    status: "handoff-result-imported",
    threadFunction: args["thread-function"],
    claimPath: args["claim-path"] !== undefined ? args["claim-path"] : null,
    claim,
    semanticApproval: false,
    completionApproval: false,
    localizerApproval: false,
  };
  process.stdout.write((args.json ? dumpsSorted2(result) : "handoff-result-imported") + "\n");
  return 0;
}

// --- minimal argparse-like parser for the three subcommands ---
const STRING_OPTS = {
  generate: [
    "role-catalog",
    "topology",
    "command-board",
    "request",
    "source-manifest",
    "runtime-manifest",
    "merge-target",
    "thread-roster",
    "payload-manifest",
    "out-dir",
    "handoff-id",
    "title",
  ],
  validate: ["handoff-dir", "no-role-body-sentinel"],
  "import-result": ["thread-function", "run-report", "verdict", "verdict-file", "claim-path"],
};
const BOOL_OPTS = {
  generate: ["force", "json"],
  validate: [],
  "import-result": ["json"],
};
const APPEND_OPTS = {
  generate: [],
  validate: [],
  "import-result": ["artifact"],
};

function argError(message) {
  process.stderr.write(`ops-handoff-core: error: ${message}\n`);
  process.exit(2);
}

function parseSub(command, argv) {
  const args = {};
  if (command === "validate") args["no-role-body-sentinel"] = "";
  for (const k of APPEND_OPTS[command]) args[k] = [];
  for (const k of BOOL_OPTS[command]) args[k] = false;
  let i = 0;
  while (i < argv.length) {
    const tok = argv[i];
    if (!tok.startsWith("--")) argError(`unrecognized arguments: ${tok}`);
    let name = tok.slice(2);
    let inlineVal;
    const eq = name.indexOf("=");
    if (eq >= 0) {
      inlineVal = name.slice(eq + 1);
      name = name.slice(0, eq);
    }
    if (BOOL_OPTS[command].includes(name)) {
      args[name] = true;
      i += 1;
      continue;
    }
    let value;
    if (inlineVal !== undefined) {
      value = inlineVal;
      i += 1;
    } else {
      if (i + 1 >= argv.length) argError(`argument --${name}: expected one argument`);
      value = argv[i + 1];
      i += 2;
    }
    if (APPEND_OPTS[command].includes(name)) {
      args[name].push(value);
    } else if (STRING_OPTS[command].includes(name)) {
      args[name] = value;
    } else {
      argError(`unrecognized arguments: --${name}`);
    }
  }
  return args;
}

function main(argv) {
  if (argv.length === 0) {
    argError("the following arguments are required: command");
  }
  const command = argv[0];
  if (!["generate", "validate", "import-result"].includes(command)) {
    argError(`argument command: invalid choice: '${command}'`);
  }
  const args = parseSub(command, argv.slice(1));

  // required-argument enforcement (argparse required=True)
  if (command === "generate" && args["out-dir"] === undefined) {
    argError("the following arguments are required: --out-dir");
  }
  if (command === "validate" && args["handoff-dir"] === undefined) {
    argError("the following arguments are required: --handoff-dir");
  }
  if (command === "import-result") {
    if (args["thread-function"] === undefined) argError("the following arguments are required: --thread-function");
    if (args["thread-function"] !== undefined && !THREAD_FUNCTIONS.includes(args["thread-function"])) {
      argError(`argument --thread-function: invalid choice: '${args["thread-function"]}'`);
    }
    if (args["run-report"] === undefined) argError("the following arguments are required: --run-report");
  }

  try {
    if (command === "generate") return generate(args);
    if (command === "validate") return validate(args);
    return importResult(args);
  } catch (e) {
    if (e instanceof HandoffError) {
      process.stdout.write(dumpsSorted2({ ok: false, status: e.status, error: e.msg }) + "\n");
      return 2;
    }
    throw e;
  }
}

process.exit(main(process.argv.slice(2)));
