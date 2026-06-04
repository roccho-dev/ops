// core/proc: シェル実行 + 同期 sleep。ドメイン知識ゼロ。
import * as std from "../qjs-compat/std.mjs";
import * as os from "../qjs-compat/os.mjs";

let nextTmpId = 0;

function tmpPath(prefix) {
  nextTmpId += 1;
  return `/tmp/${prefix}_${os.getpid()}_${Date.now()}_${nextTmpId}`;
}

function popenStatus(file) {
  const status = Number(file.close()) || 0;
  return status > 255 ? (status >> 8) : status;
}

function shellQuote(value) {
  const s = String(value);
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

export function shToString(command) {
  const pipe = std.popen(String(command || ""), "r");
  let out = "";
  while (!pipe.eof()) {
    const line = pipe.getline();
    if (line === null) break;
    out += line + "\n";
  }
  const rc = popenStatus(pipe);
  if (rc !== 0) throw new Error(`command failed rc=${rc}: ${String(command || "")}`);
  return out;
}

export function runToString(argv, stdinText) {
  if (!Array.isArray(argv)) return shToString(argv);

  const errPath = tmpPath("cdp_err") + ".txt";
  let inputPath = null;

  try {
    let command = argv.map(shellQuote).join(" ") + ` 2>${shellQuote(errPath)}`;
    if (stdinText !== undefined && stdinText !== null) {
      inputPath = tmpPath("cdp_in") + ".txt";
      std.writeFile(inputPath, String(stdinText));
      command += ` <${shellQuote(inputPath)}`;
    }

    const pipe = std.popen(command, "r");
    let out = "";
    while (!pipe.eof()) {
      const line = pipe.getline();
      if (line === null) break;
      out += line + "\n";
    }
    const rc = popenStatus(pipe);
    if (rc !== 0) {
      const errText = std.loadFile(errPath) || "";
      const suffix = errText ? `: ${String(errText).slice(0, 500)}` : "";
      throw new Error(`command failed rc=${rc}: ${argv.map(String).join(" ")}${suffix}`);
    }
    return out;
  } finally {
    if (errPath) { try { os.remove(errPath); } catch {} }
    if (inputPath) { try { os.remove(inputPath); } catch {} }
  }
}

export function sleepMs(ms) {
  if (ms <= 0) return;
  os.sleep(ms);
}
