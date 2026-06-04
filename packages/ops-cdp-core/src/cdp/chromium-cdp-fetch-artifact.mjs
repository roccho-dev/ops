import * as os from "./qjs-compat/os.mjs";
import * as std from "./qjs-compat/std.mjs";
import { getDefaultAddr, getDefaultPort, parseArgs, run, runToString } from "./lib.mjs";
import { requireRecommendedSession } from "./domain/session-flow.mjs";
import { openOrCreateChatGptTarget } from "./domain/chatgpt/index.mjs";
import { requireCdp } from "./core/connect.mjs";

function getScriptModulePath(name) {
  const root = String(std.getenv("HQ_CDP_SCRIPT_SRC") || "");
  if (root) return `${root}/${name}`;
  return `parts/cdp/${name}`;
}

function getQjsExe() {
  return String(std.getenv("HQ_CDP_QJS") || "qjs");
}

function usage() {
  std.err.puts("usage: qjs --std -m chromium-cdp-fetch-artifact.mjs --name <artifact> --outDir <dir> [--url <chatgpt-thread-url> | --irPath <path>] [--downloadsDir <dir>] [--addr 127.0.0.1] [--port <n>] [--json]\n");
  std.err.flush();
}

function buildArgs(argv) {
  return parseArgs(argv, {
    defaults: { url: null, irPath: null, name: null, outDir: null, downloadsDir: null, addr: getDefaultAddr(), port: null, json: false },
    flags: {
      url: {},
      irPath: {},
      name: { required: true },
      outDir: { required: true },
      downloadsDir: {},
      addr: {},
      port: { parse: (raw, current) => Number(raw) || current },
      json: { type: "boolean" },
    },
    onError: "null",
    reportError: true,
    finalize: (out) => (out.url || out.irPath) ? out : null,
  });
}

function ensureIr(args) {
  if (args.irPath) return args.irPath;
  const conn = args.port ? requireCdp(args.addr, args.port) : requireRecommendedSession({ addr: args.addr, app: "chatgpt" });
  const opened = openOrCreateChatGptTarget(conn, args.url, { purpose: "fetch-artifact" });
  const irPath = `/tmp/cdp_thread_ir_${os.getpid()}_${Date.now()}.json`;
  runToString([
    getQjsExe(), "--std", "-m", getScriptModulePath("read-thread.mjs"),
    "--url", String(opened.finalUrl || args.url),
    "--irPath", irPath,
    "--addr", opened.addr,
    "--port", String(opened.port),
  ]);
  return irPath;
}

function main(args) {
  const irPath = ensureIr(args);
  const cmd = [
    getQjsExe(), "--std", "-m", getScriptModulePath("download-chatgpt-artifacts.mjs"),
    "--outDir", String(args.outDir),
    "--irPath", irPath,
    "--preferIr",
    "--maxAgeSec", "3600",
    "--name", String(args.name),
    "--addr", String(args.addr),
    "--port", String(args.port || getDefaultPort()),
  ];
  if (args.downloadsDir) cmd.push("--downloadsDir", String(args.downloadsDir));
  if (args.json) cmd.push("--stats");
  const out = runToString(cmd);
  std.out.puts(out);
  return 0;
}

run(scriptArgs, { usage, buildArgs, main });
