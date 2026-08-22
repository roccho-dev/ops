import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertBusinessModelProjectionCoverage,
  compileBusinessModelPresentationPlan,
  createBusinessModelProjectionCoverage,
  parseBusinessModelProjectionProfile,
  parseBusinessModelSemanticJsonl,
  projectProfiledBusinessModelA2uiSequence,
  projectProfiledBusinessModelMapState,
  projectProfiledBusinessModelSeqState,
  validateProfiledBusinessModelSequence,
} from "../packages/business-model-compiler/src/index.mjs";
import { canonicalJson, encodeUrlModule, sha256Hex } from "../packages/url-module/src/index.mjs";
import { bundleOneHtmlModuleMap } from "./lib/one-html-module-map.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(root, "dist/layout-samples");
const entry = join(root, "apps/business-model-presentation-minimal/src/main.mjs");
const cssPath = join(root, "apps/business-model-presentation-minimal/public/styles.css");
const css = await readFile(cssPath, "utf8");
const mainSource = await readFile(entry, "utf8");
const catalogPath = join(root, "packages/business-model-compiler/src/catalog.mjs");
const catalogSource = await readFile(catalogPath, "utf8");
const uiSourceSha256 = await sha256Hex(Buffer.from(`${mainSource}\n${css}\n${catalogSource}`, "utf8"));

const fixtureManifestPath = join(root, "tests/e2e/fixtures.json");
const fixtureManifest = JSON.parse(await readFile(fixtureManifestPath, "utf8"));
if (fixtureManifest.schema !== "business-model-layout-e2e-fixtures/1") {
  throw new Error(`unsupported fixture manifest: ${fixtureManifest.schema}`);
}
const samples = fixtureManifest.fixtures;

const scriptJson = value => JSON.stringify(value).replaceAll("<", "\\u003c");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const manifest = [];

for (const sample of samples) {
  const semanticPath = join(root, sample.input);
  const semanticText = await readFile(semanticPath, "utf8");
  const profileText = await readFile(join(root, sample.profile), "utf8");
  const model = parseBusinessModelSemanticJsonl(semanticText);
  const profile = parseBusinessModelProjectionProfile(profileText);
  const plan = compileBusinessModelPresentationPlan(model, profile);
  const sequence = validateProfiledBusinessModelSequence(projectProfiledBusinessModelA2uiSequence(model, plan));
  const seqState = projectProfiledBusinessModelSeqState(model, plan);
  const mapState = projectProfiledBusinessModelMapState(model, plan);
  const coverage = assertBusinessModelProjectionCoverage(createBusinessModelProjectionCoverage({ model, plan, sequence, seqState, mapState }));
  const stageFocus = Object.fromEntries(model.stages.map(stage => [stage.id, stage.focusRef]));
  const stageLabels = Object.fromEntries(model.stages.map(stage => [stage.id, stage.name]));
  const sourceSha256 = await sha256Hex(Buffer.from(semanticText, "utf8"));
  const profileSha256 = await sha256Hex(Buffer.from(profileText, "utf8"));
  const sequenceSha256 = await sha256Hex(canonicalJson(sequence));
  const seqSha256 = await sha256Hex(canonicalJson(seqState));
  const payload = Object.freeze({
    schema: "business-model-presentation-minimal-payload/1",
    id: model.id,
    label: model.title,
    sourceSha256,
    profileSha256,
    sequence,
    seqState,
    stageFocus,
    stageLabels,
    coverage,
  });
  const token = await encodeUrlModule(payload);
  const moduleMap = await bundleOneHtmlModuleMap({
    entry,
    replacements: new Map([[entry, [["__DEFAULT_PRESENTATION_TOKEN__", token]]]]),
    root,
  });
  const uiSourceMeta = sample.includeUiSourceMeta ? `\n<meta name="artifact-ui-source-sha256" content="${uiSourceSha256}">` : "";
  const html = `<!doctype html>
<html lang="ja" data-status="boot">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="data:,">
<meta name="artifact-schema" content="${payload.schema}">
<meta name="artifact-source-sha256" content="${sourceSha256}">
<meta name="artifact-profile-sha256" content="${profileSha256}">${uiSourceMeta}
<title>${model.title}</title>
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
  const htmlSha256 = await sha256Hex(Buffer.from(html, "utf8"));
  const receipt = {
    schema: "ui-jsonl-business-model-layout-sample-receipt/1",
    status: "PASS",
    pass: true,
    sample: sample.id,
    actorCount: model.actors.length,
    layoutInvariant: {
      base: "2-actor existing layout",
      unchangedUiFiles: [
        "apps/business-model-presentation-minimal/src/main.mjs",
        "apps/business-model-presentation-minimal/public/styles.css",
        "packages/business-model-compiler/src/catalog.mjs"
      ],
      uiSourceSha256,
      scenePattern: "actor | exchange | actor | ...",
      headerTimelineStatusLegendSeq: "unchanged"
    },
    source: { path: sample.input, sha256: sourceSha256 },
    profile: { path: sample.profile, id: profile.id, actorRoles: profile.actorRoles, sha256: profileSha256 },
    generated: { stages: sequence.stages.length, coverage: coverage.status, sequenceSha256, seqSha256 },
    artifact: { path: `dist/layout-samples/${sample.id}.html`, sha256: htmlSha256, embeddedPayloadTokenChars: token.length },
    expected: { htmlSha256: sample.expectedHtmlSha256 },
  };
  if (htmlSha256 !== sample.expectedHtmlSha256) {
    throw new Error(`${sample.id} HTML SHA mismatch: expected ${sample.expectedHtmlSha256}, got ${htmlSha256}`);
  }
  await writeFile(join(output, `${sample.id}.html`), html);
  await writeFile(join(output, `${sample.id}.payload.json`), `${JSON.stringify(payload, null, 2)}\n`);
  await writeFile(join(output, `${sample.id}.receipt.json`), `${JSON.stringify(receipt, null, 2)}\n`);
  manifest.push(receipt);
}
if (uiSourceSha256 !== fixtureManifest.uiSourceSha256) {
  throw new Error(`UI source SHA mismatch: expected ${fixtureManifest.uiSourceSha256}, got ${uiSourceSha256}`);
}
await writeFile(join(output, "manifest.json"), `${JSON.stringify({ schema: "ui-jsonl-layout-samples-manifest/1", uiSourceSha256, samples: manifest }, null, 2)}\n`);
console.log(JSON.stringify({ status: "PASS", uiSourceSha256, samples: manifest.map(item => ({ sample: item.sample, actorCount: item.actorCount, html: item.artifact.path })) }));
