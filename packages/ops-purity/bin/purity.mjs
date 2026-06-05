#!/usr/bin/env node
// repo-wide node-only purity check (completion-spec gate #5, DC-S-11 / DC-M-08).
//
// 与えられた root 配下の packages/** logic 層をスキャンし、非 node runtime の痕跡を
// 1 件でも見つけたら fail(exit 1, offender を列挙)する。clean なら exit 0。
//
// 検出対象(LOGIC 層):
//   - *.py / *.pyc ソース(__pycache__ 配下含む)
//   - __pycache__ ディレクトリそのもの
//   - *.zig ソース
//   - *.mjs 内の実 `from "qjs:..."` import
//   - *.mjs / *.sh 内の shell `python3` / `qjs` 起動(spawn / exec / 直接コマンド)
//
// 検出対象外(builder / glue / docs — purity は runtime/logic 層が対象):
//   - flake.nix の nix builder shell(DC-M-08 境界: nix builder は許容)
//   - docs/ ディレクトリ・*.md
//   - node_modules / .git
//   - ops-cdp-core の qjs-compat 境界(dc/ 移行ツール群、HQ_CDP_QJS launcher)
//     これは chromium-cdp.nix を取り込む既存特例(spec「ops-cdp-core は特例として残してよい」)。
//
// node stdlib only。
import * as fs from "node:fs";
import { resolve, relative, extname, sep } from "node:path";

const root = resolve(process.cwd(), process.argv[2] || ".");
const pkgRoot = resolve(root, "packages");

const offenders = [];

// 相対パス(POSIX 区切り)を返す
function rel(p) {
  return relative(root, p).split(sep).join("/");
}

// cdp-core の qjs-compat 境界か(DC-M-08 で許容される既存特例)
function isCdpQjsBoundary(relPath) {
  return (
    relPath.startsWith("packages/ops-cdp-core/src/cdp/dc/") ||
    relPath === "packages/ops-cdp-core/src/cdp/test-package-run.sh"
  );
}

function scanMjs(p, relPath) {
  const txt = fs.readFileSync(p, "utf8");
  const lines = txt.split("\n");
  lines.forEach((line, i) => {
    const noComment = line.replace(/\/\/.*$/, "");
    // 実 qjs: import(コメント/usage 文字列は除外済)
    if (/\bfrom\s+['"]qjs:(std|os)['"]/.test(noComment)) {
      offenders.push(`qjs: import at ${relPath}:${i + 1}`);
    }
    // shell 経由の python3 / qjs 起動(spawn/exec/popen 等)
    if (
      /\b(python3|qjs)\b/.test(noComment) &&
      /\b(spawn|spawnSync|exec|execSync|execFile|execFileSync|popen)\b/.test(noComment)
    ) {
      offenders.push(`shell python3/qjs invocation at ${relPath}:${i + 1}`);
    }
  });
}

function scanSh(p, relPath) {
  const lines = fs.readFileSync(p, "utf8").split("\n");
  lines.forEach((line, i) => {
    const noComment = line.replace(/#.*$/, "");
    // 行頭/代入後のコマンドとして python3 / qjs を起動している
    if (/(^|[;&|=`(]|\$\()\s*"?python3\b/.test(noComment)) {
      offenders.push(`shell python3 invocation at ${relPath}:${i + 1}`);
    }
    if (/(^|[;&|=`(]|\$\()\s*"?qjs\b/.test(noComment)) {
      offenders.push(`shell qjs invocation at ${relPath}:${i + 1}`);
    }
  });
}

function walk(dir) {
  let ents;
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of ents) {
    const p = resolve(dir, ent.name);
    const relPath = rel(p);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === ".git") continue;
      if (ent.name === "docs") continue;
      if (ent.name === "__pycache__") {
        offenders.push(`__pycache__ directory present: ${relPath}/`);
        continue; // 中身は走査不要(ディレクトリ自体が offender)
      }
      walk(p);
      continue;
    }
    if (!ent.isFile()) continue;

    const ext = extname(ent.name);
    // .md は logic 層ではない
    if (ext === ".md") continue;

    // 1) 非 node runtime のソースそのもの
    if (ext === ".py") {
      offenders.push(`python source present: ${relPath}`);
      continue;
    }
    if (ext === ".pyc") {
      offenders.push(`python bytecode present: ${relPath}`);
      continue;
    }
    if (ext === ".zig") {
      offenders.push(`zig source present: ${relPath}`);
      continue;
    }

    // 2) cdp-core qjs-compat 境界は許容(既存特例)
    if (isCdpQjsBoundary(relPath)) continue;

    // 3) ファイル内容スキャン
    if (ext === ".mjs") scanMjs(p, relPath);
    else if (ext === ".sh") scanSh(p, relPath);
  }
}

if (!fs.existsSync(pkgRoot)) {
  process.stderr.write(`purity: no packages/ dir under ${root}\n`);
  process.exit(1);
}
walk(pkgRoot);

if (offenders.length === 0) {
  process.stdout.write("purity ok: 0 offenders\n");
  process.exit(0);
}
process.stderr.write(`purity FAIL: ${offenders.length} offender(s)\n`);
for (const o of offenders) process.stderr.write(`  - ${o}\n`);
process.exit(1);
