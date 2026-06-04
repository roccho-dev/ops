#!/usr/bin/env node
// node-only purity check (DC-S-11 / DC-M-08)。
// logic 層に非 node runtime の痕跡が無いことを保証する。RED になれば移行未完を示す。
// 対象外(builder/glue): nix ファイル、本 check 自身。
import * as fs from "node:fs";
import { resolve, relative, extname, basename } from "node:path";

const root = resolve(process.cwd(), process.argv[2] || ".");

const violations = [];
function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === ".git" || ent.name === "dc") continue;
      walk(p);
      continue;
    }
    const ext = extname(ent.name);
    const rel = relative(root, p);
    // 1) 非 node runtime のソースファイルそのもの
    if (ext === ".py") violations.push(`python source present: ${rel}`);
    if (ext === ".zig") violations.push(`zig source present: ${rel}`);
    // 2) .mjs の中身
    if (ext === ".mjs") {
      const txt = fs.readFileSync(p, "utf8");
      const lines = txt.split("\n");
      lines.forEach((line, i) => {
        const noComment = line.replace(/\/\/.*$/, "");
        if (/\bfrom\s+['"]qjs:(std|os)['"]/.test(noComment)) {
          violations.push(`qjs: import at ${rel}:${i + 1}`);
        }
        // python の起動(launcher 自身=cdp-bridge 以外で)
        if (/\bpython3?\b/.test(noComment) && !/qjs-compat\/purity-check\.mjs$/.test(rel)) {
          if (/popen|exec|spawn|HQ_CDP_PYTHON|String\.raw|sys\.argv|import json/.test(noComment)) {
            violations.push(`python spawn/embed at ${rel}:${i + 1}`);
          }
        }
      });
      // embedded python ブロック(import json, os, ...)
      if (/\n\s*import\s+(json|os|sys|shutil|zipfile)\b/.test(txt)) {
        violations.push(`embedded python block in ${rel}`);
      }
    }
  }
}
walk(root);

if (violations.length === 0) {
  process.stdout.write(`node-only purity: OK (${root})\n`);
  process.exit(0);
}
process.stderr.write(`node-only purity: ${violations.length} VIOLATION(S)\n`);
for (const v of violations) process.stderr.write(`  - ${v}\n`);
process.exit(1);
