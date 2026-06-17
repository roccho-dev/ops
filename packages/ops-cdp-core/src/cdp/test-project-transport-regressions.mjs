// Ported from project-transport の python regression suite (test-project-transport-regressions.py)。
// 対象は node 版 project-transport.mjs(脱python後の実装)。
// 5 本目の self-running test runner: test-cdp-scripts.mjs と同じ自前 assert / Summary / exit パターン。
// qjs-cli.mjs launcher(node)経由で実行する。
import * as std from "./core/std.mjs";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import * as pt from "./project-transport.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
    std.out.puts(`  PASS: ${msg}\n`);
  } else {
    failed++;
    std.out.puts(`  FAIL: ${msg}\n`);
  }
}

// python `patched(pt, name, value)` 相当: __testHooks[name] を save→上書き→restore。
function patched(name, value, body) {
  const old = pt.__testHooks[name];
  pt.__testHooks[name] = value;
  try {
    return body();
  } finally {
    pt.__testHooks[name] = old;
  }
}

// 複数 hook を同時に patch(python の入れ子 with 相当)。
// body が Promise を返す場合(async handler)も最後まで patch を維持してから restore する。
async function patchedMany(overrides, body) {
  const keys = Object.keys(overrides);
  const olds = {};
  for (const k of keys) { olds[k] = pt.__testHooks[k]; pt.__testHooks[k] = overrides[k]; }
  try {
    return await body();
  } finally {
    for (const k of keys) pt.__testHooks[k] = olds[k];
  }
}

// python argparse.Namespace 既定 + 上書き。field 名は node の parseArgs 出力に対応。
function ns(values) {
  return {
    addr: "127.0.0.1",
    port: 9222,
    timeout_ms: 180000,
    dry_run: false,
    out_path: null,
    out_dir: null,
    project_url: "https://chatgpt.com/g/g-p-test/project",
    ...values,
  };
}

function mkdtemp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmrf(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
}

function test_upload_command_selection() {
  assert(pt.projectSourceUploadCommand("request.md", "auto") === "chromium-cdp-upload-project-source-text", "upload-command: request.md+auto -> text");
  assert(pt.projectSourceUploadCommand("bundle.zip", "auto") === "chromium-cdp-upload-project-source-file", "upload-command: bundle.zip+auto -> file");
  assert(pt.projectSourceUploadCommand("bundle.zip", "text") === "chromium-cdp-upload-project-source-text", "upload-command: bundle.zip+text -> text");
  assert(pt.projectSourceUploadCommand("request.md", "file") === "chromium-cdp-upload-project-source-file", "upload-command: request.md+file -> file");
}

function test_visible_upload_is_not_worker_readback() {
  const tmp = mkdtemp("pt_visible_");
  try {
    const source = path.join(tmp, "handoff.txt");
    fs.writeFileSync(source, "READBACK_MARK: sample\n");
    const fakeRun = (cmd) => {
      assert(cmd[0] === "chromium-cdp-upload-project-source-text", "visible-upload: text command selected");
      return {
        argv: cmd, returncode: 0, stdout: "", stderr: "",
        json: { ok: true, upload: { ok: true, textTail: `Add sources\n${path.basename(source)}\nDocument` } },
      };
    };
    const args = ns({ file: source, out_dir: tmp, upload_mode: "auto" });
    const result = patched("runCommand", fakeRun, () => pt.sourcePutResult(args, pt.commonResult("project-source-put", args)));
    assert(result.ok === true, "visible-upload: ok true");
    assert(result.status === "source-upload-visible-unverified", "visible-upload: status source-upload-visible-unverified");
    assert(result.transportVisible === true, "visible-upload: transportVisible true");
    assert(result.readbackVerified === false, "visible-upload: readbackVerified false");
    assert(result.workerReadbackVerified === false, "visible-upload: workerReadbackVerified false");
    assert(result.verificationLevel === "visible-only", "visible-upload: verificationLevel visible-only");
    assert(result.selectedUploadCommand === "chromium-cdp-upload-project-source-text", "visible-upload: selectedUploadCommand text");
  } finally {
    rmrf(tmp);
  }
}

function test_source_list_unreliable_is_not_success() {
  const tmp = mkdtemp("pt_list_unrel_");
  try {
    const fakeRun = (cmd) => ({
      argv: cmd, returncode: 0, stdout: "", stderr: "",
      json: { ok: true, count: 0, sources: [], unparsedVisibleSourceCount: 1, unparsedVisibleSourceHints: [{ title: "request.md", kindLine: "Document" }] },
    });
    const args = ns({ out_dir: tmp });
    const result = patched("runCommand", fakeRun, () => pt.sourceListResult(args, pt.commonResult("project-source-list", args)));
    assert(result.ok === false, "list-unreliable: ok false");
    assert(result.status === "source-list-unreliable", "list-unreliable: status source-list-unreliable");
    assert(result.readbackVerified === false, "list-unreliable: readbackVerified false");
    assert(result.sourceListUnreliable === true, "list-unreliable: sourceListUnreliable true");
    assert(result.sourceListAuthority === "advisory-project-source-inventory-probe", "list-unreliable: sourceListAuthority");
    assert(result.sourceAbsenceAuthoritative === false, "list-unreliable: sourceAbsenceAuthoritative false");
    assert(result.canOverrideWorkerReadback === false, "list-unreliable: canOverrideWorkerReadback false");
  } finally {
    rmrf(tmp);
  }
}

function test_source_list_inner_log_uses_out_path_parent() {
  const tmp = mkdtemp("pt_list_outpath_");
  try {
    const outPath = path.join(tmp, "wrapper-result.json");
    const captured = [];
    const fakeRun = (cmd) => { captured.push(cmd); return { argv: cmd, returncode: 0, stdout: "", stderr: "", json: { ok: true, count: 0, sources: [] } }; };
    const args = ns({ out_path: outPath, out_dir: null });
    const result = patched("runCommand", fakeRun, () => pt.sourceListResult(args, pt.commonResult("project-source-list", args)));
    assert(result.status === "source-list-empty", "list-outpath: status source-list-empty");
    assert(captured[0].includes(path.join(tmp, "project-source-list.json")), "list-outpath: inner log uses out_path parent");
  } finally {
    rmrf(tmp);
  }
}

function test_source_put_inner_log_uses_out_path_parent() {
  const tmp = mkdtemp("pt_put_outpath_");
  try {
    const source = path.join(tmp, "REQUEST.md");
    fs.writeFileSync(source, "request\n");
    const outPath = path.join(tmp, "wrapper-result.json");
    const captured = [];
    const fakeRun = (cmd) => { captured.push(cmd); return { argv: cmd, returncode: 1, stdout: "", stderr: "project sources page did not load: href=about:blank", json: null }; };
    const args = ns({ file: source, out_path: outPath, out_dir: null, upload_mode: "auto" });
    const result = patched("runCommand", fakeRun, () => pt.sourcePutResult(args, pt.commonResult("project-source-put", args)));
    assert(result.ok === false, "put-outpath: ok false");
    assert(result.status === "source-page-not-loaded", "put-outpath: status source-page-not-loaded");
    assert(captured[0].includes(path.join(tmp, "project-source-put-REQUEST.md.json")), "put-outpath: inner log uses out_path parent");
  } finally {
    rmrf(tmp);
  }
}

async function test_env_default_ports_include_requested_port() {
  const captured = [];
  const fakeProbe = (addr, port) => { captured.push([addr, Number(port)]); return Promise.resolve({ ok: false, err: "closed" }); };
  const fakeWrite = () => 1;
  const args = ns({ port: 9226, ports: null, connect_timeout_sec: 0.01, project_url: null });
  await patchedMany({ tcpProbe: fakeProbe, maybeWriteOut: fakeWrite }, () => pt.handleEnv(args));
  const has = (p) => captured.some(([a, pt2]) => a === "127.0.0.1" && pt2 === p);
  assert(has(9222), "env-ports: probes 9222");
  assert(has(9223), "env-ports: probes 9223");
  assert(has(9224), "env-ports: probes 9224");
  assert(has(9226), "env-ports: probes requested 9226");
}

async function test_thread_create_inner_log_uses_out_path_parent() {
  const tmp = mkdtemp("pt_create_outpath_");
  try {
    const outPath = path.join(tmp, "wrapper-result.json");
    const captured = [];
    const results = [];
    const fakeRun = (cmd) => { captured.push(cmd); return { argv: cmd, returncode: 0, stdout: "", stderr: "", json: { ok: true, threadUrl: "https://chatgpt.com/g/g-p-test/c/thread", conversationId: "thread" } }; };
    const fakeWrite = (_args, result) => { results.push(result); return result.ok ? 0 : 1; };
    const args = ns({ out_path: outPath, out_dir: null, text: "read source", text_file: null });
    const rc = await patchedMany({ runCommand: fakeRun, maybeWriteOut: fakeWrite }, () => pt.handleThreadCreate(args));
    assert(rc === 0, "create-outpath: rc 0");
    assert(captured[0].includes(path.join(tmp, "project-thread-create.json")), "create-outpath: inner log uses out_path parent");
    assert(results[results.length - 1].createLog === path.join(tmp, "project-thread-create.json"), "create-outpath: createLog set");
  } finally {
    rmrf(tmp);
  }
}

async function test_thread_create_can_disable_dom_pro_requirement() {
  const captured = [];
  const results = [];
  const fakeRun = (cmd) => {
    captured.push(cmd);
    return { argv: cmd, returncode: 0, stdout: "", stderr: "", json: { ok: true, threadUrl: "https://chatgpt.com/g/g-p-test/c/thread", conversationId: "thread" } };
  };
  const fakeWrite = (_args, result) => { results.push(result); return result.ok ? 0 : 1; };
  const args = ns({ text: "read source", text_file: null, no_require_dom_pro: true });
  const rc = await patchedMany({ runCommand: fakeRun, maybeWriteOut: fakeWrite }, () => pt.handleThreadCreate(args));
  assert(rc === 0, "create-dom-pro: rc 0");
  assert(captured[0].includes("--noRequireDomPro"), "create-dom-pro: low-level command disables DOM Pro requirement");
  assert(results[results.length - 1].status === "thread-created", "create-dom-pro: thread-created");
}

async function test_thread_send_out_dir_uses_out_path_parent() {
  const tmp = mkdtemp("pt_send_outpath_");
  try {
    const outPath = path.join(tmp, "wrapper-result.json");
    const captured = [];
    const results = [];
    const fakeRun = (cmd) => { captured.push(cmd); return { argv: cmd, returncode: 0, stdout: "", stderr: "", json: { ok: true } }; };
    const fakeWrite = (_args, result) => { results.push(result); return result.ok ? 0 : 1; };
    const args = ns({ out_path: outPath, out_dir: null, url: "https://chatgpt.com/g/g-p-test/c/thread", text: "continue", text_file: null, max_inline_length: 2000 });
    const rc = await patchedMany({ runCommand: fakeRun, maybeWriteOut: fakeWrite }, () => pt.handleThreadSend(args));
    assert(rc === 0, "send-outpath: rc 0");
    assert(captured[0].includes(path.join(tmp, "send")), "send-outpath: send dir uses out_path parent");
    assert(results[results.length - 1].sendOutDir === path.join(tmp, "send"), "send-outpath: sendOutDir set");
  } finally {
    rmrf(tmp);
  }
}

function test_source_delete_inner_log_uses_out_path_parent() {
  const tmp = mkdtemp("pt_delete_outpath_");
  try {
    const outPath = path.join(tmp, "wrapper-result.json");
    const captured = [];
    const fakeRun = (cmd) => { captured.push(cmd); return { argv: cmd, returncode: 0, stdout: "", stderr: "", json: { ok: true, status: "source-deleted" } }; };
    const args = ns({ out_path: outPath, out_dir: null, title: "OLD.md", reason: "test cleanup", allow_remove: true });
    const result = patched("runCommand", fakeRun, () => pt.sourceDeleteResult(args, pt.commonResult("project-source-delete", args)));
    assert(result.ok === true, "delete-outpath: ok true");
    assert(captured[0].includes(path.join(tmp, "project-source-delete-OLD.md.json")), "delete-outpath: inner log uses out_path parent");
    assert(result.deleteLog === path.join(tmp, "project-source-delete-OLD.md.json"), "delete-outpath: deleteLog set");
  } finally {
    rmrf(tmp);
  }
}

async function test_artifact_fetch_out_dir_uses_out_path_parent() {
  const tmp = mkdtemp("pt_artifact_outpath_");
  try {
    const outPath = path.join(tmp, "wrapper-result.json");
    const captured = [];
    const results = [];
    const fakeRun = (cmd) => { captured.push(cmd); return { argv: cmd, returncode: 0, stdout: "", stderr: "", json: { name: "result.json", sha256: "abc", outPath: path.join(tmp, "result.json") } }; };
    const fakeWrite = (_args, result) => { results.push(result); return result.ok ? 0 : 1; };
    const args = ns({ out_path: outPath, out_dir: null, name: "result.json", url: "https://chatgpt.com/g/g-p-test/c/thread", ir_path: null });
    const rc = await patchedMany({ runCommand: fakeRun, maybeWriteOut: fakeWrite }, () => pt.handleArtifactFetch(args));
    assert(rc === 0, "artifact-outpath: rc 0");
    assert(captured[0].includes(tmp), "artifact-outpath: outDir uses out_path parent");
    assert(results[results.length - 1].outDir === tmp, "artifact-outpath: outDir set");
  } finally {
    rmrf(tmp);
  }
}

async function test_thread_readback_filters_to_assistant_hits() {
  const captured = [];
  const fakeWrite = (_args, result) => { captured.push(result); return result.ok ? 0 : 1; };
  const fakeRun = (cmd) => ({
    argv: cmd, returncode: 0, stdout: "", stderr: "",
    json: { isStreaming: false, hits: [{ marker: "MARK", role: "user", preview: "prompt MARK" }, { marker: "MARK", role: "assistant", preview: "MARK" }] },
  });
  const args = ns({ url: "https://chatgpt.com/g/g-p-test/c/thread", id: "target", markers: ["MARK"], marker_role: "assistant", wait_ms: 300000, tail: 5 });
  const rc = await patchedMany({ runCommand: fakeRun, maybeWriteOut: fakeWrite }, () => pt.handleThreadReadback(args));
  assert(rc === 0, "readback-filter: rc 0");
  const result = captured[captured.length - 1];
  assert(result.ok === true, "readback-filter: ok true");
  assert(result.status === "readback-verified", "readback-filter: status readback-verified");
  assert(JSON.stringify(result.matchedMarkers) === JSON.stringify(["MARK"]), "readback-filter: matchedMarkers [MARK]");
  assert(JSON.stringify(result.matchedHits.map((h) => h.role)) === JSON.stringify(["assistant"]), "readback-filter: matchedHits assistant-only");
}

async function test_thread_readback_rejects_user_only_and_streaming() {
  const captured = [];
  const fakeWrite = (_args, result) => { captured.push(result); return result.ok ? 0 : 1; };
  const userOnlyRun = (cmd) => ({ argv: cmd, returncode: 0, stdout: "", stderr: "", json: { isStreaming: false, hits: [{ marker: "MARK", role: "user" }] } });
  const args = ns({ url: "https://chatgpt.com/g/g-p-test/c/thread", id: "target", markers: ["MARK"], marker_role: "assistant", wait_ms: 300000, tail: 5 });
  let rc = await patchedMany({ runCommand: userOnlyRun, maybeWriteOut: fakeWrite }, () => pt.handleThreadReadback(args));
  assert(rc === 1, "readback-reject: user-only rc 1");
  assert(captured[captured.length - 1].status === "readback-missing-marker", "readback-reject: user-only status readback-missing-marker");
  assert(JSON.stringify(captured[captured.length - 1].missingMarkers) === JSON.stringify(["MARK"]), "readback-reject: user-only missingMarkers [MARK]");

  const streamingRun = (cmd) => ({ argv: cmd, returncode: 0, stdout: "", stderr: "", json: { isStreaming: true, hits: [{ marker: "MARK", role: "assistant" }] } });
  rc = await patchedMany({ runCommand: streamingRun, maybeWriteOut: fakeWrite }, () => pt.handleThreadReadback(args));
  assert(rc === 1, "readback-reject: streaming rc 1");
  assert(captured[captured.length - 1].status === "readback-still-streaming", "readback-reject: streaming status readback-still-streaming");
  assert(captured[captured.length - 1].readbackVerified === false, "readback-reject: streaming readbackVerified false");
}

function test_browser_parser_regression_terms_are_present() {
  const listingSrc = fs.readFileSync(path.join(HERE, "domain", "chatgpt", "project-source-listing.mjs"), "utf8");
  assert(listingSrc.includes("line === 'Document'"), "parser-terms: project-source-listing has Document kind line");
  assert(listingSrc.includes("line === 'Zip Archive'"), "parser-terms: project-source-listing has Zip Archive kind line");
  assert(listingSrc.includes("unparsedVisibleSourceHints"), "parser-terms: project-source-listing has unparsedVisibleSourceHints");
  assert(listingSrc.includes("unparsedVisibleSourceCount"), "parser-terms: project-source-listing has unparsedVisibleSourceCount");

  const readThreadSrc = fs.readFileSync(path.join(HERE, "read-thread.mjs"), "utf8");
  assert(readThreadSrc.includes("for (const m of msgs.filter((x) => x.text.includes(marker)))"), "parser-terms: read-thread has assistant marker-filter loop");
  assert(readThreadSrc.includes("streamWaitRounds"), "parser-terms: read-thread has streamWaitRounds");
}

function test_same_run_worker_readback_beats_env_and_list_probe_false_negatives() {
  const summary = pt.classifyTransportProofSteps([
    { command: "project-source-put", ok: true, readbackVerified: false },
    { command: "project-thread-create", ok: true, threadUrl: "https://chatgpt.com/g/g-p-test/c/abc" },
    { command: "project-thread-readback", ok: true, readbackVerified: true, markerRole: "assistant", matchedMarkers: ["READBACK_MARK_20260526_LIVE_REPROOF_A"] },
    { command: "project-transport-env", ok: false, status: "project-route-not-verified" },
    { command: "project-source-list", ok: true, status: "source-list-empty", sourceCount: 0 },
  ]);
  assert(summary.workerReadableProof === true, "proof: workerReadableProof true");
  assert(summary.workerReadableProofAuthority === "delayed-assistant-readback", "proof: authority delayed-assistant-readback");
  assert(summary.routeProbeCanOverrideWorkerReadback === false, "proof: routeProbeCanOverrideWorkerReadback false");
  assert(summary.sourceListCanOverrideWorkerReadback === false, "proof: sourceListCanOverrideWorkerReadback false");
}

async function main() {
  std.out.puts("=== project-transport regression suite (node port) ===\n");
  test_upload_command_selection();
  test_visible_upload_is_not_worker_readback();
  test_source_list_unreliable_is_not_success();
  test_source_list_inner_log_uses_out_path_parent();
  test_source_put_inner_log_uses_out_path_parent();
  await test_env_default_ports_include_requested_port();
  await test_thread_create_inner_log_uses_out_path_parent();
  await test_thread_create_can_disable_dom_pro_requirement();
  await test_thread_send_out_dir_uses_out_path_parent();
  test_source_delete_inner_log_uses_out_path_parent();
  await test_artifact_fetch_out_dir_uses_out_path_parent();
  await test_thread_readback_filters_to_assistant_hits();
  await test_thread_readback_rejects_user_only_and_streaming();
  test_browser_parser_regression_terms_are_present();
  test_same_run_worker_readback_beats_env_and_list_probe_false_negatives();

  // health command tests
  await test_health_all_checks_pass_readback_dominates();
  await test_health_readback_ok_doctor_env_fail_still_ok();
  await test_health_no_readback_source_list_dominates();
  await test_health_all_fail_no_positive_evidence();
  await test_health_dry_run_shows_planned_commands();
  await test_health_skips_source_list_without_project_url();
  await test_health_skips_readback_without_url_or_markers();
  await test_health_check_timeout_is_advisory();

  std.out.puts("\n=== Summary ===\n");
  std.out.puts(`Passed: ${passed}\n`);
  std.out.puts(`Failed: ${failed}\n`);
  if (failed > 0) std.exit(1);
}

await main();

// === health command tests ===

async function test_health_all_checks_pass_readback_dominates() {
  const results = [];
  const fakeRunAsync = (cmd) => {
    const sub = cmd.find((a, i) => i > 0 && ["doctor", "env", "source-list", "thread-readback"].includes(a));
    if (sub === "doctor") return Promise.resolve({ argv: cmd, returncode: 0, stdout: "", stderr: "", json: { ok: true, status: "doctor-ok", recommendedRoute: { port: 9222 } } });
    if (sub === "env") return Promise.resolve({ argv: cmd, returncode: 0, stdout: "", stderr: "", json: { ok: true, status: "cdp-port-reachable" } });
    if (sub === "source-list") return Promise.resolve({ argv: cmd, returncode: 0, stdout: "", stderr: "", json: { ok: true, status: "source-list-read", count: 1, sources: [{ title: "REQUEST.md" }] } });
    if (sub === "thread-readback") return Promise.resolve({ argv: cmd, returncode: 0, stdout: "", stderr: "", json: { ok: true, status: "readback-verified", readbackVerified: true, matchedMarkers: ["MARK"] } });
    return Promise.resolve({ argv: cmd, returncode: 1, stdout: "", stderr: "", json: null });
  };
  const fakeWrite = (_args, result) => { results.push(result); return result.ok ? 0 : 1; };
  const args = ns({
    project_url: "https://chatgpt.com/g/g-p-test/project",
    url: "https://chatgpt.com/g/g-p-test/c/thread",
    markers: ["MARK"], marker_role: "assistant", wait_ms: 30000, tail: 5,
    connect_timeout_sec: 0.25,
  });
  await patchedMany({ runCommandAsync: fakeRunAsync, maybeWriteOut: fakeWrite }, () => pt.handleHealth(args));
  const r = results[results.length - 1];
  assert(r.ok === true, "health-all-pass: ok true");
  assert(r.status === "health-readback-verified", "health-all-pass: status health-readback-verified");
  assert(r.dominantEvidence === "delayed-assistant-readback", "health-all-pass: dominantEvidence delayed-assistant-readback");
  assert(r.verificationLevel === "worker-readback", "health-all-pass: verificationLevel worker-readback");
  assert(r.workerReadableProof === true, "health-all-pass: workerReadableProof true");
  assert(r.falseNegativeGuard.allChecksAttemptedBeforeSummary === true, "health-all-pass: allChecksAttemptedBeforeSummary");
  assert(r.falseNegativeGuard.singleProbeTerminalBlocker === false, "health-all-pass: singleProbeTerminalBlocker false");
  assert(r.checks.length === 4, "health-all-pass: 4 checks ran");
  assert(r.advisoryNegativeChecks.length === 0, "health-all-pass: no advisory negatives");
}

async function test_health_readback_ok_doctor_env_fail_still_ok() {
  const results = [];
  const fakeRunAsync = (cmd) => {
    const sub = cmd.find((a, i) => i > 0 && ["doctor", "env", "source-list", "thread-readback"].includes(a));
    if (sub === "doctor") return Promise.resolve({ argv: cmd, returncode: 1, stdout: "", stderr: "", json: { ok: false, status: "no-cdp-port-reachable" } });
    if (sub === "env") return Promise.resolve({ argv: cmd, returncode: 1, stdout: "", stderr: "", json: { ok: false, status: "no-cdp-port-reachable" } });
    if (sub === "source-list") return Promise.resolve({ argv: cmd, returncode: 1, stdout: "", stderr: "", json: { ok: false, status: "source-page-not-loaded" } });
    if (sub === "thread-readback") return Promise.resolve({ argv: cmd, returncode: 0, stdout: "", stderr: "", json: { ok: true, status: "readback-verified", readbackVerified: true, matchedMarkers: ["MARK"] } });
    return Promise.resolve({ argv: cmd, returncode: 1, stdout: "", stderr: "", json: null });
  };
  const fakeWrite = (_args, result) => { results.push(result); return result.ok ? 0 : 1; };
  const args = ns({
    project_url: "https://chatgpt.com/g/g-p-test/project",
    url: "https://chatgpt.com/g/g-p-test/c/thread",
    markers: ["MARK"], marker_role: "assistant", wait_ms: 30000, tail: 5,
    connect_timeout_sec: 0.25,
  });
  await patchedMany({ runCommandAsync: fakeRunAsync, maybeWriteOut: fakeWrite }, () => pt.handleHealth(args));
  const r = results[results.length - 1];
  assert(r.ok === true, "health-false-neg-guard: ok true despite doctor/env/list fail");
  assert(r.status === "health-readback-verified", "health-false-neg-guard: status health-readback-verified");
  assert(r.workerReadableProof === true, "health-false-neg-guard: workerReadableProof true");
  assert(r.routeProbeCanOverrideWorkerReadback === false, "health-false-neg-guard: routeProbeCanOverrideWorkerReadback false");
  assert(r.sourceListCanOverrideWorkerReadback === false, "health-false-neg-guard: sourceListCanOverrideWorkerReadback false");
  assert(r.advisoryNegativeChecks.length === 3, "health-false-neg-guard: 3 advisory negatives");
  assert(r.falseNegativeGuard.failedChecksAreAdvisoryWhenHigherAuthorityPositive === true, "health-false-neg-guard: failedChecksAreAdvisoryWhenHigherAuthorityPositive");
}

async function test_health_no_readback_source_list_dominates() {
  const results = [];
  const fakeRunAsync = (cmd) => {
    const sub = cmd.find((a, i) => i > 0 && ["doctor", "env", "source-list", "thread-readback"].includes(a));
    if (sub === "doctor") return Promise.resolve({ argv: cmd, returncode: 0, stdout: "", stderr: "", json: { ok: true, status: "doctor-ok" } });
    if (sub === "env") return Promise.resolve({ argv: cmd, returncode: 0, stdout: "", stderr: "", json: { ok: true, status: "cdp-port-reachable" } });
    if (sub === "source-list") return Promise.resolve({ argv: cmd, returncode: 0, stdout: "", stderr: "", json: { ok: true, status: "source-list-read", count: 1 } });
    return Promise.resolve({ argv: cmd, returncode: 1, stdout: "", stderr: "", json: null });
  };
  const fakeWrite = (_args, result) => { results.push(result); return result.ok ? 0 : 1; };
  const args = ns({
    project_url: "https://chatgpt.com/g/g-p-test/project",
    url: null, markers: [], marker_role: "assistant", wait_ms: 30000, tail: 5,
    connect_timeout_sec: 0.25,
  });
  await patchedMany({ runCommandAsync: fakeRunAsync, maybeWriteOut: fakeWrite }, () => pt.handleHealth(args));
  const r = results[results.length - 1];
  assert(r.ok === true, "health-source-list-dom: ok true");
  assert(r.status === "health-source-list-read", "health-source-list-dom: status health-source-list-read");
  assert(r.dominantEvidence === "advisory-project-source-inventory-probe", "health-source-list-dom: dominantEvidence source-list");
  assert(r.verificationLevel === "source-inventory", "health-source-list-dom: verificationLevel source-inventory");
  assert(r.workerReadableProof === false, "health-source-list-dom: workerReadableProof false");
  assert(r.skippedChecks.length === 1, "health-source-list-dom: 1 skipped check (readback)");
  assert(r.skippedChecks[0].name === "thread-readback", "health-source-list-dom: skipped check is thread-readback");
}

async function test_health_all_fail_no_positive_evidence() {
  const results = [];
  const fakeRunAsync = (cmd) => {
    return Promise.resolve({ argv: cmd, returncode: 1, stdout: "", stderr: "fail", json: { ok: false, status: "check-failed" } });
  };
  const fakeWrite = (_args, result) => { results.push(result); return result.ok ? 0 : 1; };
  const args = ns({
    project_url: "https://chatgpt.com/g/g-p-test/project",
    url: "https://chatgpt.com/g/g-p-test/c/thread",
    markers: ["MARK"], marker_role: "assistant", wait_ms: 30000, tail: 5,
    connect_timeout_sec: 0.25,
  });
  await patchedMany({ runCommandAsync: fakeRunAsync, maybeWriteOut: fakeWrite }, () => pt.handleHealth(args));
  const r = results[results.length - 1];
  assert(r.ok === false, "health-all-fail: ok false");
  assert(r.status === "health-no-positive-evidence", "health-all-fail: status health-no-positive-evidence");
  assert(r.workerReadableProof === false, "health-all-fail: workerReadableProof false");
  assert(r.advisoryNegativeChecks.length === 4, "health-all-fail: 4 advisory negatives");
  assert(r.checks.length === 4, "health-all-fail: 4 checks attempted");
}

async function test_health_dry_run_shows_planned_commands() {
  const results = [];
  const fakeWrite = (_args, result) => { results.push(result); return result.ok ? 0 : 1; };
  const args = ns({
    project_url: "https://chatgpt.com/g/g-p-test/project",
    url: "https://chatgpt.com/g/g-p-test/c/thread",
    markers: ["MARK"], marker_role: "assistant", wait_ms: 30000, tail: 5,
    dry_run: true, connect_timeout_sec: 0.25,
  });
  await patchedMany({ maybeWriteOut: fakeWrite }, () => pt.handleHealth(args));
  const r = results[results.length - 1];
  assert(r.ok === true, "health-dry-run: ok true");
  assert(r.status === "health-dry-run-ready", "health-dry-run: status health-dry-run-ready");
  assert(r.plannedCommands.length === 4, "health-dry-run: 4 planned commands");
  const names = r.plannedCommands.map((c) => c.name);
  assert(names.includes("doctor"), "health-dry-run: plans doctor");
  assert(names.includes("env"), "health-dry-run: plans env");
  assert(names.includes("source-list"), "health-dry-run: plans source-list");
  assert(names.includes("thread-readback"), "health-dry-run: plans thread-readback");
  assert(r.executionModel === "parallel-independent-probes", "health-dry-run: executionModel parallel-independent-probes");
  assert(r.singleProbeTerminalBlocker === false, "health-dry-run: singleProbeTerminalBlocker false");
}

async function test_health_skips_source_list_without_project_url() {
  const results = [];
  const fakeRunAsync = (cmd) => {
    return Promise.resolve({ argv: cmd, returncode: 0, stdout: "", stderr: "", json: { ok: true, status: "check-ok" } });
  };
  const fakeWrite = (_args, result) => { results.push(result); return result.ok ? 0 : 1; };
  const args = ns({
    project_url: null,
    url: "https://chatgpt.com/g/g-p-test/c/thread",
    markers: ["MARK"], marker_role: "assistant", wait_ms: 30000, tail: 5,
    connect_timeout_sec: 0.25,
  });
  await patchedMany({ runCommandAsync: fakeRunAsync, maybeWriteOut: fakeWrite }, () => pt.handleHealth(args));
  const r = results[results.length - 1];
  assert(r.skippedChecks.some((s) => s.name === "source-list"), "health-skip-no-project-url: source-list skipped");
  assert(r.skippedChecks.find((s) => s.name === "source-list").status === "skipped-missing-project-url", "health-skip-no-project-url: correct skip reason");
  assert(r.checks.length === 3, "health-skip-no-project-url: only 3 checks ran");
}

async function test_health_skips_readback_without_url_or_markers() {
  const results = [];
  const fakeRunAsync = (cmd) => {
    return Promise.resolve({ argv: cmd, returncode: 0, stdout: "", stderr: "", json: { ok: true, status: "check-ok" } });
  };
  const fakeWrite = (_args, result) => { results.push(result); return result.ok ? 0 : 1; };
  const args = ns({
    project_url: "https://chatgpt.com/g/g-p-test/project",
    url: null, markers: [], marker_role: "assistant", wait_ms: 30000, tail: 5,
    connect_timeout_sec: 0.25,
  });
  await patchedMany({ runCommandAsync: fakeRunAsync, maybeWriteOut: fakeWrite }, () => pt.handleHealth(args));
  const r = results[results.length - 1];
  assert(r.skippedChecks.some((s) => s.name === "thread-readback"), "health-skip-no-thread: readback skipped");
  assert(r.skippedChecks.find((s) => s.name === "thread-readback").status === "skipped-missing-thread-url-or-markers", "health-skip-no-thread: correct skip reason");
}

async function test_health_check_timeout_is_advisory() {
  const results = [];
  const fakeRunAsync = (cmd) => {
    const sub = cmd.find((a, i) => i > 0 && ["doctor", "env", "source-list", "thread-readback"].includes(a));
    if (sub === "doctor") return Promise.resolve({ argv: cmd, returncode: 1, stdout: "", stderr: "", json: null, timedOut: true });
    if (sub === "env") return Promise.resolve({ argv: cmd, returncode: 0, stdout: "", stderr: "", json: { ok: true, status: "cdp-port-reachable" } });
    if (sub === "source-list") return Promise.resolve({ argv: cmd, returncode: 0, stdout: "", stderr: "", json: { ok: true, status: "source-list-read", count: 1 } });
    if (sub === "thread-readback") return Promise.resolve({ argv: cmd, returncode: 0, stdout: "", stderr: "", json: { ok: true, status: "readback-verified", readbackVerified: true } });
    return Promise.resolve({ argv: cmd, returncode: 1, stdout: "", stderr: "", json: null });
  };
  const fakeWrite = (_args, result) => { results.push(result); return result.ok ? 0 : 1; };
  const args = ns({
    project_url: "https://chatgpt.com/g/g-p-test/project",
    url: "https://chatgpt.com/g/g-p-test/c/thread",
    markers: ["MARK"], marker_role: "assistant", wait_ms: 30000, tail: 5,
    connect_timeout_sec: 0.25,
  });
  await patchedMany({ runCommandAsync: fakeRunAsync, maybeWriteOut: fakeWrite }, () => pt.handleHealth(args));
  const r = results[results.length - 1];
  assert(r.ok === true, "health-timeout-advisory: ok true despite doctor timeout");
  assert(r.status === "health-readback-verified", "health-timeout-advisory: readback still dominates");
  const doctorCheck = r.checks.find((c) => c.name === "doctor");
  assert(doctorCheck.status === "health-check-timeout", "health-timeout-advisory: doctor status is health-check-timeout");
  assert(r.advisoryNegativeChecks.some((c) => c.name === "doctor"), "health-timeout-advisory: doctor in advisory negatives");
}
