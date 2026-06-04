import * as std from "./qjs-compat/std.mjs";

import { parseArgs, run } from "./lib.mjs";
import { fileSize, nowIso, pathExists, readJson, writeJson } from "./core/host-git.mjs";
import { mkdirp } from "./core/io.mjs";

const KIND = "cdp.threadLedger.v1";

function usage() {
  std.err.puts([
    "usage: qjs --std -m chromium-cdp-thread-ledger.mjs <command> [options]",
    "",
    "commands:",
    "  init --ledger <path> --owner <actor> [--task <name>] [--json]",
    "  register --ledger <path> --owner <actor> --index <n> --role <role> --url <url> [--title <title>] [--json]",
    "  interaction --ledger <path> --thread <actor> --kind <kind> [--summary <text>] [--promptPath <path>] [--chars <n>] [--artifact <name>]... [--ok|--ng] [--json]",
    "  summary --ledger <path> [--json]",
    "",
  ].join("\n") + "\n");
  std.err.flush();
}

function dirname(path) {
  const s = String(path || "");
  const i = s.lastIndexOf("/");
  return i > 0 ? s.slice(0, i) : ".";
}

function threadActor(owner, index) {
  return `${owner}/thread/${index}`;
}

function newLedger(path, owner, task) {
  return {
    kind: KIND,
    ledger: path,
    owner: owner || null,
    task: task || null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    threads: [],
    interactions: [],
  };
}

function loadLedger(path, owner, task) {
  if (!pathExists(path)) return newLedger(path, owner, task);
  const ledger = readJson(path);
  if (!ledger || ledger.kind !== KIND) throw new Error(`invalid thread ledger: ${path}`);
  return ledger;
}

function saveLedger(path, ledger) {
  mkdirp(dirname(path));
  ledger.updatedAt = nowIso();
  writeJson(path, ledger);
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

function print(value, json) {
  if (json) std.out.puts(JSON.stringify(value, null, 2) + "\n");
  else {
    std.out.puts(`ok=${value.ok ? "true" : "false"}\n`);
    if (value.ledger) std.out.puts(`ledger=${value.ledger}\n`);
    if (value.actor) std.out.puts(`actor=${value.actor}\n`);
  }
  std.out.flush();
}

function ensureThread(ledger, actor) {
  const found = ledger.threads.find((t) => String(t.actor) === String(actor));
  if (!found) throw new Error(`thread not registered: ${actor}`);
  return found;
}

function commandInit(argv) {
  const args = parseCommon(argv, {
    ledger: null,
    owner: null,
    task: null,
    json: false,
  }, {
    ledger: { required: true },
    owner: { required: true },
    task: {},
    json: { type: "boolean" },
  });
  if (!args) return null;
  const ledger = loadLedger(args.ledger, args.owner, args.task);
  ledger.owner = args.owner;
  if (args.task) ledger.task = args.task;
  saveLedger(args.ledger, ledger);
  print({ ok: true, ledger: args.ledger, owner: ledger.owner, task: ledger.task }, args.json);
  return 0;
}

function commandRegister(argv) {
  const args = parseCommon(argv, {
    ledger: null,
    owner: null,
    index: null,
    role: null,
    url: null,
    title: null,
    json: false,
  }, {
    ledger: { required: true },
    owner: { required: true },
    index: { type: "number", required: true },
    role: { required: true },
    url: { required: true },
    title: {},
    json: { type: "boolean" },
  });
  if (!args) return null;
  const ledger = loadLedger(args.ledger, args.owner, null);
  ledger.owner = ledger.owner || args.owner;
  const actor = threadActor(args.owner, args.index);
  const existing = ledger.threads.find((t) => String(t.actor) === actor);
  const row = {
    actor,
    owner: args.owner,
    index: args.index,
    role: args.role,
    url: args.url,
    title: args.title || null,
    updatedAt: nowIso(),
  };
  if (existing) Object.assign(existing, row);
  else {
    row.createdAt = nowIso();
    ledger.threads.push(row);
  }
  saveLedger(args.ledger, ledger);
  print({ ok: true, ledger: args.ledger, actor, thread: row }, args.json);
  return 0;
}

function commandInteraction(argv) {
  const args = parseCommon(argv, {
    ledger: null,
    thread: null,
    kind: null,
    summary: null,
    promptPath: null,
    chars: null,
    artifact: [],
    ok: null,
    json: false,
  }, {
    ledger: { required: true },
    thread: { required: true },
    kind: { required: true },
    summary: {},
    promptPath: {},
    chars: { type: "number" },
    artifact: { multiple: true },
    ok: { type: "boolean", set: (out) => { out.ok = true; } },
    ng: { type: "boolean", set: (out) => { out.ok = false; } },
    json: { type: "boolean" },
  });
  if (!args) return null;
  const ledger = loadLedger(args.ledger, null, null);
  ensureThread(ledger, args.thread);
  let promptChars = args.chars === null || args.chars === undefined ? null : Number(args.chars);
  let promptBytes = null;
  if (args.promptPath) {
    const text = String(std.loadFile(args.promptPath) || "");
    promptChars = text.length;
    promptBytes = fileSize(args.promptPath);
  }
  const row = {
    id: ledger.interactions.length + 1,
    at: nowIso(),
    thread: args.thread,
    kind: args.kind,
    summary: args.summary || null,
    promptPath: args.promptPath || null,
    promptChars,
    promptBytes,
    artifacts: args.artifact.slice(),
    ok: args.ok,
  };
  ledger.interactions.push(row);
  saveLedger(args.ledger, ledger);
  print({ ok: true, ledger: args.ledger, actor: args.thread, interaction: row }, args.json);
  return 0;
}

function summarize(ledger) {
  const byThread = {};
  for (const thread of ledger.threads) {
    byThread[thread.actor] = {
      actor: thread.actor,
      role: thread.role,
      url: thread.url,
      interactions: 0,
      prompts: 0,
      reports: 0,
      responses: 0,
      retries: 0,
      artifacts: 0,
      promptChars: 0,
      failedEvents: 0,
    };
  }
  for (const row of ledger.interactions) {
    if (!byThread[row.thread]) {
      byThread[row.thread] = {
        actor: row.thread,
        role: "unknown",
        url: null,
        interactions: 0,
        prompts: 0,
        reports: 0,
        responses: 0,
        retries: 0,
        artifacts: 0,
        promptChars: 0,
        failedEvents: 0,
      };
    }
    const s = byThread[row.thread];
    s.interactions += 1;
    if (row.kind === "prompt") s.prompts += 1;
    if (row.kind === "report") s.reports += 1;
    if (row.kind === "response") s.responses += 1;
    if (row.kind === "retry") s.retries += 1;
    s.artifacts += Array.isArray(row.artifacts) ? row.artifacts.length : 0;
    s.promptChars += Number(row.promptChars || 0);
    if (row.ok === false) s.failedEvents += 1;
  }
  return {
    owner: ledger.owner,
    task: ledger.task,
    threadCount: ledger.threads.length,
    interactionCount: ledger.interactions.length,
    promptCount: ledger.interactions.filter((row) => row.kind === "prompt").length,
    reportCount: ledger.interactions.filter((row) => row.kind === "report").length,
    responseCount: ledger.interactions.filter((row) => row.kind === "response").length,
    retryCount: ledger.interactions.filter((row) => row.kind === "retry").length,
    promptChars: ledger.interactions.reduce((sum, row) => sum + Number(row.promptChars || 0), 0),
    threads: Object.values(byThread),
  };
}

function commandSummary(argv) {
  const args = parseCommon(argv, {
    ledger: null,
    json: false,
  }, {
    ledger: { required: true },
    json: { type: "boolean" },
  });
  if (!args) return null;
  const ledger = loadLedger(args.ledger, null, null);
  const summary = summarize(ledger);
  if (args.json) print({ ok: true, ledger: args.ledger, summary }, true);
  else {
    std.out.puts(`owner=${summary.owner}\n`);
    std.out.puts(`threads=${summary.threadCount}\n`);
    std.out.puts(`interactions=${summary.interactionCount}\n`);
    std.out.puts(`prompts=${summary.promptCount}\n`);
    std.out.puts(`reports=${summary.reportCount}\n`);
    std.out.puts(`responses=${summary.responseCount}\n`);
    std.out.puts(`retries=${summary.retryCount}\n`);
    std.out.puts(`promptChars=${summary.promptChars}\n`);
  }
  return 0;
}

function main(argv) {
  const all = Array.prototype.slice.call(argv || []);
  const first = String(all[0] || "");
  const raw = (first.endsWith(".mjs") || first.indexOf("/") >= 0) ? all.slice(1) : all;
  const cmd = raw[0] || "";
  const rest = ["chromium-cdp-thread-ledger.mjs", ...raw.slice(1)];
  const commandRc = (rc) => (rc === null || rc === undefined ? 2 : rc);
  if (!cmd || cmd === "-h" || cmd === "--help") {
    usage();
    return 2;
  }
  if (cmd === "init") return commandRc(commandInit(rest));
  if (cmd === "register") return commandRc(commandRegister(rest));
  if (cmd === "interaction") return commandRc(commandInteraction(rest));
  if (cmd === "summary") return commandRc(commandSummary(rest));
  throw new Error(`unknown command: ${cmd}`);
}

run(scriptArgs, { usage, main });
