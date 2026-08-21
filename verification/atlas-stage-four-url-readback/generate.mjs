import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2]);
const stableBase = process.argv[3];
const kernelId = process.argv[4];
const treeDigest = process.argv[5];
const outputPath = process.argv[6];
assert.ok(root && stableBase && kernelId && treeDigest && outputPath);

const codec = await import(pathToFileURL(path.join(root, "kernel", kernelId, "packages/url-module/src/index.mjs")).href);
const invocation = await import(pathToFileURL(path.join(root, "kernel", kernelId, "packages/artifact-invocation/src/index.mjs")).href);

const ordinary = (id, title, text) => ({
  rootId: "root",
  surfaceId: id,
  dataModel: {},
  components: [
    { id: "root", component: "Column", children: ["title", "card"] },
    { id: "title", component: "Text", text: title, variant: "h1" },
    { id: "card", component: "Card", children: ["body"] },
    { id: "body", component: "Text", text },
  ],
});
const canvas = (id, title, ariaLabel, viewBox, nodes, edges) => ({
  rootId: "root",
  surfaceId: id,
  dataModel: {},
  components: [
    { id: "root", component: "Column", children: ["title", "canvas"] },
    { id: "title", component: "Text", text: title, variant: "h1" },
    { id: "canvas", component: "AtlasStage", ariaLabel, viewBox, nodes, edges },
  ],
});

const cases = [
  {
    id: "base",
    title: "A2UI Base",
    labels: ["A2UI Base", "A2UI only · no canvas"],
    nodeCount: 0,
    edgeCount: 0,
    canvas: false,
    surface: ordinary("base-proof", "A2UI Base", "A2UI only · no canvas"),
  },
  {
    id: "graph",
    title: "Graph Canvas",
    labels: ["Source", "Compiler", "URL", "Browser"],
    nodeCount: 4,
    edgeCount: 3,
    canvas: true,
    surface: canvas("graph-proof", "Graph Canvas", "Graph Canvas proof", { x: 0, y: 0, width: 800, height: 360 }, [
      { id: "source", label: "Source", kind: "data", x: 40, y: 140, width: 140, height: 72 },
      { id: "compiler", label: "Compiler", kind: "system", x: 230, y: 140, width: 140, height: 72 },
      { id: "url", label: "URL", kind: "data", x: 420, y: 140, width: 140, height: 72 },
      { id: "browser", label: "Browser", kind: "system", x: 610, y: 140, width: 140, height: 72 },
    ], [
      { id: "g1", from: "source", to: "compiler", kind: "flow", label: "compile" },
      { id: "g2", from: "compiler", to: "url", kind: "flow", label: "encode" },
      { id: "g3", from: "url", to: "browser", kind: "flow", label: "open" },
    ]),
  },
  {
    id: "map",
    title: "Semantic Map Canvas",
    labels: ["Product Value", "Request", "State", "Canvas", "Receipt"],
    nodeCount: 5,
    edgeCount: 4,
    canvas: true,
    surface: canvas("map-proof", "Semantic Map Canvas", "Semantic Map Canvas proof", { x: 0, y: 0, width: 820, height: 440 }, [
      { id: "value", label: "Product Value", kind: "region", x: 20, y: 20, width: 780, height: 400 },
      { id: "request", label: "Request", kind: "event", parentId: "value", x: 70, y: 160, width: 130, height: 72 },
      { id: "state", label: "State", kind: "data", parentId: "value", x: 245, y: 160, width: 130, height: 72 },
      { id: "canvas", label: "Canvas", kind: "system", parentId: "value", x: 420, y: 160, width: 130, height: 72 },
      { id: "receipt", label: "Receipt", kind: "data", parentId: "value", x: 595, y: 160, width: 130, height: 72 },
    ], [
      { id: "m1", from: "request", to: "state", kind: "relation", label: "reduce" },
      { id: "m2", from: "state", to: "canvas", kind: "relation", label: "project" },
      { id: "m3", from: "canvas", to: "receipt", kind: "relation", label: "observe" },
      { id: "m4", from: "receipt", to: "request", kind: "association", label: "iterate" },
    ]),
  },
  {
    id: "seq",
    title: "Sequence Canvas",
    labels: ["User", "Browser", "Runtime", "Open URL", "Render", "Update URL"],
    nodeCount: 6,
    edgeCount: 5,
    canvas: true,
    surface: canvas("seq-proof", "Sequence Canvas", "Sequence Canvas proof", { x: 0, y: 0, width: 860, height: 480 }, [
      { id: "user", label: "User", kind: "actor", x: 60, y: 40, width: 150, height: 58 },
      { id: "browser", label: "Browser", kind: "actor", x: 355, y: 40, width: 150, height: 58 },
      { id: "runtime", label: "Runtime", kind: "actor", x: 650, y: 40, width: 150, height: 58 },
      { id: "open", label: "Open URL", kind: "step", x: 60, y: 230, width: 150, height: 64 },
      { id: "render", label: "Render", kind: "step", x: 355, y: 230, width: 150, height: 64 },
      { id: "update", label: "Update URL", kind: "step", x: 650, y: 230, width: 150, height: 64 },
    ], [
      { id: "s1", from: "user", to: "open", kind: "message", label: "share" },
      { id: "s2", from: "open", to: "browser", kind: "message", label: "navigate" },
      { id: "s3", from: "browser", to: "render", kind: "message", label: "decode" },
      { id: "s4", from: "render", to: "runtime", kind: "message", label: "execute" },
      { id: "s5", from: "runtime", to: "update", kind: "message", label: "compile" },
    ]),
  },
];

const results = [];
for (const item of cases) {
  const request = invocation.validateArtifactInvocation({
    schema: "artifact-invocation/2",
    id: `request.atlas-stage.${item.id}`,
    intent: "render",
    inputs: [{
      id: "surface",
      mediaType: "application/vnd.roccho.a2ui-surface+json",
      schema: "a2ui-surface/1",
      source: { kind: "inline", value: item.surface },
    }],
    constraints: { allowedRuntimes: ["browser"], noUpload: true },
    expects: ["a2ui-render-receipt/1"],
  });
  const url = await codec.createUrlModuleUrl({ base: stableBase, fragment: "invoke", value: request });
  assert.ok(url.length < 8192, `${item.id}: URL exceeds limit`);
  assert.deepEqual(await codec.readUrlModule({ fragment: "invoke", input: url }), request);
  results.push({ ...item, request, url, urlLength: url.length });
}

const output = { schema: "ops.atlasStageFourUrlCases/1", publicationTree: treeDigest, stableBase, cases: results };
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ status: "PASS", urls: Object.fromEntries(results.map(item => [item.id, item.url])) }));
