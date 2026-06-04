// node --import で読み込むプリロード。
// 1) qjs:std/qjs:os を解決する resolve hook を登録。
// 2) qjs グローバル scriptArgs を process.argv から再現(qjs: [script, ...args])。
// 3) DC-S-06 対応: unhandledRejection を非0 exit にし false-green を防ぐ。
import { register } from "node:module";
import * as std from "./std.mjs";
import * as os from "./os.mjs";

register("./hooks.mjs", import.meta.url);

// qjs --std はグローバル std/os を注入する。それに依存する .mjs があるため再現する。
globalThis.std = std;
globalThis.os = os;
globalThis.scriptArgs = process.argv.slice(1);

process.on("unhandledRejection", (e) => {
  process.stderr.write(`unhandledRejection: ${e && e.stack ? e.stack : e}\n`);
  process.exit(1);
});
