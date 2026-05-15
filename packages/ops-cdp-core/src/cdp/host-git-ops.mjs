import * as os from "qjs:os";
import * as std from "qjs:std";

import { buildDownloadedNameRegex, listMatchingFiles, mkdirp, moveFile } from "./fs.mjs";

export function shellQuote(value) {
  return `'${String(value || "").replace(/'/g, `'"'"'`)}'`;
}

function closeStatus(file) {
  const status = Number(file.close()) || 0;
  return status > 255 ? (status >> 8) : status;
}

export function runCapture(argv, opts) {
  const o = opts || {};
  const command = Array.isArray(argv)
    ? argv.map((part) => shellQuote(part)).join(" ")
    : String(argv || "");
  const cwd = o.cwd ? `cd ${shellQuote(o.cwd)} && ` : "";
  const pipe = std.popen(`${cwd}${command} 2>&1`, "r");
  let out = "";
  while (!pipe.eof()) {
    const line = pipe.getline();
    if (line === null) break;
    out += line + "\n";
  }
  const rc = closeStatus(pipe);
  if (o.check !== false && rc !== 0) {
    throw new Error(`command failed rc=${rc}: ${command}\n${out}`);
  }
  return { rc, out };
}

export function commandExists(name) {
  return runCapture(`command -v ${shellQuote(name)}`, { check: false }).rc === 0;
}

export function fileSha256(path) {
  return runCapture(["sha256sum", path]).out.trim().split(/\s+/)[0] || "";
}

export function fileSize(path) {
  const st = os.stat(path);
  const value = Array.isArray(st) ? st[0] : st;
  if (!value || (Array.isArray(st) && st[1])) throw new Error(`stat failed: ${path}`);
  return Number(value && value.size) || 0;
}

export function readJson(path) {
  return JSON.parse(String(std.loadFile(path) || ""));
}

export function writeJson(path, value) {
  std.writeFile(path, JSON.stringify(value, null, 2) + "\n");
}

export function nowIso() {
  return new Date().toISOString();
}

export function basename(path) {
  const s = String(path || "");
  const i = s.lastIndexOf("/");
  return i >= 0 ? s.slice(i + 1) : s;
}

export function quarantineDownloadNames(downloadsDir, archiveDir, names) {
  mkdirp(archiveDir);
  const moved = [];
  for (const name of names) {
    const rx = buildDownloadedNameRegex(name);
    for (const row of listMatchingFiles(downloadsDir, rx)) {
      const dest = `${archiveDir}/${Date.now()}-${row.name}`;
      moveFile(row.path, dest);
      moved.push({ name: row.name, from: row.path, to: dest, bytes: row.size });
    }
  }
  return moved;
}

export function git(repo, args, opts) {
  return runCapture(["git", "-C", repo, ...args], opts);
}

export function gitRevParse(repo, rev) {
  return git(repo, ["rev-parse", rev || "HEAD"]).out.trim();
}

export function ensureGitInfoExclude(repo, pattern) {
  const common = git(repo, ["rev-parse", "--git-common-dir"]).out.trim();
  const gitDir = common.startsWith("/") ? common : `${repo}/${common}`;
  const infoDir = `${gitDir}/info`;
  const excludePath = `${infoDir}/exclude`;
  mkdirp(infoDir);
  let content = "";
  try { content = String(std.loadFile(excludePath) || ""); } catch {}
  const lines = content.split(/\r?\n/).map((line) => line.trim());
  if (lines.indexOf(String(pattern)) >= 0) return;
  const prefix = content && !content.endsWith("\n") ? "\n" : "";
  std.writeFile(excludePath, content + prefix + String(pattern) + "\n");
}

export function pathExists(path) {
  try {
    const st = os.stat(path);
    if (Array.isArray(st)) return !!st[0] && !st[1];
    return !!st;
  } catch {
    return false;
  }
}

export function ensureCleanGitWorktree(path) {
  const status = git(path, ["status", "--short"]).out.trim();
  if (status) throw new Error(`git worktree is dirty: ${path}\n${status}`);
}
