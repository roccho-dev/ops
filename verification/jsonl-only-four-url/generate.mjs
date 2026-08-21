import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const [publicationInput, appManifestInput, stableBaseInput, outputInput] = process.argv.slice(2);
assert.ok(publicationInput && appManifestInput && stableBaseInput && outputInput, "usage: generate.mjs PUBLICATION APP_MANIFEST STABLE_BASE OUTPUT");
const publicationRoot = path.resolve(publicationInput);
const appManifestPath = path.resolve(appManifestInput);
const stableBase = new URL(stableBaseInput).href;
const outputPath = path.resolve(outputInput);
const app = JSON.parse(fs.readFileSync(appManifestPath, "utf8"));

const digest = bytes => `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
const inside = relative => {
  assert.equal(typeof relative, "string");
  assert.ok(relative && !path.isAbsolute(relative));
  const target = path.resolve(publicationRoot, relative);
  assert.ok(target.startsWith(`${publicationRoot}${path.sep}`));
  assert.ok(fs.statSync(target).isFile(), `missing publication file: ${relative}`);
  return target;
};
const load = async descriptor => {
  const modulePath = inside(descriptor.module);
  const module = await import(`${pathToFileURL(modulePath).href}?sha=${digest(fs.readFileSync(modulePath)).slice(7)}`);
  assert.equal(typeof module[descriptor.export], "function", `missing export ${descriptor.export}`);
  return module[descriptor.export];
};

assert.equal(app.schema, "ops.artifactRuntimeApp/1");
assert.equal(app.status, "accepted-source");
assert.equal(app.authority, false);
assert.equal(app.boundaries.handwrittenViewDataAllowedInUrlGenerator, false);
assert.equal(app.contracts.jsonl.handwrittenSurfaceAllowed, false);
assert.deepEqual(app.contracts.jsonl.rowKinds, ["TreePatch", "StatePatch"]);
assert.equal(app.publication.listedFiles, 63);
assert.equal(app.publication.treeDigest, "sha256:b5c164f7b8a9dd8c612cfdb6747d649f4ae2a809a5ddaa02d744a509a4d40c52");

const artifactManifest = JSON.parse(fs.readFileSync(inside(app.entrypoints.artifactManifest), "utf8"));
assert.equal(artifactManifest.treeDigest, app.publication.treeDigest);
assert.equal(artifactManifest.files.length, app.publication.listedFiles);
const compileJsonl = await load(app.operations.compileJsonl);
const encode = await load(app.operations.encode);
const decode = await load(app.operations.decode);
const validateInvocation = await load(app.operations.validateInvocation);
const canonicalJson = await load({ module: app.entrypoints.codec, export: "canonicalJson" });

const readPointer = (value, pointer) => {
  if (typeof pointer !== "string" || !pointer.startsWith("/")) return undefined;
  let current = value;
  for (const raw of pointer.split("/").slice(1)) {
    const key = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, key)) return undefined;
    current = current[key];
  }
  return current;
};
const collectVisibleLabels = surface => {
  const labels = new Set();
  const add = value => {
    if (typeof value === "string" && value.trim()) labels.add(value.trim());
    if (Array.isArray(value)) for (const item of value) add(item);
  };
  for (const component of surface.components) {
    for (const key of ["text", "label", "title"]) add(component[key]);
    add(readPointer(surface.dataModel, component.path));
    for (const node of component.nodes ?? []) add(node.label);
  }
  return [...labels];
};

const cases = [];
for (const fixture of app.contracts.jsonl.fixtures) {
  const fixturePath = inside(fixture.path);
  const bytes = fs.readFileSync(fixturePath);
  assert.equal(digest(bytes), fixture.sha256, `${fixture.id}: JSONL digest mismatch`);
  const jsonl = bytes.toString("utf8");
  const rows = jsonl.trim().split(/\n+/u).map(line => JSON.parse(line));
  assert.deepEqual(rows.map(row => row.type), app.contracts.jsonl.rowKinds, `${fixture.id}: row kinds mismatch`);

  const projected = compileJsonl({ jsonl });
  assert.equal(projected.receipt.schema, app.contracts.jsonl.receiptSchema);
  assert.equal(projected.receipt.status, "PASS");
  assert.equal(projected.receipt.rowCount, rows.length);
  const canvas = projected.surface.components.find(component => component.component === "AtlasStage") ?? null;
  assert.equal(Boolean(canvas), fixture.canvas, `${fixture.id}: Canvas mismatch`);
  assert.equal(canvas?.nodes.length ?? 0, fixture.nodeCount, `${fixture.id}: node count mismatch`);
  assert.equal(canvas?.edges.length ?? 0, fixture.edgeCount, `${fixture.id}: edge count mismatch`);

  const request = validateInvocation({
    schema: app.contracts.invocation,
    id: `request.jsonl.${fixture.id}`,
    intent: "render",
    inputs: [{
      id: "surface",
      mediaType: "application/vnd.roccho.a2ui-surface+json",
      schema: "a2ui-surface/1",
      source: { kind: "inline", value: projected.surface },
    }],
    constraints: { allowedRuntimes: ["browser"], noUpload: true },
    expects: ["a2ui-render-receipt/1"],
  });
  const url = await encode({ base: stableBase, fragment: app.contracts.url.fragment, value: request });
  assert.ok(url.length <= app.contracts.url.maximumCharacters, `${fixture.id}: URL limit`);
  assert.deepEqual(await decode({ fragment: app.contracts.url.fragment, input: url }), request, `${fixture.id}: URL decode mismatch`);

  const labels = collectVisibleLabels(projected.surface);
  assert.ok(labels.length > 0, `${fixture.id}: no visible labels`);
  cases.push({
    id: fixture.id,
    source: {
      path: fixture.path,
      sha256: fixture.sha256,
      rowCount: rows.length,
      rowKinds: rows.map(row => row.type),
    },
    projection: {
      receipt: projected.receipt,
      surfaceSha256: digest(Buffer.from(canonicalJson(projected.surface))),
      canvas: fixture.canvas,
      nodeCount: fixture.nodeCount,
      edgeCount: fixture.edgeCount,
      labels,
    },
    invocation: {
      request,
      requestSha256: digest(Buffer.from(canonicalJson(request))),
    },
    url,
    urlLength: url.length,
    urlSha256: digest(Buffer.from(url)),
  });
}

const output = {
  schema: "ops.jsonlOnlyFourUrlCases/1",
  status: "PASS",
  authority: false,
  publication: {
    treeDigest: app.publication.treeDigest,
    kernelDigest: app.publication.kernelDigest,
    listedFiles: app.publication.listedFiles,
    appManifestSha256: digest(fs.readFileSync(appManifestPath)),
  },
  compiler: {
    inputSchema: app.contracts.jsonl.inputSchema,
    receiptSchema: app.contracts.jsonl.receiptSchema,
    operation: app.operations.compileJsonl,
    handwrittenSurfaceUsed: false,
    sourceCloneUsed: false,
    consumerBuildUsed: false,
    repairUsed: false,
  },
  stableBase,
  cases,
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ status: "PASS", urls: Object.fromEntries(cases.map(item => [item.id, item.url])) }));
