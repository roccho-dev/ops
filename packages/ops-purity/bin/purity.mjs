#!/usr/bin/env node
// repo-wide runtime purity check (completion-spec gate #5, DC-S-11 / DC-M-08).
//
// 与えられた root 配下の packages/** logic 層をスキャンし、宣言されていない非 node runtime の痕跡を
// 1 件でも見つけたら fail(exit 1, offender を列挙)する。clean なら exit 0。
//
// 検出対象(LOGIC 層):
//   - *.py / *.pyc ソース(__pycache__ 配下含む)
//     — runtime:"python" または deps に python/python3 を明示した package dir は除外
//   - __pycache__ ディレクトリそのもの(everywhere)
//   - *.zig ソース(everywhere)
//   - *.mjs 内の実 `from "qjs:..."` import
//   - *.mjs / *.sh 内の shell `python3` / `qjs` 起動(spawn / exec / 直接コマンド)
//
// hybrid 境界(completion-spec gate#5 緩和): build/packages.jsonl で runtime=="python"、または
// Python Evidence Provider等のため deps に python/python3 を宣言した package dir 配下の
// .py/.pyc と python3 起動は許容する。既存package宣言を唯一のAuthorityとし、path allowlistは持たない。
// Pythonを宣言していないnode/go package配下の .py は依然offender。
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

// build/packages.jsonl を読み、Python runtime/sourceを明示した package の dir 集合を作る。
// entry(例: packages/ops-src-runtime-pack/bin/x.py)から package dir 相対 path
// (packages/ops-src-runtime-pack)を導出する。これら配下の .py/.pyc は purity 許容。
function pythonPackageDirs() {
  const jsonlPath = resolve(root, "build", "packages.jsonl");
  const dirs = new Set();
  let text;
  try {
    text = fs.readFileSync(jsonlPath, "utf8");
  } catch {
    return dirs; // jsonl 無し: python 例外なし(全 .py が offender)
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let decl;
    try {
      decl = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const pythonDeclared =
      decl.runtime === "python" ||
      (Array.isArray(decl.deps) && decl.deps.some((dep) => dep === "python" || dep === "python3"));
    if (pythonDeclared && typeof decl.entry === "string") {
      // entry の最初の2セグメント(packages/<name>)を package dir とする
      const parts = decl.entry.split("/");
      if (parts.length >= 2) dirs.add(parts.slice(0, 2).join("/"));
    }
  }
  return dirs;
}

const pythonDirs = pythonPackageDirs();

// relPath がPythonを明示したpackage dir配下か
function underPythonPackage(relPath) {
  for (const d of pythonDirs) {
    if (relPath === d || relPath.startsWith(d + "/")) return true;
  }
  return false;
}

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

function isNonNodePackageBoundary(relPath) {
  return relPath === "packages/cue-append-contract-core" || relPath.startsWith("packages/cue-append-contract-core/");
}

function scanMjs(p, relPath) {
  const txt = fs.readFileSync(p, "utf8");
  const lines = txt.split("\n");
  lines.forEach((line, i) => {
    if (line.trimStart().startsWith("//")) return;
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
    if (!underPythonPackage(relPath) && /(^|[;&|=`(]|\$\()\s*"?python3\b/.test(noComment)) {
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
      if (isNonNodePackageBoundary(relPath)) continue;
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
    // hybrid 境界: Pythonを明示したpackage dir配下の .py/.pyc は許容。
    // (__pycache__ ディレクトリ自体は上で everywhere 検出済 — python 宣言下でも捕捉)
    if (ext === ".py") {
      if (!underPythonPackage(relPath)) {
        offenders.push(`python source present: ${relPath}`);
      }
      continue;
    }
    if (ext === ".pyc") {
      if (!underPythonPackage(relPath)) {
        offenders.push(`python bytecode present: ${relPath}`);
      }
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
