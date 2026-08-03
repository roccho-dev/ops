import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { bundle, manifest, run } from "../../../dist/mjs-bundler/bundle.mjs";

const request = {
  operation: "bundle",
  entry: "src/index.mjs",
  modules: {
    "src/index.mjs": "import { twice } from './math.mjs'; export const answer = twice(20) + 1; export function execute(){ return answer; }",
    "src/math.mjs": "export const unused = 999; export function twice(value){ return value * 2; }"
  }
};

const first = await run(request);
const second = await bundle(request);
assert.equal(first, second, "two builds must be byte-identical");
assert.equal(/unused\s*=\s*999/.test(first), false, "unused export must be tree-shaken");
assert.equal(/^\s*import\s/m.test(first), false, "output must not retain static imports");

const encoded = Buffer.from(first).toString("base64");
const output = await import(`data:text/javascript;base64,${encoded}`);
assert.equal(output.execute(), 41);
assert.equal(manifest.engineVersion, "2.80.0");
assert.deepEqual(manifest.sideAssets, []);

const sha256 = createHash("sha256").update(first).digest("hex");
console.log(JSON.stringify({
  status: "PASS",
  engine: manifest.engine,
  engineVersion: manifest.engineVersion,
  bundledBytes: Buffer.byteLength(first),
  bundledSha256: sha256,
  result: output.execute()
}));
