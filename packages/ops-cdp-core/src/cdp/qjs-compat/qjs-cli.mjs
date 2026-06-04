#!/usr/bin/env node
// `qjs --std -m <script> [args...]` 互換の node 製 CLI。
// 既存の launcher/test が組み立てる qjs コマンド列をそのまま受け、node で実行する。
// qjs 固有フラグ(--std / -m)は読み飛ばし、hooks(qjs:std/os 解決)と global std/os/scriptArgs を整えて script を import する。
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import * as std from "./std.mjs";
import * as os from "./os.mjs";

register("./hooks.mjs", import.meta.url);
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

await import(pathToFileURL(resolve(process.cwd(), script)).href);
