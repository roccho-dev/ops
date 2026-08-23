import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeUrlModule } from "../packages/url-module/src/index.mjs";
import { bundleOneHtmlModuleMap } from "./lib/one-html-module-map.mjs";
import { compilePublicBusinessModelPresentation } from "./lib/compile-public-presentation.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(root, "dist/public");
const semanticPath = join(root, "examples/2-actors.jsonl");
const semanticText = await readFile(semanticPath, "utf8");
const compiled = await compilePublicBusinessModelPresentation(semanticText);
const token = await encodeUrlModule(compiled.payload);
const entry = join(root, "apps/business-model-presentation-minimal/src/main.mjs");
const moduleMap = await bundleOneHtmlModuleMap({
  entry,
  replacements: new Map([[entry, [["__DEFAULT_PRESENTATION_TOKEN__", token]]]]),
  root,
});
const css = await readFile(join(root, "apps/business-model-presentation-minimal/public/styles.css"), "utf8");
const scriptJson = value => JSON.stringify(value).replaceAll("<", "\\u003c");
const html = `<!doctype html>
<html lang="ja" data-status="boot">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="data:,">
<meta name="artifact-schema" content="${compiled.payload.schema}">
<meta name="artifact-pattern" content="business-model/1">
<meta name="artifact-source-sha256" content="${compiled.sourceSha256}">
<meta name="artifact-profile-sha256" content="${compiled.profileSha256}">
<title>${compiled.model.title}</title>
<style>${css.replaceAll("</style", "<\\/style")}</style>
<script type="importmap">${scriptJson({ imports: moduleMap.imports })}</script>
</head>
<body>
<main id="surface" aria-label="A2UI Slides"></main>
<div class="seq-backdrop" id="seq-backdrop" data-open="false" aria-hidden="true"></div>
<aside class="seq-shell" id="seq-shell" data-preview="false" data-expanded="false" aria-label="主体別Seq" role="complementary">
  <div class="seq-toolbar">
    <div class="seq-identity">
      <span class="seq-marker" aria-hidden="true"></span>
      <div class="seq-labels"><span class="seq-kind">Actor Seq</span><strong class="seq-current" id="seq-current"></strong></div>
    </div>
    <button class="seq-close" id="seq-close" type="button" aria-label="Seqを閉じる" hidden>×</button>
  </div>
  <div class="seq-mount" id="seq-mount"></div>
  <button class="seq-open" id="seq-open" type="button" aria-expanded="false" aria-label="主体別Seqを開く"><span>Open Seq ↗</span></button>
</aside>
<p id="fatal" hidden role="alert"></p>
<script type="module">import ${JSON.stringify(moduleMap.entrySpecifier)};</script>
</body>
</html>`;

const receipt = {
  schema: "mobile-agent.business-model-public-build/1",
  status: "PASS",
  pass: true,
  pattern: "business-model/1",
  variableInput: "examples/2-actors.jsonl",
  actorOrder: compiled.plan.actors.map(actor => actor.id),
  source: { id: compiled.model.id, sha256: compiled.sourceSha256 },
  profile: { id: compiled.profile.id, sha256: compiled.profileSha256 },
  generated: {
    sequenceSha256: compiled.sequenceSha256,
    seqSha256: compiled.seqSha256,
    stages: compiled.sequence.stages.length,
    coverage: compiled.coverage.status,
  },
  artifact: { path: "dist/public/index.html", embeddedPayloadTokenChars: token.length },
};

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await writeFile(join(output, "index.html"), html);
await writeFile(join(output, "presentation.a2ui.json"), `${JSON.stringify(compiled.payload, null, 2)}\n`);
await writeFile(join(output, "build-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ ...receipt, artifactPath: relative(root, join(output, "index.html")).replaceAll("\\", "/") }));
