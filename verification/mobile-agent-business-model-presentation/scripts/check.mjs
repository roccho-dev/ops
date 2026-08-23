import { readFile } from "node:fs/promises";
import { sha256Hex } from "../packages/url-module/src/index.mjs";

const expected = "fcee971464e3ee465e25c180f0bd1c0ac39d0936b81583649de48303929c7307";
const html = await readFile(new URL("../dist/index.html", import.meta.url));
const actual = await sha256Hex(html);
if (actual !== expected) throw new Error(`HTML SHA mismatch: ${actual}`);
console.log(JSON.stringify({ schema: "ui-jsonl-business-model-check/1", status: "PASS", expected, actual }));
