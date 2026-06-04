// qjs:os -> node 互換 shim。
// qjs os.* は [result, errno] タプル or errno を返す慣習。node fs は throw するため変換する。
import * as fs from "node:fs";

export function getpid() { return process.pid; }

export function now() { return Date.now(); }

export function sleep(delayMs) {
  // 同期 sleep(qjs os.sleep 相当)。Atomics.wait で busy しない待機。
  const sab = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(sab, 0, 0, Math.max(0, Number(delayMs) || 0));
  return 0;
}

export function remove(path) {
  try { fs.rmSync(path, { force: false }); return 0; }
  catch (e) { return -(e.errno ? Math.abs(e.errno) : 2); }
}

export function mkdir(path, mode) {
  try { fs.mkdirSync(path, { mode: mode ?? 0o777 }); return 0; }
  catch (e) { return -(e.errno ? Math.abs(e.errno) : 2); }
}

export function rename(oldPath, newPath) {
  try { fs.renameSync(oldPath, newPath); return 0; }
  catch (e) { return -(e.errno ? Math.abs(e.errno) : 2); }
}

export function stat(path) {
  try {
    const s = fs.statSync(path);
    return [
      {
        dev: s.dev, ino: s.ino, mode: s.mode, nlink: s.nlink,
        uid: s.uid, gid: s.gid, rdev: s.rdev, size: s.size,
        blocks: s.blocks,
        atime: s.atimeMs, mtime: s.mtimeMs, ctime: s.ctimeMs,
      },
      0,
    ];
  } catch (e) { return [null, e.errno ? Math.abs(e.errno) : 2]; }
}

export function lstat(path) {
  try {
    const s = fs.lstatSync(path);
    return [{ mode: s.mode, size: s.size, mtime: s.mtimeMs }, 0];
  } catch (e) { return [null, e.errno ? Math.abs(e.errno) : 2]; }
}

export function readdir(path) {
  try { return [fs.readdirSync(path), 0]; }
  catch (e) { return [[], e.errno ? Math.abs(e.errno) : 2]; }
}

export function realpath(path) {
  try { return [fs.realpathSync(path), 0]; }
  catch (e) { return ["", e.errno ? Math.abs(e.errno) : 2]; }
}

// qjs os 定数(一部コードが参照しうる)
export const O_RDONLY = 0, O_WRONLY = 1, O_RDWR = 2, O_CREAT = 0o100, O_TRUNC = 0o1000;

export default {
  getpid, now, sleep, remove, mkdir, rename, stat, lstat, readdir, realpath,
  O_RDONLY, O_WRONLY, O_RDWR, O_CREAT, O_TRUNC,
};
