#!/usr/bin/env node
// project-transport.py の node 移植(脱python)。
// CDP の重い処理は検証済の chromium-cdp-* / cdp-bridge コマンドへ subprocess 委譲する orchestrator。
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);

const DECISION_FLAGS = { semanticApproval: false, completionApproval: false, routeDecision: false };
const THREAD_FUNCTIONS = ["impl-work", "impl-review", "merge-work", "merge-review"];
const LOW_LEVEL_COMMANDS = [
  "chromium-cdp-chatgpt-doctor", "chromium-cdp-project-access-probe", "chromium-cdp-upload-project-source-file",
  "chromium-cdp-project-source-list", "chromium-cdp-project-source-delete", "chromium-cdp-create-project-thread",
  "chromium-cdp-send-chatgpt", "chromium-cdp-read-thread", "chromium-cdp-fetch-artifact-strict", "cdp-bridge",
];
const TRANSPORT_COMMANDS = [
  "project-transport-doctor", "project-transport-env", "project-source-put", "project-source-list",
  "project-source-delete", "project-thread-create", "project-thread-send", "project-thread-readback",
  "project-artifact-fetch", "project-transport-claim", "project-transport-run",
];

const nowIso = () => new Date().toISOString();

function ensureDir(p) { if (!p) return null; fs.mkdirSync(p, { recursive: true }); return p; }
function readText(p) { return fs.readFileSync(p, "utf8"); }
// python json.dumps(sort_keys=True, indent=2) 相当(キー安定化)。
function sortValue(v) {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v).sort()) o[k] = sortValue(v[k]); return o; }
  return v;
}
function stableJson(v) { return JSON.stringify(sortValue(v), null, 2); }
function writeJson(p, value) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, stableJson(value) + "\n", "utf8"); }
function sha256File(p) { return createHash("sha256").update(fs.readFileSync(p)).digest("hex"); }
function isFile(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }

function commonResult(command, args) {
  return { kind: "ops.projectTransportResult.v1", command, ok: false, status: "started", createdAt: nowIso(), dryRun: !!args.dry_run, ...DECISION_FLAGS };
}

function projectUrlShapeError(projectUrl, purpose) {
  let u; try { u = new URL(projectUrl); } catch { return null; }
  const tab = u.searchParams.getAll("tab");
  if (purpose === "thread-create" && tab.length === 1 && tab[0] === "sources") {
    return {
      ok: false, status: "project-url-wrong-shape",
      reason: "thread creation requires the base Project URL, not the Project Sources tab URL",
      projectUrl, expectedUrlShape: "https://chatgpt.com/g/<project-id>/<project-name>/project",
      rejectedUrlShape: "project?tab=sources", allowedFor: ["project-source-put"],
      forbiddenFor: ["project-thread-create", "project-transport-run thread-create phase"],
    };
  }
  return null;
}

function parseJsonMaybe(text) {
  text = String(text || "").trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch { /* fall through */ }
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start >= 0 && end > start) { try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; } }
  return null;
}

function runCommand(cmd, timeoutMs) {
  const r = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8", timeout: timeoutMs ? timeoutMs : undefined, maxBuffer: 256 * 1024 * 1024 });
  if (r.error && r.error.code === "ETIMEDOUT") { const e = new Error("timeout"); e.timeout = true; throw e; }
  return { argv: cmd, returncode: r.status == null ? 1 : r.status, stdout: r.stdout || "", stderr: r.stderr || "", json: parseJsonMaybe(r.stdout || "") };
}

function maybeWriteOut(args, result) {
  if (!("finishedAt" in result)) result.finishedAt = nowIso();
  if (args.out_path) writeJson(args.out_path, result);
  process.stdout.write(stableJson(result) + "\n");
  return result.ok ? 0 : Number(result.exitCode != null ? result.exitCode : 1);
}

function commandFound(name) {
  const dirs = (process.env.PATH || "").split(":");
  for (const d of dirs) {
    const fp = path.join(d, name);
    try { fs.accessSync(fp, fs.constants.X_OK); return { name, found: true, path: fp }; } catch { /* keep */ }
  }
  return { name, found: false, path: null };
}

function tcpProbe(addr, port, timeoutSec) {
  return new Promise((resolve) => {
    const sock = createConnection({ host: addr, port: Number(port) });
    let done = false;
    const finish = (ok, err) => { if (done) return; done = true; try { sock.destroy(); } catch { /* */ } resolve({ ok, err }); };
    sock.setTimeout(Math.max(1, Math.floor(timeoutSec * 1000)));
    sock.on("connect", () => finish(true));
    sock.on("timeout", () => finish(false, "timeout"));
    sock.on("error", (e) => finish(false, String(e && e.message ? e.message : e)));
  });
}

// ---------- handlers ----------
async function handleEnv(args) {
  const result = commonResult("project-transport-env", args);
  const ports = args.ports || [9222, 9223, 9224];
  const probes = [];
  for (const port of ports) {
    const row = { addr: args.addr, port, tcpConnect: false };
    const p = await tcpProbe(args.addr, port, args.connect_timeout_sec);
    if (p.ok) row.tcpConnect = true; else row.error = p.err || "connect failed";
    probes.push(row);
  }
  const reachable = probes.filter((p) => p.tcpConnect);
  let projectProbes = [];
  if (args.project_url && reachable.length && !args.dry_run) {
    for (const row of reachable) {
      const cmd = ["chromium-cdp-project-access-probe", "--projectUrl", args.project_url, "--addr", args.addr, "--port", String(row.port), "--timeoutMs", String(args.timeout_ms), "--json"];
      const low = runCommand(cmd, Math.max(60, Math.floor(args.timeout_ms / 1000) + 30) * 1000);
      const probe = low.json && typeof low.json === "object" ? low.json : null;
      projectProbes.push({ addr: args.addr, port: row.port, command: low, projectAccess: probe, ok: low.returncode === 0 && !!(probe && probe.ok) });
    }
  } else if (args.project_url && reachable.length && args.dry_run) {
    projectProbes = reachable.map((row) => ({ addr: args.addr, port: row.port, dryRun: true, plannedCommand: ["chromium-cdp-project-access-probe", "--projectUrl", args.project_url, "--addr", args.addr, "--port", String(row.port)] }));
  }
  const recommended = projectProbes.find((p) => p.ok) || null;
  let ok, status;
  if (args.project_url) {
    ok = !args.dry_run ? !!recommended : reachable.length > 0;
    status = recommended ? "project-route-recommended" : (args.dry_run && reachable.length ? "project-route-probe-dry-run" : (!reachable.length ? "no-cdp-port-reachable" : "project-route-not-verified"));
  } else { ok = reachable.length > 0; status = reachable.length ? "cdp-port-reachable" : "no-cdp-port-reachable"; }
  Object.assign(result, {
    ok, status, addr: args.addr, projectUrl: args.project_url || null, probes, projectAccessProbes: projectProbes,
    selectedPort: reachable.length ? reachable[0].port : null,
    recommendedRoute: recommended ? { addr: recommended.addr, port: recommended.port, status: (recommended.projectAccess || {}).status } : null,
  });
  return maybeWriteOut(args, result);
}

function handleDoctor(args) {
  const result = commonResult("project-transport-doctor", args);
  const lowLevel = LOW_LEVEL_COMMANDS.map(commandFound);
  const transport = TRANSPORT_COMMANDS.map(commandFound);
  const missing = lowLevel.filter((c) => !c.found).map((c) => c.name);
  const missingTransport = transport.filter((c) => !c.found).map((c) => c.name);
  Object.assign(result, { commands: lowLevel, transportCommands: transport, missingCommands: missing, missingTransportCommands: missingTransport, transportCommandsInPath: missingTransport.length === 0, offlineOnly: !!args.offline });
  if (args.offline) {
    if (args.project_url) Object.assign(result, { ok: false, status: "offline-project-route-unverified", projectUrl: args.project_url, reason: "offline runtime check cannot verify target Project access" });
    else Object.assign(result, { ok: missing.length === 0, status: missing.length === 0 ? "offline-runtime-ok" : "missing-command" });
    return maybeWriteOut(args, result);
  }
  if (args.project_url && args.dry_run) {
    Object.assign(result, { ok: true, status: "project-probe-dry-run-ready", projectUrl: args.project_url, plannedCommand: ["chromium-cdp-project-access-probe", "--projectUrl", args.project_url, "--addr", args.addr, "--port", String(args.port)] });
    return maybeWriteOut(args, result);
  }
  const low = runCommand(["chromium-cdp-chatgpt-doctor", "--addr", args.addr, "--json"], Math.max(30, Math.floor(args.timeout_ms / 1000)) * 1000);
  result.doctorCommand = low;
  const sessions = (low.json && typeof low.json === "object" && low.json.sessions) || [];
  const requested = sessions.find((s) => Number(s.port != null ? s.port : -1) === Number(args.port)) || null;
  if (requested) result.requestedSession = requested;
  const requestedLoginUrl = !!(requested && String(requested.url || "").includes("/auth/login"));
  const requestedOk = !!(requested && requested.status === "logged-in" && !requestedLoginUrl);
  Object.assign(result, { ok: missing.length === 0 && low.returncode === 0 && requestedOk, status: (low.returncode === 0 && missing.length === 0 && requestedOk) ? "cdp-runtime-ok" : "cdp-runtime-blocked" });
  if (requestedLoginUrl) result.status = "cdp-runtime-login-required";
  if (args.project_url) {
    const probe = runCommand(["chromium-cdp-project-access-probe", "--projectUrl", args.project_url, "--addr", args.addr, "--port", String(args.port), "--timeoutMs", String(args.timeout_ms), "--json"], Math.max(60, Math.floor(args.timeout_ms / 1000) + 30) * 1000);
    const projectAccess = probe.json && typeof probe.json === "object" ? probe.json : null;
    result.projectUrl = args.project_url; result.projectAccessCommand = probe; result.projectAccess = projectAccess;
    const projectOk = probe.returncode === 0 && !!(projectAccess && projectAccess.ok);
    result.ok = missing.length === 0 && projectOk;
    result.status = projectOk ? "project-route-ok" : ((projectAccess && typeof projectAccess === "object" && projectAccess.status) ? projectAccess.status : "project-route-not-verified");
    result.recommendedRoute = projectOk ? { addr: args.addr, port: args.port, status: result.status, projectUrl: args.project_url } : null;
  }
  return maybeWriteOut(args, result);
}

function sourcePutResult(args, result) {
  const filePath = args.file;
  result.projectUrl = args.project_url;
  result.file = { path: String(filePath), name: path.basename(filePath), exists: isFile(filePath), sha256: isFile(filePath) ? sha256File(filePath) : null };
  result.projectSourceOnly = true; result.threadAttachmentFallbackAllowed = false;
  if (!isFile(filePath)) { Object.assign(result, { ok: false, status: "missing-file" }); return result; }
  const outDir = ensureDir(args.out_dir) || process.cwd();
  const uploadLog = path.join(outDir, `project-source-put-${path.basename(filePath)}.json`);
  if (args.dry_run) { Object.assign(result, { ok: true, status: "dry-run-ready", plannedCommand: ["chromium-cdp-upload-project-source-file", "--projectUrl", args.project_url, "--file", String(filePath), "--outPath", uploadLog] }); return result; }
  const low = runCommand(["chromium-cdp-upload-project-source-file", "--projectUrl", args.project_url, "--file", String(filePath), "--outPath", uploadLog, "--addr", args.addr, "--port", String(args.port), "--timeoutMs", String(args.timeout_ms)], Math.max(60, Math.floor(args.timeout_ms / 1000) + 30) * 1000);
  result.uploadCommand = low; result.uploadLog = uploadLog;
  let parsed = null;
  if (isFile(uploadLog)) parsed = JSON.parse(readText(uploadLog)); else if (low.json != null) parsed = low.json;
  const visible = !!(parsed && parsed.visible && parsed.visible.ok);
  const observedText = stableJson(parsed || {}) + "\n" + (low.stdout || "") + "\n" + (low.stderr || "");
  let status;
  if (visible) status = "source-upload-visible";
  else if (observedText.includes("/auth/login") || observedText.toLowerCase().includes("login required")) status = "project-access-profile-missing";
  else if (parsed && parsed.target && parsed.target.url && !String(parsed.target.url).includes("/project")) status = "source-page-not-loaded";
  else status = "source-upload-not-visible";
  Object.assign(result, { ok: low.returncode === 0 && !!(parsed && parsed.ok) && visible, status, transportSent: low.returncode === 0, transportVisible: visible, readbackVerified: visible, uploadResult: parsed });
  return result;
}
const handleSourcePut = (args) => maybeWriteOut(args, sourcePutResult(args, commonResult("project-source-put", args)));

function sourceListResult(args, result) {
  result.projectUrl = args.project_url; result.projectSourceOnly = true;
  if (args.dry_run) { Object.assign(result, { ok: true, status: "dry-run-ready", plannedCommand: ["chromium-cdp-project-source-list", "--projectUrl", args.project_url] }); return result; }
  const outDir = ensureDir(args.out_dir) || process.cwd();
  const listLog = path.join(outDir, "project-source-list.json");
  const low = runCommand(["chromium-cdp-project-source-list", "--projectUrl", args.project_url, "--outPath", listLog, "--addr", args.addr, "--port", String(args.port), "--timeoutMs", String(args.timeout_ms)], Math.max(60, Math.floor(args.timeout_ms / 1000) + 30) * 1000);
  const parsed = isFile(listLog) ? JSON.parse(readText(listLog)) : low.json;
  Object.assign(result, {
    ok: low.returncode === 0 && !!(parsed && parsed.ok), status: (parsed && parsed.ok) ? "source-list-read" : "source-list-not-read",
    transportRead: low.returncode === 0, readbackVerified: !!(parsed && parsed.ok), listLog, listCommand: low, sourceList: parsed,
    sourceCount: (parsed && typeof parsed === "object") ? (parsed.count != null ? parsed.count : null) : null,
  });
  return result;
}
const handleSourceList = (args) => maybeWriteOut(args, sourceListResult(args, commonResult("project-source-list", args)));

function sourceDeleteResult(args, result) {
  result.projectUrl = args.project_url; result.title = args.title; result.reason = args.reason; result.projectSourceOnly = true;
  result.deleteSafety = { exactTitleRequired: true, allowRemoveFlagRequired: true, reasonRequired: true, fuzzyMatchAllowed: false };
  if (!args.reason) { Object.assign(result, { ok: false, status: "missing-reason" }); return result; }
  if (args.dry_run) {
    const planned = ["chromium-cdp-project-source-delete", "--projectUrl", args.project_url, "--title", args.title, "--reason", args.reason, "--dryRun"];
    if (args.allow_remove) planned.push("--allow-remove");
    Object.assign(result, { ok: true, status: "dry-run-ready", plannedCommand: planned }); return result;
  }
  if (!args.allow_remove) { Object.assign(result, { ok: false, status: "remove-not-authorized", requiredFlag: "--allow-remove" }); return result; }
  const outDir = ensureDir(args.out_dir) || process.cwd();
  const deleteLog = path.join(outDir, `project-source-delete-${args.title}.json`);
  const low = runCommand(["chromium-cdp-project-source-delete", "--projectUrl", args.project_url, "--title", args.title, "--reason", args.reason, "--allow-remove", "--outPath", deleteLog, "--addr", args.addr, "--port", String(args.port), "--timeoutMs", String(args.timeout_ms)], Math.max(60, Math.floor(args.timeout_ms / 1000) + 30) * 1000);
  const parsed = isFile(deleteLog) ? JSON.parse(readText(deleteLog)) : low.json;
  Object.assign(result, {
    ok: low.returncode === 0 && !!(parsed && parsed.ok),
    status: (parsed && typeof parsed === "object" && parsed.status) ? parsed.status : "source-delete-not-verified",
    transportSent: low.returncode === 0, readbackVerified: !!(parsed && parsed.ok && parsed.after), deleteLog, deleteCommand: low, deleteResult: parsed,
    beforeTitleCount: (parsed && typeof parsed === "object") ? (parsed.beforeTitleCount ?? null) : null,
    afterTitleCount: (parsed && typeof parsed === "object") ? (parsed.afterTitleCount ?? null) : null,
  });
  return result;
}
const handleSourceDelete = (args) => maybeWriteOut(args, sourceDeleteResult(args, commonResult("project-source-delete", args)));

function readPrompt(args) { if (args.text_file) return readText(args.text_file); return String(args.text || ""); }

function handleThreadCreate(args) {
  const result = commonResult("project-thread-create", args);
  const shapeError = projectUrlShapeError(args.project_url, "thread-create");
  if (shapeError) { Object.assign(result, shapeError); return maybeWriteOut(args, result); }
  const text = readPrompt(args);
  result.projectUrl = args.project_url; result.promptLength = text.length; result.inlinePolicy = "short-control-pointer-only";
  if (!text) { Object.assign(result, { ok: false, status: "empty-prompt" }); return maybeWriteOut(args, result); }
  const outDir = ensureDir(args.out_dir) || process.cwd();
  const createLog = path.join(outDir, "project-thread-create.json");
  if (args.dry_run) { Object.assign(result, { ok: true, status: "dry-run-ready", plannedCommand: ["chromium-cdp-create-project-thread", "--projectUrl", args.project_url, args.text_file ? "--text-file" : "--text", args.text_file || "<inline-text>", "--outPath", createLog, "--json"] }); return maybeWriteOut(args, result); }
  const cmd = ["chromium-cdp-create-project-thread", "--projectUrl", args.project_url, "--outPath", createLog, "--json", "--addr", args.addr, "--port", String(args.port), "--timeoutMs", String(args.timeout_ms)];
  if (args.text_file) cmd.push("--text-file", args.text_file); else cmd.push("--text", text);
  const low = runCommand(cmd, Math.max(60, Math.floor(args.timeout_ms / 1000) + 30) * 1000);
  const parsed = isFile(createLog) ? JSON.parse(readText(createLog)) : low.json;
  Object.assign(result, {
    ok: low.returncode === 0 && !!(parsed && parsed.ok && parsed.threadUrl), status: (parsed && parsed.threadUrl) ? "thread-created" : "thread-create-not-verified",
    transportSent: low.returncode === 0, readbackVerified: !!(parsed && parsed.threadUrl), createLog, createCommand: low,
    threadUrl: (parsed && typeof parsed === "object") ? (parsed.threadUrl ?? null) : null, conversationId: (parsed && typeof parsed === "object") ? (parsed.conversationId ?? null) : null, createResult: parsed,
  });
  return maybeWriteOut(args, result);
}

function handleThreadSend(args) {
  const result = commonResult("project-thread-send", args);
  const text = readPrompt(args);
  result.threadUrl = args.url; result.projectUrl = args.project_url; result.promptLength = text.length; result.inlinePolicy = "short-control-pointer-only"; result.maxInlineLength = args.max_inline_length;
  if (!text) { Object.assign(result, { ok: false, status: "empty-prompt" }); return maybeWriteOut(args, result); }
  if (text.length > args.max_inline_length) { Object.assign(result, { ok: false, status: "inline-too-long", reason: "upload payload to Project Source and send a pointer only" }); return maybeWriteOut(args, result); }
  const outDir = ensureDir(args.out_dir) || process.cwd();
  const sendDir = path.join(outDir, "send");
  if (args.dry_run) { Object.assign(result, { ok: true, status: "dry-run-ready", plannedCommand: ["chromium-cdp-send-chatgpt", "--url", args.url, args.text_file ? "--text-file" : "--text", args.text_file || "<inline-text>", "--outDir", sendDir] }); return maybeWriteOut(args, result); }
  const cmd = ["chromium-cdp-send-chatgpt", "--url", args.url, "--outDir", sendDir, "--addr", args.addr, "--port", String(args.port)];
  if (args.project_url) cmd.push("--projectUrl", args.project_url);
  if (args.text_file) cmd.push("--text-file", args.text_file); else cmd.push("--text", text);
  const low = runCommand(cmd, Math.max(60, Math.floor(args.timeout_ms / 1000) + 30) * 1000);
  Object.assign(result, { ok: low.returncode === 0, status: low.returncode === 0 ? "thread-message-sent" : "thread-message-not-sent", transportSent: low.returncode === 0, sendOutDir: sendDir, sendCommand: low });
  return maybeWriteOut(args, result);
}

function handleThreadReadback(args) {
  const result = commonResult("project-thread-readback", args);
  result.threadUrl = args.url; result.markers = args.markers;
  if (args.dry_run) { Object.assign(result, { ok: true, status: "dry-run-ready", plannedCommand: ["chromium-cdp-read-thread", "--url", args.url, "--markers", args.markers.join(","), "--tail", String(args.tail)] }); return maybeWriteOut(args, result); }
  const cmd = ["chromium-cdp-read-thread", "--url", args.url, "--addr", args.addr, "--port", String(args.port), "--waitMs", String(args.wait_ms), "--tail", String(args.tail)];
  if (args.id) cmd.push("--id", args.id); else cmd.push("--openIfNeeded");
  if (args.markers.length) cmd.push("--markers", args.markers.join(","));
  const low = runCommand(cmd, Math.max(60, Math.floor(args.wait_ms / 1000) + 60) * 1000);
  const parsed = low.json;
  const hits = (parsed && typeof parsed === "object" && Array.isArray(parsed.hits)) ? parsed.hits : [];
  const found = new Set(hits.filter((h) => h && typeof h === "object").map((h) => h.marker));
  const missing = args.markers.filter((m) => !found.has(m));
  Object.assign(result, { ok: low.returncode === 0 && missing.length === 0, status: (low.returncode === 0 && missing.length === 0) ? "readback-verified" : "readback-missing-marker", transportRead: low.returncode === 0, readbackVerified: low.returncode === 0 && missing.length === 0, missingMarkers: missing, readCommand: low });
  return maybeWriteOut(args, result);
}

function handleArtifactFetch(args) {
  const result = commonResult("project-artifact-fetch", args);
  const outDir = ensureDir(args.out_dir) || process.cwd();
  result.artifactName = args.name; result.outDir = String(outDir);
  if (args.dry_run) { Object.assign(result, { ok: true, status: "dry-run-ready", plannedCommand: ["chromium-cdp-fetch-artifact-strict", "--name", args.name, "--outDir", String(outDir), "--url", args.url || "<irPath>"] }); return maybeWriteOut(args, result); }
  const cmd = ["chromium-cdp-fetch-artifact-strict", "--name", args.name, "--outDir", String(outDir), "--json", "--addr", args.addr, "--port", String(args.port)];
  if (args.url) cmd.push("--url", args.url);
  if (args.ir_path) cmd.push("--irPath", args.ir_path);
  const low = runCommand(cmd, Math.max(60, Math.floor(args.timeout_ms / 1000) + 60) * 1000);
  const parsed = low.json;
  let manifest = null;
  if (parsed && typeof parsed === "object" && parsed.outPath) {
    manifest = { kind: "ops.projectTransportArtifactsManifest.v1", artifacts: [{ name: parsed.name, actualName: parsed.actualName, path: parsed.outPath, size: parsed.size, sha256: parsed.sha256 }], ...DECISION_FLAGS };
    writeJson(path.join(outDir, "ARTIFACTS_MANIFEST.json"), manifest);
  }
  Object.assign(result, { ok: low.returncode === 0 && !!(parsed && parsed.sha256), status: (parsed && parsed.sha256) ? "artifact-fetched" : "artifact-fetch-not-verified", transportRead: low.returncode === 0, readbackVerified: !!(parsed && parsed.sha256), fetchCommand: low, artifactResult: parsed, artifactsManifest: manifest ? path.join(outDir, "ARTIFACTS_MANIFEST.json") : null });
  return maybeWriteOut(args, result);
}

function handleClaim(args) {
  const result = commonResult("project-transport-claim", args);
  const inputDoc = JSON.parse(readText(args.input));
  const claim = { kind: "ops.projectTransportClaim.v1", eventId: args.event_id, createdAt: nowIso(), transportResult: inputDoc, ...DECISION_FLAGS };
  if (args.dry_run) { Object.assign(result, { ok: true, status: "dry-run-ready", claim }); return maybeWriteOut(args, result); }
  fs.mkdirSync(path.dirname(args.claim_path), { recursive: true });
  fs.appendFileSync(args.claim_path, JSON.stringify(sortValue(claim)) + "\n", "utf8");
  Object.assign(result, { ok: true, status: "claim-appended", claimPath: args.claim_path, claim });
  return maybeWriteOut(args, result);
}

function handleHandoffPreflight(args) {
  const result = commonResult("project-handoff-preflight", args);
  result.projectUrl = args.project_url; result.projectSourcePolicy = args.project_source_policy; result.requiredReadbackIntervalSeconds = args.readback_interval_seconds;
  const missing = []; const invalid = [];
  const shapeError = projectUrlShapeError(args.project_url, "thread-create");
  if (shapeError) invalid.push({ field: "projectUrl", status: shapeError.status, reason: shapeError.reason });
  let rosterValue = null;
  if (!args.thread_roster) missing.push("threadRoster");
  else { try { rosterValue = JSON.parse(readText(args.thread_roster)); } catch (e) { invalid.push({ field: "threadRoster", status: "invalid-json", reason: String(e && e.message ? e.message : e) }); } }
  let threads = [];
  if (rosterValue && typeof rosterValue === "object" && !Array.isArray(rosterValue)) threads = rosterValue.threads || [];
  else if (Array.isArray(rosterValue)) threads = rosterValue;
  else if (rosterValue != null) invalid.push({ field: "threadRoster", status: "invalid-shape", reason: "expected array or object with threads[]" });
  const seen = new Set();
  for (const row of Array.isArray(threads) ? threads : []) {
    if (!row || typeof row !== "object") { invalid.push({ field: "threadRoster", status: "invalid-entry", reason: "thread entry must be object" }); continue; }
    const fn = String(row.threadFunction || "");
    if (!THREAD_FUNCTIONS.includes(fn)) invalid.push({ field: "threadFunction", status: "invalid-thread-function", value: fn }); else seen.add(fn);
    if (!row.actorId) invalid.push({ field: "actorId", status: "missing-field", threadFunction: fn });
    if (!row.parentActor) invalid.push({ field: "parentActor", status: "missing-field", threadFunction: fn });
  }
  const missingFunctions = THREAD_FUNCTIONS.filter((f) => !seen.has(f)).sort();
  if (missingFunctions.length) invalid.push({ field: "threadFunction", status: "missing-thread-functions", missing: missingFunctions });
  const sourceFiles = [];
  for (const fileText of args.source_file) { const exists = isFile(fileText); sourceFiles.push({ path: String(fileText), name: path.basename(fileText), exists, sha256: exists ? sha256File(fileText) : null }); if (!exists) invalid.push({ field: "sourceFile", status: "missing-file", path: String(fileText) }); }
  if (!sourceFiles.length) missing.push("sourceFile");
  const bootstrapFiles = [];
  for (const fileText of args.bootstrap_artifact) { const exists = isFile(fileText); bootstrapFiles.push({ path: String(fileText), name: path.basename(fileText), exists, sha256: exists ? sha256File(fileText) : null }); if (!exists) invalid.push({ field: "bootstrapArtifact", status: "missing-file", path: String(fileText) }); }
  if (!bootstrapFiles.length) missing.push("bootstrapArtifact");
  const expectedArtifacts = args.expected_artifact.filter(Boolean);
  if (!expectedArtifacts.length) missing.push("expectedArtifact");
  if (args.project_source_policy !== "project-source-only") invalid.push({ field: "projectSourcePolicy", status: "unsupported-policy", reason: "thread attachments are not a Project Source fallback" });
  Object.assign(result, {
    threadRoster: { path: args.thread_roster, threadFunctions: [...seen].sort(), requiredThreadFunctions: [...THREAD_FUNCTIONS].sort() },
    sourceFiles, bootstrapArtifacts: bootstrapFiles, expectedArtifacts, missing, invalid, threadAttachmentFallbackAllowed: false, inlinePolicy: "short-control-pointer-only",
  });
  if (missing.length || invalid.length) { Object.assign(result, { ok: false, status: "project-handoff-preflight-failed", blockerClass: missing.length ? "project-binding-missing" : "project-handoff-preflight-failed" }); return maybeWriteOut(args, result); }
  if (args.dry_run) {
    Object.assign(result, { ok: true, status: "dry-run-ready", plannedCommands: [["project-transport-doctor", "--project-url", args.project_url], ...sourceFiles.map((row) => ["project-source-put", "--project-url", args.project_url, "--file", row.path]), ["project-thread-create", "--project-url", args.project_url, "--text-file", "<short pointer/control prompt>"], ["project-thread-readback", "--url", "<created-thread-url>", "--markers", expectedArtifacts.join(",")], ["project-artifact-fetch", "--name", expectedArtifacts[0], "--url", "<created-thread-url>"]] });
    return maybeWriteOut(args, result);
  }
  const doctor = runCommand(["project-transport-doctor", "--project-url", args.project_url, "--addr", args.addr, "--port", String(args.port), "--timeout-ms", String(args.timeout_ms)], Math.max(60, Math.floor(args.timeout_ms / 1000) + 30) * 1000);
  const doctorOk = doctor.returncode === 0 && !!(doctor.json && typeof doctor.json === "object" && doctor.json.ok);
  result.doctor = doctor;
  Object.assign(result, { ok: doctorOk, status: doctorOk ? "project-handoff-preflight-ready" : "project-route-not-verified" });
  return maybeWriteOut(args, result);
}

function writeRunReport(outDir, result) {
  const p = path.join(outDir, "TRANSPORT_RUN_REPORT.md");
  const lines = ["# Project Transport Run Report", "", `- ok: \`${String(result.ok).toLowerCase()}\``, `- status: \`${result.status}\``, `- semanticApproval: \`${String(result.semanticApproval).toLowerCase()}\``, `- completionApproval: \`${String(result.completionApproval).toLowerCase()}\``, `- routeDecision: \`${String(result.routeDecision).toLowerCase()}\``, "", "## Steps"];
  for (const step of result.steps || []) lines.push(`- \`${step.command}\`: \`${step.status}\` ok=\`${String(step.ok).toLowerCase()}\``);
  fs.writeFileSync(p, lines.join("\n") + "\n", "utf8");
  return p;
}

function handleRun(args) {
  const result = commonResult("project-transport-run", args);
  const outDir = ensureDir(args.out_dir) || process.cwd();
  result.projectUrl = args.project_url; result.outDir = String(outDir);
  const steps = [];
  if (args.prompt_file || args.text) {
    const shapeError = projectUrlShapeError(args.project_url, "thread-create");
    if (shapeError) { Object.assign(result, shapeError); result.status = "project-url-wrong-shape"; result.steps = steps; writeRunReport(outDir, result); writeJson(path.join(outDir, "transport-result.json"), result); return maybeWriteOut(args, result); }
  }
  for (const source of args.source_file) {
    const ns = { ...args, file: source, out_path: null };
    const step = sourcePutResult(ns, commonResult("project-source-put", ns));
    steps.push(step);
    if (!step.ok) { Object.assign(result, { ok: false, status: "source-put-failed", steps }); writeRunReport(outDir, result); return maybeWriteOut(args, result); }
  }
  if (args.prompt_file || args.text) {
    const ns = { ...args, text_file: args.prompt_file, out_path: null };
    const createResult = commonResult("project-thread-create", ns);
    if (args.dry_run) Object.assign(createResult, { ok: true, status: "dry-run-ready", plannedCommand: ["chromium-cdp-create-project-thread", "--projectUrl", args.project_url] });
    else {
      const createArgs = ["project-thread-create", "--project-url", args.project_url, "--out-dir", String(outDir), "--addr", args.addr, "--port", String(args.port), "--timeout-ms", String(args.timeout_ms)];
      if (args.prompt_file) createArgs.push("--text-file", args.prompt_file); else createArgs.push("--text", args.text);
      const low = runCommand([process.execPath, SELF, ...createArgs], Math.max(60, Math.floor(args.timeout_ms / 1000) + 60) * 1000);
      Object.assign(createResult, low.json || { ok: false, status: "thread-create-wrapper-failed", commandOutput: low });
    }
    steps.push(createResult);
    if (!createResult.ok) { Object.assign(result, { ok: false, status: "thread-create-failed", steps }); writeRunReport(outDir, result); return maybeWriteOut(args, result); }
    if (createResult.threadUrl) result.threadUrl = createResult.threadUrl;
    if (args.readback_marker.length) {
      const readbackResult = commonResult("project-thread-readback", ns);
      readbackResult.markers = args.readback_marker;
      if (args.dry_run) Object.assign(readbackResult, { ok: true, status: "dry-run-ready", plannedCommand: ["project-thread-readback", "--url", createResult.threadUrl || "<created-thread-url>", "--markers", args.readback_marker.join(","), "--wait-ms", String(args.readback_wait_ms)] });
      else if (createResult.threadUrl) {
        const readbackArgs = ["project-thread-readback", "--url", createResult.threadUrl, "--markers", args.readback_marker.join(","), "--wait-ms", String(args.readback_wait_ms), "--addr", args.addr, "--port", String(args.port), "--out-dir", String(outDir)];
        const low = runCommand([process.execPath, SELF, ...readbackArgs], Math.max(60, Math.floor(args.readback_wait_ms / 1000) + 60) * 1000);
        Object.assign(readbackResult, low.json || { ok: false, status: "thread-readback-wrapper-failed", commandOutput: low });
      } else Object.assign(readbackResult, { ok: false, status: "thread-url-missing" });
      steps.push(readbackResult);
      if (!readbackResult.ok) { Object.assign(result, { ok: false, status: "thread-readback-failed", steps }); writeRunReport(outDir, result); return maybeWriteOut(args, result); }
    }
  }
  Object.assign(result, { ok: true, status: args.dry_run ? "transport-run-ready" : "transport-run-complete", steps });
  const report = writeRunReport(outDir, result); result.runReport = String(report);
  writeJson(path.join(outDir, "transport-result.json"), result);
  return maybeWriteOut(args, result);
}

// ---------- arg parsing(argparse 互換の最小実装) ----------
const ALIAS = {
  "--out-path": "out_path", "--outPath": "out_path", "--out-dir": "out_dir", "--outDir": "out_dir",
  "--project-url": "project_url", "--projectUrl": "project_url", "--addr": "addr",
  "--timeout-ms": "timeout_ms", "--timeoutMs": "timeout_ms", "--port": "port",
  "--file": "file", "--title": "title", "--reason": "reason", "--url": "url", "--id": "id", "--name": "name",
  "--text": "text", "--text-file": "text_file", "--textFile": "text_file",
  "--ir-path": "ir_path", "--irPath": "ir_path", "--input": "input",
  "--claim-path": "claim_path", "--claimPath": "claim_path", "--event-id": "event_id", "--eventId": "event_id",
  "--ports": "ports", "--connect-timeout-sec": "connect_timeout_sec",
  "--max-inline-length": "max_inline_length", "--markers": "markers", "--wait-ms": "wait_ms", "--waitMs": "wait_ms", "--tail": "tail",
  "--thread-roster": "thread_roster", "--threadRoster": "thread_roster",
  "--source-file": "source_file", "--sourceFile": "source_file",
  "--bootstrap-artifact": "bootstrap_artifact", "--bootstrapArtifact": "bootstrap_artifact",
  "--expected-artifact": "expected_artifact", "--expectedArtifact": "expected_artifact",
  "--project-source-policy": "project_source_policy", "--projectSourcePolicy": "project_source_policy",
  "--readback-interval-seconds": "readback_interval_seconds", "--readbackIntervalSeconds": "readback_interval_seconds",
  "--prompt-file": "prompt_file", "--promptFile": "prompt_file",
  "--readback-marker": "readback_marker", "--readbackMarker": "readback_marker",
  "--readback-wait-ms": "readback_wait_ms", "--readbackWaitMs": "readback_wait_ms",
};
const BOOL = { "--dry-run": "dry_run", "--dryRun": "dry_run", "--offline": "offline", "--allow-remove": "allow_remove", "--allowRemove": "allow_remove" };
const APPEND = new Set(["source_file", "bootstrap_artifact", "expected_artifact", "readback_marker"]);
const INT = new Set(["port", "timeout_ms", "max_inline_length", "wait_ms", "tail", "readback_interval_seconds", "readback_wait_ms"]);

function parseArgs(argv) {
  const a = { source_file: [], bootstrap_artifact: [], expected_artifact: [], readback_marker: [], markers: [], dry_run: false, offline: false, allow_remove: false };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (BOOL[tok] != null) { a[BOOL[tok]] = true; continue; }
    const dest = ALIAS[tok];
    if (dest == null) continue;
    const val = argv[++i];
    if (dest === "ports") a.ports = String(val).split(",").filter((x) => x).map((x) => parseInt(x, 10));
    else if (dest === "markers") a.markers = String(val).split(",").filter((x) => x);
    else if (dest === "connect_timeout_sec") a.connect_timeout_sec = parseFloat(val);
    else if (APPEND.has(dest)) a[dest].push(val);
    else if (INT.has(dest)) a[dest] = parseInt(val, 10);
    else a[dest] = val;
  }
  // defaults
  if (a.addr == null) a.addr = process.env.HQ_CHROME_ADDR || "127.0.0.1";
  if (a.port == null) a.port = parseInt(process.env.HQ_CHROME_PORT || "9222", 10);
  if (a.timeout_ms == null) a.timeout_ms = 180000;
  if (a.connect_timeout_sec == null) a.connect_timeout_sec = 0.25;
  if (a.max_inline_length == null) a.max_inline_length = 2000;
  if (a.wait_ms == null) a.wait_ms = 30000;
  if (a.tail == null) a.tail = 5;
  if (a.readback_interval_seconds == null) a.readback_interval_seconds = 300;
  if (a.readback_wait_ms == null) a.readback_wait_ms = 300000;
  if (a.project_source_policy == null) a.project_source_policy = "project-source-only";
  if (a.event_id == null) a.event_id = "project-transport-claim";
  return a;
}

const HANDLERS = {
  env: handleEnv, doctor: handleDoctor, "source-put": handleSourcePut, "source-list": handleSourceList,
  "source-delete": handleSourceDelete, "thread-create": handleThreadCreate, "thread-send": handleThreadSend,
  "thread-readback": handleThreadReadback, "artifact-fetch": handleArtifactFetch, claim: handleClaim,
  "handoff-preflight": handleHandoffPreflight, run: handleRun,
};

async function main(argv) {
  const command = argv[0];
  const handler = HANDLERS[command];
  if (!handler) { process.stderr.write(`project-transport: unknown command: ${command || "(none)"}\ncommands: ${Object.keys(HANDLERS).join(", ")}\n`); return 2; }
  const args = parseArgs(argv.slice(1));
  args.command = command;
  try { return await handler(args); }
  catch (e) {
    const result = commonResult(command, args);
    Object.assign(result, { ok: false, status: e && e.timeout ? "transport-timeout" : "transport-error", error: String(e && e.message ? e.message : e) });
    return maybeWriteOut(args, result);
  }
}

process.exit(await main(process.argv.slice(2)));
