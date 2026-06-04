// node --import 用プリロード。
// qjs --std 互換の global std/os/scriptArgs を注入する。
// (ソースの qjs: import は相対 ./qjs-compat/*.mjs へ書換済のため、ESM loader hook は不要)
import * as std from "./std.mjs";
import * as os from "./os.mjs";

globalThis.std = std;
globalThis.os = os;
globalThis.scriptArgs = process.argv.slice(1);

// DC-S-06: false-green 防止。
process.on("unhandledRejection", (e) => {
  process.stderr.write(`unhandledRejection: ${e && e.stack ? e.stack : e}\n`);
  process.exit(1);
});
