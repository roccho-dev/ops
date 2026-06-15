#!/usr/bin/env node
// `qjs --std -m <script> [args...]` 互換の node 製 launcher。
// 既存の launcher/test が組み立てる qjs コマンド列をそのまま受け、node で実行する。
// qjs 固有フラグ(--std / -m)は読み飛ばし、global std/os/scriptArgs を整えて script を import する。
// (qjs: import は相対 ./qjs-compat/*.mjs へ書換済のため loader hook は不要)
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import * as std from "../core/std.mjs";
import * as os from "../core/os.mjs";

globalThis.std = std;
globalThis.os = os;

// DC-S-06: false-green 防止。
process.on("unhandledRejection", (e) => {
  process.stderr.write(`unhandledRejection: ${e && e.stack ? e.stack : e}\n`);
  process.exit(1);
});

const raw = process.argv.slice(2);
const rest = [];
for (const a of raw) {
  if (a === "--std" || a === "-m") continue; // qjs 固有フラグを除去
  rest.push(a);
}
const script = rest.shift();
if (!script) {
  process.stderr.write("qjs-cli: no script given\n");
  process.exit(2);
}
globalThis.scriptArgs = [script, ...rest]; // qjs: scriptArgs[0]=script
// Keep Node-imported qjs-compatible scripts from seeing qjs flags in process.argv.
process.argv = [process.argv[0], script, ...rest];

await import(pathToFileURL(resolve(process.cwd(), script)).href);
