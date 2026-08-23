import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { canonicalJson, createUrlModuleUrl, decodeUrlModule, readUrlModuleToken, sha256Hex } from "../packages/url-module/src/index.mjs";
import { compilePublicBusinessModelPresentation } from "./lib/compile-public-presentation.mjs";

const [inputArg = "examples/2-actors.jsonl", baseArg = "https://stg-mobile-agent.pages.dev/business-model/", outputArg = ""] = process.argv.slice(2);
const inputPath = resolve(inputArg);
const semanticText = await readFile(inputPath, "utf8");
const compiled = await compilePublicBusinessModelPresentation(semanticText, { compact: true });
const url = await createUrlModuleUrl({ base: baseArg, fragment: "presentation", value: compiled.payload });
const token = readUrlModuleToken({ fragment: "presentation", input: url });
const decoded = await decodeUrlModule(token);
if (canonicalJson(decoded) !== canonicalJson(compiled.payload)) throw new Error("generated URL did not round-trip exactly");
const payloadSha256 = await sha256Hex(canonicalJson(compiled.payload));
const receipt = {
  schema: "mobile-agent.business-model-public-url/1",
  status: "PASS",
  pass: true,
  pattern: "business-model/1",
  input: inputArg,
  actorCount: compiled.model.actors.length,
  actorOrder: compiled.plan.actors.map(actor => actor.id),
  sourceSha256: compiled.sourceSha256,
  payloadSha256,
  tokenChars: token.length,
  urlChars: url.length,
  limitChars: 8192,
  url,
};
if (outputArg) {
  const outputPath = resolve(outputArg);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`);
}
console.log(JSON.stringify(receipt));
