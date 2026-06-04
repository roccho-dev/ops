#!/usr/bin/env node
// 一回限りの import-path codemod。ファイル/ディレクトリ移設に伴う相対 import を
// 各ファイルの新位置から再計算して書換える(importer/target 両方の移動を考慮)。
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 移設定義(SRC からの相対)。ディレクトリは subpath を保持して移動。
const MOVES = {
  "connect.mjs": "core/connect.mjs",
  "fs.mjs": "core/io.mjs",
  "host-git-ops.mjs": "core/host-git.mjs",
  "session-flow.mjs": "domain/session-flow.mjs",
  "chatgpt": "domain/chatgpt",
};

function listMjs(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) { if (ent.name === "node_modules" || ent.name === ".git") continue; out.push(...listMjs(p)); }
    else if (ent.name.endsWith(".mjs")) out.push(p);
  }
  return out;
}

// oldAbs -> newAbs
function mappedAbs(oldAbs) {
  const rel = path.relative(SRC, oldAbs);
  for (const [from, to] of Object.entries(MOVES)) {
    if (rel === from) return path.join(SRC, to);
    if (rel.startsWith(from + path.sep)) return path.join(SRC, to, rel.slice(from.length + 1));
  }
  return oldAbs;
}

const files = listMjs(SRC);
const moveMap = new Map();
for (const f of files) { const nb = mappedAbs(f); if (nb !== f) moveMap.set(f, nb); }

let rewritten = 0, moved = 0;
for (const oldAbs of files) {
  const newAbs = moveMap.get(oldAbs) || oldAbs;
  let txt = fs.readFileSync(oldAbs, "utf8");
  txt = txt.replace(/(\bfrom\s+["'])([^"']+)(["'])/g, (m, pre, spec, post) => {
    if (!spec.startsWith(".")) return m;
    const targetOld = path.resolve(path.dirname(oldAbs), spec);
    const candidates = [targetOld, targetOld + ".mjs"];
    let targetNew = null, suffix = "";
    for (const c of candidates) {
      const mm = moveMap.get(c);
      if (mm) { targetNew = mm; suffix = c.endsWith(".mjs") && !spec.endsWith(".mjs") ? "" : ""; break; }
    }
    if (!targetNew) {
      // target 未移動。importer が移動した場合のみ path 再計算が要る。
      if (newAbs === oldAbs) return m;
      let rel = path.relative(path.dirname(newAbs), targetOld);
      if (!rel.startsWith(".")) rel = "./" + rel;
      return pre + rel + post;
    }
    let rel = path.relative(path.dirname(newAbs), targetNew);
    if (!rel.startsWith(".")) rel = "./" + rel;
    return pre + rel + post;
  });
  if (newAbs !== oldAbs) {
    fs.mkdirSync(path.dirname(newAbs), { recursive: true });
    fs.writeFileSync(newAbs, txt, "utf8");
    fs.rmSync(oldAbs);
    moved++;
  } else {
    fs.writeFileSync(oldAbs, txt, "utf8");
  }
  rewritten++;
}
// 空になった chatgpt/ 旧 dir 掃除
for (const d of ["chatgpt/policies", "chatgpt"]) { const p = path.join(SRC, d); try { if (fs.existsSync(p) && fs.readdirSync(p).length === 0) fs.rmdirSync(p); } catch { /* */ } }

process.stdout.write(`codemod: processed ${rewritten} files, moved ${moved}\n`);
