import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
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
const output = join(root, "dist");
const semanticPath = join(root, "examples/2-actors.jsonl");

// Fixed UI projection policy. examples/2-actors.jsonl is both the public example and the baseline E2E fixture.
const profilePath = join(root, "profiles/two-party-service.json");
const profileText = await readFile(profilePath, "utf8");

const semanticText = await readFile(semanticPath, "utf8");
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
<meta name="artifact-schema" content="${payload.schema}">
<meta name="artifact-source-sha256" content="${sourceSha256}">
<meta name="artifact-profile-sha256" content="${profileSha256}">
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

const receipt = {
  schema: "ui-jsonl-business-model-build-receipt/1",
  status: "PASS",
  pass: true,
  variableInput: "examples/2-actors.jsonl",
  fixedUi: {
    app: "apps/business-model-presentation-minimal",
    projectionProfile: "two-party-service/1",
    runtimeModuleCount: moduleMap.moduleCount,
  },
  source: { id: model.id, sha256: sourceSha256 },
  profile: { id: profile.id, sha256: profileSha256 },
  generated: { sequenceSha256, seqSha256, stages: sequence.stages.length, coverage: coverage.status },
  artifact: { path: "dist/index.html", embeddedPayloadTokenChars: token.length },
};

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await writeFile(join(output, "index.html"), html);
await writeFile(join(output, "presentation.a2ui.json"), `${JSON.stringify(payload, null, 2)}\n`);
await writeFile(join(output, "build-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ ...receipt, artifactPath: relative(root, join(output, "index.html")).replaceAll("\\", "/") }));
