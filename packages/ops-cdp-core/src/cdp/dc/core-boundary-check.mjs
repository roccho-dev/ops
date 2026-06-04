#!/usr/bin/env node
// core-boundary lint: core/ はドメイン知識ゼロを強制。
// core/**.mjs は core/ 内 と ../qjs-compat/(runtime adapter)と node: builtin のみ import 可。
// ../domain/ ../cli/ ../lib.mjs ../<usecase> 等を import したら赤(DOMAIN_KNOWLEDGE_BRANCHES==0)。
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CORE = path.join(SRC, "core");

const violations = [];
function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) { walk(p); continue; }
    if (!ent.name.endsWith(".mjs")) continue;
    const rel = path.relative(SRC, p);
    const txt = fs.readFileSync(p, "utf8");
    const re = /\bfrom\s+["']([^"']+)["']/g;
    let m;
    while ((m = re.exec(txt))) {
      const spec = m[1];
      if (spec.startsWith("node:")) continue;                 // node builtin OK
      if (!spec.startsWith(".")) continue;                    // 外部(理論上無いが)スキップ
      const resolved = path.resolve(path.dirname(p), spec);
      const within = (base) => resolved === base || resolved.startsWith(base + path.sep);
      if (within(CORE)) continue;                             // core 内 OK
      if (within(path.join(SRC, "qjs-compat"))) continue;     // runtime adapter OK
      violations.push(`${rel} → ${spec}`);
    }
  }
}
walk(CORE);

if (violations.length === 0) { process.stdout.write(`core-boundary: OK (core/ はドメイン/CLI を import せず)\n`); process.exit(0); }
process.stderr.write(`core-boundary: ${violations.length} VIOLATION(S)\n`);
for (const v of violations) process.stderr.write(`  - ${v}\n`);
process.exit(1);
