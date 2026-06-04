// qjs:std -> node 互換 shim。
// 破壊的ユースケース対応: DC-M-02/DC-S-10(同期 stdout で順序保証・truncation 防止),
// DC-S-09(utf8 明示), DC-M-13(popen は shell 経由で 2>&1 等を保持)。
import * as fs from "node:fs";
import { execSync } from "node:child_process";

function fmt(format, args) {
  let i = 0;
  return String(format).replace(/%[sdjoO%]/g, (m) => {
    if (m === "%%") return "%";
    const a = args[i++];
    if (m === "%d") return String(Number(a));
    if (m === "%j" || m === "%o" || m === "%O") return JSON.stringify(a);
    return String(a);
  });
}

function mkFile(fd) {
  return {
    puts(s) { fs.writeSync(fd, String(s)); },       // qjs と同じく同期書き込み
    printf(format, ...args) { fs.writeSync(fd, fmt(format, args)); },
    write(buf, pos, len) { fs.writeSync(fd, buf, pos ?? 0, len ?? (buf.length - (pos ?? 0))); },
    flush() {},
    close() {},
  };
}

export const out = mkFile(1);
export const err = mkFile(2);
export const in_ = { getline() { return null; } };

export function loadFile(path) {
  try { return fs.readFileSync(path, "utf8"); } catch { return null; }
}

export function writeFile(path, data) {
  fs.writeFileSync(path, data, "utf8");
  return 0;
}

// qjs FILE 相当のバッファ読み出し器(getline/readAsString/eof/close)。
function makeReader(buf, status) {
  let lines = null, idx = 0, done = false;
  return {
    readAsString() { done = true; return buf; },
    getline() {
      if (lines === null) lines = buf.length ? buf.split("\n") : [];
      if (idx < lines.length) {
        if (idx === lines.length - 1 && lines[idx] === "") { idx++; done = true; return null; }
        return lines[idx++];
      }
      done = true;
      return null;
    },
    eof() { return done; },
    error() { return 0; },
    flush() {},
    close() { return status; },
  };
}

export function open(path, flags) {
  // 最小実装: 読み取り("r")用途のみ想定。書き込みは writeFile を使う前提。
  const data = loadFile(path);
  return makeReader(data ?? "", 0);
}

export function getenv(name) {
  return Object.prototype.hasOwnProperty.call(process.env, name) ? process.env[name] : undefined;
}

export function setenv(name, value) { process.env[name] = String(value); }

export function exit(code) { process.exit(code ?? 0); }

export function printf(format, ...args) { fs.writeSync(1, fmt(format, args)); }

export function popen(command, mode) {
  // mode "r": shell でコマンド実行し stdout を捕捉(qjs popen 相当)。
  let buf = "", status = 0;
  try {
    buf = execSync(command, { shell: "/bin/sh", encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  } catch (e) {
    buf = e.stdout != null ? String(e.stdout) : "";
    status = typeof e.status === "number" ? e.status : 1;
  }
  return makeReader(buf, status);
}

export const Error = { EINVAL: 22, EIO: 5, ENOENT: 2 };

export default {
  out, err, in: in_, loadFile, writeFile, open, getenv, setenv, exit, printf, popen, Error,
};
