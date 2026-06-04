import * as os from "./qjs-compat/os.mjs";
import * as std from "./qjs-compat/std.mjs";

import { getDefaultAddr, getDefaultPort, parseArgs, run, runToString, sleepMs } from "./lib.mjs";
import { assertProjectThreadUrlMatchesProject, extractProjectId } from "./domain/chatgpt/index.mjs";

function getScriptModulePath(name) {
  const root = String(std.getenv("HQ_CDP_SCRIPT_SRC") || "");
  return root ? `${root}/${name}` : `parts/cdp/${name}`;
}

function getQjsExe() {
  return String(std.getenv("HQ_CDP_QJS") || "qjs");
}

function usage() {
  std.err.puts(
    "usage: qjs --std -m chromium-cdp-project-source-reread.mjs --projectUrl <.../project> --url <project-thread-url> [--url <project-thread-url> ...] [--urlsFile <path>] [--manifest SOURCE_MANIFEST.json] [--epoch <n>] [--baseRev <rev>] [--message <text>] [--intervalMs 15000] [--dryRun] [--addr 127.0.0.1] [--port <n>] [--json]\n",
  );
  std.err.flush();
}

function buildArgs(argv) {
  return parseArgs(argv, {
    defaults: {
      projectUrl: null,
      urls: [],
      urlsFile: null,
      manifest: "SOURCE_MANIFEST.json",
      epoch: null,
      baseRev: null,
      message: null,
      intervalMs: 15000,
      waitMs: 1000,
      dryRun: false,
      addr: getDefaultAddr(),
      port: getDefaultPort(),
      json: false,
    },
    flags: {
      projectUrl: { names: ["--projectUrl", "--project-url"] },
      urls: { names: ["--url"], multiple: true },
      urlsFile: {},
      manifest: {},
      epoch: {},
      baseRev: {},
      message: {},
      intervalMs: { type: "number" },
      waitMs: { type: "number" },
      dryRun: { type: "boolean" },
      addr: {},
      port: { parse: (raw, current) => Number(raw) || current },
      json: { type: "boolean" },
    },
    onError: "null",
    reportError: true,
    finalize: (out) => {
      if (out.urlsFile) {
        const body = String(std.loadFile(out.urlsFile) || "");
        out.urls.push(...body.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
      }
      return out.projectUrl && out.urls.length > 0 ? out : null;
    },
  });
}

function buildMessage(args) {
  if (args.message) return args.message;
  const lines = [
    "Project Sources を必ず読み直してください。",
    "過去回答やキャッシュに頼らず、現在のProject Sourcesから確認してください。",
    `対象manifest exact filename: ${args.manifest}`,
    "似た名前のmanifestや旧epochのsourceは無視してください。",
  ];
  if (args.epoch) lines.push(`期待epoch: ${args.epoch}`);
  if (args.baseRev) lines.push(`期待baseRev: ${args.baseRev}`);
  lines.push("読み直した結果として、manifestのepochとbaseRevだけを最初に返してください。");
  return lines.join("\n");
}

function main(args) {
  const projectId = extractProjectId(args.projectUrl);
  if (!projectId) throw new Error("--projectUrl must be a ChatGPT Project URL");
  const urlChecks = args.urls.map((url, i) => assertProjectThreadUrlMatchesProject(url, args.projectUrl, `--url[${i}]`));
  const message = buildMessage(args);
  const sent = [];
  for (let i = 0; i < args.urls.length; i++) {
    const url = args.urls[i];
    if (args.dryRun) {
      sent.push({ url, ok: true, dryRun: true, message });
    } else {
      const path = `/tmp/cdp-reread-${os.getpid()}-${i}.txt`;
      std.writeFile(path, message);
      try {
        const out = runToString([
          getQjsExe(), "--std", "-m", getScriptModulePath("send-chatgpt.mjs"),
          "--url", url,
          "--projectUrl", String(args.projectUrl),
          "--text-file", path,
          "--addr", String(args.addr),
          "--port", String(args.port),
          "--wait-ms", String(args.waitMs),
        ]);
        sent.push({ url, ok: true, output: out.trim() });
      } finally {
        try { os.remove(path); } catch {}
      }
    }
    if (i + 1 < args.urls.length && args.intervalMs > 0) sleepMs(args.intervalMs);
  }
  const result = { ok: sent.every((row) => row.ok), projectUrl: args.projectUrl, projectId, urlChecks, count: sent.length, message, sent };
  if (args.json) std.out.puts(JSON.stringify(result, null, 2) + "\n");
  else std.out.puts(`sent=${sent.length}\n`);
  return result.ok ? 0 : 1;
}

run(scriptArgs, { usage, buildArgs, main });
