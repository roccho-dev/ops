#!/usr/bin/env node
// 破壊的ユースケース guard runner。
// destructive.jsonl の全 id に guard があるか(uncovered=0)を保証し、各 guard を実行して honest に集計する。
// silent skip 禁止: skip/blocked/pending/na は理由必須で明示。
// exit 0 は「完全緑」(fail=0 && uncovered=0 && pending=0 && skip=0)のみ。
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import guards from "./guards.mjs";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(SRC, "../../../..");
const jsonlPath = process.argv[2] || path.join(ROOT, "issues/260604-ops-nodejs-only.destructive.jsonl");

const ids = fs.readFileSync(jsonlPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).id);

const results = [];
for (const id of ids) {
  const g = guards[id];
  if (!g) { results.push({ id, status: "uncovered", detail: "guard 未登録" }); continue; }
  if (g.blocked) { results.push({ id, status: "blocked", detail: g.reason, ref: g.ref }); continue; }
  if (g.na) { results.push({ id, status: "na", detail: g.reason }); continue; }
  if (g.pending) { results.push({ id, status: "pending", detail: g.reason }); continue; }
  try {
    const r = await g.run();
    results.push({ id, status: r.status, detail: r.detail, reason: r.reason });
  } catch (e) { results.push({ id, status: "fail", detail: `guard threw: ${e && e.stack ? e.stack : e}` }); }
}
// 登録だけあって jsonl に無い guard(孤児)も検出
for (const gid of Object.keys(guards)) if (!ids.includes(gid)) results.push({ id: gid, status: "orphan", detail: "jsonl に対応 DC 無し" });

const order = ["fail", "uncovered", "orphan", "pending", "skip", "blocked", "na", "pass"];
const ICON = { pass: "✓", fail: "✗", blocked: "▣", pending: "…", skip: "∅", na: "—", uncovered: "‼", orphan: "?" };
results.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));

const count = {};
for (const r of results) count[r.status] = (count[r.status] || 0) + 1;

process.stdout.write(`\n=== Destructive-Case Guard Runner ===\njsonl: ${path.relative(ROOT, jsonlPath)}  (DC total ${ids.length})\n\n`);
for (const r of results) {
  process.stdout.write(`  ${ICON[r.status] || "?"} [${r.status.toUpperCase()}] ${r.id}\n`);
  if (r.status !== "pass") process.stdout.write(`        ${r.ref ? `ref=${r.ref} ` : ""}${(r.detail || "").split("\n")[0]}\n`);
}
const summary = order.filter((s) => count[s]).map((s) => `${s}=${count[s]}`).join("  ");
process.stdout.write(`\nsummary: ${summary}\n`);

const gateFail = (count.fail || 0) + (count.uncovered || 0) + (count.orphan || 0);
const fullyGreen = gateFail === 0 && !count.pending && !count.skip;
process.stdout.write(`coverage: ${count.uncovered ? `INCOMPLETE (uncovered=${count.uncovered})` : "COMPLETE (uncovered=0)"}\n`);
process.stdout.write(`gate(fail+uncovered): ${gateFail === 0 ? "GREEN" : `RED (${gateFail})`}\n`);
process.stdout.write(`fully-green(incl pending/skip): ${fullyGreen ? "YES" : "NO"}\n`);
process.exit(fullyGreen ? 0 : 1);
