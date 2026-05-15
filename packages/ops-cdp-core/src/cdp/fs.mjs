import * as std from "qjs:std";
import * as os from "qjs:os";

function shellQuote(value) {
  return `'${String(value || "").replace(/'/g, `'"'"'`)}'`;
}

function closeStatus(file) {
  const status = Number(file.close()) || 0;
  return status > 255 ? (status >> 8) : status;
}

function runShellStatus(command) {
  const file = std.popen(command, "r");
  while (!file.eof()) {
    const line = file.getline();
    if (line === null) break;
  }
  return closeStatus(file);
}

export function joinPath(...parts) {
  let out = "";
  for (const part of parts) {
    const piece = String(part || "");
    if (!piece) continue;
    if (!out) {
      out = piece;
      continue;
    }
    if (out.endsWith("/")) out += piece.startsWith("/") ? piece.slice(1) : piece;
    else out += piece.startsWith("/") ? piece : "/" + piece;
  }
  return out;
}

export function escapeRegex(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildDownloadedNameRegex(name) {
  const s = String(name || "");
  const dot = s.lastIndexOf(".");
  const base = dot >= 0 ? s.slice(0, dot) : s;
  const ext = dot >= 0 ? s.slice(dot) : "";
  const pattern = "^" + escapeRegex(base) + "( \\([0-9]+\\))?" + escapeRegex(ext) + "$";
  return new RegExp(pattern);
}

export function osTuple(result, op) {
  if (Array.isArray(result) && result.length >= 2) {
    const value = result[0];
    const err = result[1];
    if (err && Number(err) !== 0) throw new Error(`${op} errno=${err}`);
    return value;
  }
  return result;
}

export function listDir(path) {
  const value = osTuple(os.readdir(path), `readdir(${path})`);
  if (!Array.isArray(value)) throw new Error(`unexpected readdir result for ${path}`);
  return value;
}

export function tryStat(path) {
  try {
    const value = osTuple(os.stat(path), `stat(${path})`);
    if (!value || typeof value !== "object") return null;
    return value;
  } catch {
    return null;
  }
}

export function mkdirp(path) {
  const target = String(path || "");
  if (!target || target === ".") return;
  const rc = runShellStatus(`mkdir -p ${shellQuote(target)} >/dev/null 2>&1`);
  if (rc !== 0) throw new Error(`mkdir -p failed rc=${rc}: ${target}`);
}

export function listMatchingFiles(dir, regex) {
  const out = [];
  for (const name of listDir(dir)) {
    if (!name || name === "." || name === "..") continue;
    if (!regex.test(name)) continue;
    const path = joinPath(dir, name);
    const stat = tryStat(path);
    if (!stat) continue;
    out.push({
      name,
      path,
      size: Number(stat.size) || 0,
      mtime: Number(stat.mtime) || 0,
    });
  }
  out.sort((a, b) => (b.mtime - a.mtime) || (b.size - a.size));
  return out;
}

export function copyFile(src, dest) {
  const rc = runShellStatus(`cp -f ${shellQuote(src)} ${shellQuote(dest)} >/dev/null 2>&1`);
  if (rc !== 0) throw new Error(`cp failed rc=${rc}: ${src} -> ${dest}`);
}

export function moveFile(src, dest) {
  const rc = os.rename(src, dest);
  if (rc === 0) return;
  copyFile(src, dest);
  os.remove(src);
}
