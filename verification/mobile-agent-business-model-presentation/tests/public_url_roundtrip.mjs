import { mkdir, readFile, writeFile } from "node:fs/promises";
import { canonicalJson, createUrlModuleUrl, decodeUrlModule, readUrlModuleToken } from "../packages/url-module/src/index.mjs";
import { compilePublicBusinessModelPresentation } from "../scripts/lib/compile-public-presentation.mjs";

const expectedOrders = Object.freeze({
  2: ["customer", "provider"],
  3: ["seeker", "operator", "landlord"],
  4: ["owner", "operator", "contractor", "supplier"],
});
const results = [];
for (const count of [2, 3, 4]) {
  const input = `examples/${count}-actors.jsonl`;
  const compiled = await compilePublicBusinessModelPresentation(await readFile(input, "utf8"), { compact: true });
  const url = await createUrlModuleUrl({
    base: "https://stg-mobile-agent.pages.dev/business-model/",
    fragment: "presentation",
    value: compiled.payload,
  });
  const token = readUrlModuleToken({ fragment: "presentation", input: url });
  const decoded = await decodeUrlModule(token);
  const actorOrder = compiled.plan.actors.map(actor => actor.id);
  if (canonicalJson(decoded) !== canonicalJson(compiled.payload)) throw new Error(`${count}-actor URL round-trip mismatch`);
  if (url.length > 8192) throw new Error(`${count}-actor URL exceeds 8192 chars: ${url.length}`);
  if (JSON.stringify(actorOrder) !== JSON.stringify(expectedOrders[count])) {
    throw new Error(`${count}-actor order mismatch: ${actorOrder.join(",")}`);
  }
  results.push({ count, actorOrder, tokenChars: token.length, urlChars: url.length, url });
}
const manifest = { schema: "mobile-agent.business-model-public-url-test/1", status: "PASS", results };
await mkdir("dist/public", { recursive: true });
await writeFile("dist/public/urls.json", `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest));
