#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const invariant = (condition, message) => { if (!condition) throw new Error(`artifact-runtime-app-carry: ${message}`); };
const sha = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const readJson = target => JSON.parse(fs.readFileSync(target, "utf8"));

const [rootInput, appManifestInput, receiptInput] = process.argv.slice(2);
invariant(rootInput && appManifestInput && receiptInput, "usage: carry-smoke.mjs PUBLICATION_ROOT APP_MANIFEST RECEIPT");
const root = path.resolve(rootInput);
const appManifestPath = path.resolve(appManifestInput);
const receiptPath = path.resolve(receiptInput);
invariant(fs.statSync(root).isDirectory(), "publication root is missing");

const inside = relative => {
  invariant(typeof relative === "string" && relative.length > 0 && !path.isAbsolute(relative), "relative path is invalid");
  const target = path.resolve(root, relative);
  invariant(target === root || target.startsWith(`${root}${path.sep}`), `path escapes publication: ${relative}`);
  invariant(fs.statSync(target).isFile(), `publication file is missing: ${relative}`);
  return target;
};
const importFromApp = async descriptor => {
  invariant(descriptor && typeof descriptor === "object", "operation descriptor is missing");
  const modulePath = inside(descriptor.module);
  const loaded = await import(`${pathToFileURL(modulePath).href}?sha=${sha(fs.readFileSync(modulePath)).slice(7)}`);
  invariant(typeof loaded[descriptor.export] === "function", `operation export is missing: ${descriptor.export}`);
  return loaded[descriptor.export];
};

const app = readJson(appManifestPath);
invariant(app.schema === "ops.artifactRuntimeApp/1", "app manifest schema is unsupported");
invariant(app.status === "accepted-source" && app.authority === false, "app manifest status is invalid");
invariant(app.id === "artifact-runtime" && app.version === "1", "app identity is invalid");
invariant(app.carry.sourceCloneRequiredForUse === false, "source clone must not be required");
invariant(app.carry.consumerBuildRequired === false, "consumer build must not be required");
invariant(app.carry.repairAllowed === false, "repair must be forbidden");
invariant(app.contracts.jsonl?.inputSchema === "artifact-runtime-jsonl-surface/1", "JSONL input contract is invalid");
invariant(app.contracts.jsonl?.receiptSchema === "artifact-runtime-jsonl-surface-receipt/1", "JSONL receipt contract is invalid");
invariant(Array.isArray(app.contracts.jsonl.fixtures) && app.contracts.jsonl.fixtures.length === 4, "JSONL fixtures are incomplete");

const artifactManifestPath = inside(app.entrypoints.artifactManifest);
const catalogPath = inside(app.entrypoints.catalog);
const artifactManifest = readJson(artifactManifestPath);
const catalog = readJson(catalogPath);
invariant(artifactManifest.schema === "artifact-shell-publication-artifact/2", "artifact manifest schema is unsupported");
invariant(artifactManifest.treeDigest === app.publication.treeDigest, "publication tree digest differs from app manifest");
invariant(artifactManifest.files.length === app.publication.listedFiles, "listed file count differs from app manifest");
invariant(catalog.schema === "artifact-capability-catalog/2", "catalog schema is unsupported");
invariant(catalog.kernel.digest === app.publication.kernelDigest, "kernel digest differs from app manifest");
const capabilityIds = catalog.capabilities.map(entry => `${entry.capability.id}@${entry.capability.version}`);
assert.deepEqual(capabilityIds, app.publication.capabilities);

const createUrlModuleUrl = await importFromApp(app.operations.encode);
const readUrlModule = await importFromApp(app.operations.decode);
const validateArtifactInvocation = await importFromApp(app.operations.validateInvocation);
const createArtifactInvocationRuntime = await importFromApp(app.operations.execute);
const applyArtifactStateAction = await importFromApp(app.operations.applyAction);
const compileArtifactRuntimeJsonlSurface = await importFromApp(app.operations.compileJsonl);
const canonicalJson = await importFromApp({ module: app.entrypoints.codec, export: "canonicalJson" });
const actionModule = await import(pathToFileURL(inside(app.entrypoints.actionCompiler)).href);
invariant(typeof actionModule.createArtifactInvocationUrl === "function", "createArtifactInvocationUrl is missing");
invariant(actionModule.ARTIFACT_STATE_ACTION === app.contracts.action.name, "action name differs from app manifest");
invariant(actionModule.ARTIFACT_STATE_ACTION_SCHEMA === app.contracts.action.schema, "action schema differs from app manifest");

const manifests = [];
const engineBytes = new Map();
let appFixture = null;
for (const entry of catalog.capabilities) {
  const capabilityRoot = path.resolve(root, entry.root);
  invariant(capabilityRoot.startsWith(`${root}${path.sep}`), "capability root escapes publication");
  const publication = readJson(path.join(capabilityRoot, "manifest.json"));
  invariant(publication.schema === "artifact-capability-publication/2", "capability publication schema is unsupported");
  invariant(publication.releaseHash === entry.releaseHash, "capability release hash differs from catalog");
  const enginePath = path.join(capabilityRoot, "engine.mjs");
  const engineHref = `https://artifact-app.invalid/engines/${encodeURIComponent(publication.capability.id)}-${encodeURIComponent(publication.capability.version)}.mjs`;
  const bytes = fs.readFileSync(enginePath);
  invariant(publication.capability.engine.digest === sha(bytes), "capability engine digest mismatch");
  engineBytes.set(engineHref, bytes);
  manifests.push(Object.freeze({
    ...publication.capability,
    engine: Object.freeze({ ...publication.capability.engine, href: engineHref }),
  }));
  if (entry.capability.id === "render.a2ui.app") {
    invariant(publication.fixtures.pass.length === 1, "A2UI app pass fixture is not unique");
    const fixturePath = path.resolve(capabilityRoot, publication.fixtures.pass[0].href);
    invariant(fixturePath.startsWith(`${capabilityRoot}${path.sep}`), "fixture path escapes capability");
    appFixture = readJson(fixturePath);
  }
}
invariant(appFixture?.request, "A2UI app pass fixture is missing");

const runtime = await createArtifactInvocationRuntime({
  engineBaseUrl: "https://artifact-app.invalid/catalog.json",
  environment: Object.freeze({ runtime: "browser", features: Object.freeze(["crypto.subtle", "dom", "fetch", "file", "wasm", "worker"]) }),
  fetchEngine: async href => {
    const normalized = new URL(String(href));
    normalized.search = "";
    const bytes = engineBytes.get(normalized.href);
    return bytes
      ? new Response(bytes, { status: 200, headers: { "content-type": "text/javascript" } })
      : new Response("missing", { status: 404 });
  },
  fetchInput: async () => new Response("network input is forbidden in this proof", { status: 403 }),
  manifests: Object.freeze(manifests),
  runtimeBuild: catalog.kernel,
  services: Object.freeze({
    "a2ui.render": async ({ surface }) => Object.freeze({
      componentCount: surface.components.length,
      rootId: surface.rootId,
      schema: "a2ui-render-receipt/1",
      surfaceId: surface.surfaceId,
    }),
  }),
});

const initialRequest = validateArtifactInvocation(appFixture.request);
const initialOutcome = await runtime.execute({ request: initialRequest });
invariant(initialOutcome.result.status === "PASS", `initial carried execution did not pass: ${JSON.stringify(initialOutcome.result)}`);
invariant(initialOutcome.result.outputs.some(output => output.contract === "a2ui-app-render-receipt/1"), "initial app output is missing");
const appInput = initialRequest.inputs.find(input => input.schema === app.contracts.app);
invariant(appInput?.source?.kind === "inline", "app fixture is not inline");
const appValue = appInput.source.value;
invariant(appValue.state.count === 0, "initial app state is not zero");
const button = appValue.surface.components.find(component => component.action === app.contracts.action.name);
invariant(button, "state action button is missing");
const detail = Object.freeze({
  action: button.action,
  context: button.context,
  sourceComponentId: button.id,
  surfaceId: appValue.surface.surfaceId,
  version: "v0.9.1",
});
const compiled = applyArtifactStateAction({ detail, request: initialRequest });
invariant(compiled.request.inputs.find(input => input.id === appInput.id).source.value.state.count === 1, "compiled app state is not one");
invariant(compiled.history === "push", "compiled history mode is not push");

const base = "https://artifact-app.invalid/releases/exact/index.html";
const initialUrl = await actionModule.createArtifactInvocationUrl({ base, request: initialRequest });
const nextUrl = await actionModule.createArtifactInvocationUrl({ base: initialUrl, request: compiled.request });
invariant(initialUrl !== nextUrl, "state change did not change the URL");
invariant(nextUrl.length <= app.contracts.url.maximumCharacters, "compiled URL exceeds the app contract");
assert.deepEqual(await readUrlModule({ fragment: app.contracts.url.fragment, input: initialUrl }), initialRequest);
assert.deepEqual(await readUrlModule({ fragment: app.contracts.url.fragment, input: nextUrl }), compiled.request);
assert.equal(await createUrlModuleUrl({ base, fragment: app.contracts.url.fragment, value: compiled.request }), nextUrl);
const nextOutcome = await runtime.execute({ request: compiled.request });
invariant(nextOutcome.result.status === "PASS", `next carried execution did not pass: ${JSON.stringify(nextOutcome.result)}`);
invariant(nextOutcome.result.outputs.some(output => output.contract === "a2ui-app-render-receipt/1"), "next app output is missing");

const jsonlCases = [];
for (const fixture of app.contracts.jsonl.fixtures) {
  const fixturePath = inside(fixture.path);
  const jsonl = fs.readFileSync(fixturePath, "utf8");
  invariant(sha(Buffer.from(jsonl)) === fixture.sha256, `${fixture.id}: JSONL fixture digest mismatch`);
  const projected = compileArtifactRuntimeJsonlSurface({ jsonl });
  invariant(projected.receipt.schema === app.contracts.jsonl.receiptSchema, `${fixture.id}: JSONL receipt schema mismatch`);
  invariant(projected.receipt.status === "PASS" && projected.receipt.rowCount === 2, `${fixture.id}: JSONL projection failed`);
  const canvas = projected.surface.components.find(component => component.component === "AtlasStage") ?? null;
  invariant(Boolean(canvas) === fixture.canvas, `${fixture.id}: Canvas expectation mismatch`);
  invariant((canvas?.nodes.length ?? 0) === fixture.nodeCount, `${fixture.id}: node count mismatch`);
  invariant((canvas?.edges.length ?? 0) === fixture.edgeCount, `${fixture.id}: edge count mismatch`);

  const request = validateArtifactInvocation({
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
  const url = await createUrlModuleUrl({ base, fragment: app.contracts.url.fragment, value: request });
  invariant(url.length <= app.contracts.url.maximumCharacters, `${fixture.id}: URL exceeds contract`);
  assert.deepEqual(await readUrlModule({ fragment: app.contracts.url.fragment, input: url }), request);
  const outcome = await runtime.execute({ request });
  invariant(outcome.result.status === "PASS", `${fixture.id}: carried runtime execution failed`);
  invariant(outcome.result.outputs.some(output => output.contract === "a2ui-render-receipt/1"), `${fixture.id}: render output is missing`);
  jsonlCases.push(Object.freeze({
    id: fixture.id,
    status: "PASS",
    jsonlSha256: fixture.sha256,
    surfaceSha256: sha(Buffer.from(canonicalJson(projected.surface))),
    requestSha256: sha(Buffer.from(canonicalJson(request))),
    urlSha256: sha(Buffer.from(url)),
    urlCharacters: url.length,
    canvas: fixture.canvas,
    nodeCount: fixture.nodeCount,
    edgeCount: fixture.edgeCount,
    capability: "render.a2ui@1",
  }));
}

const receipt = Object.freeze({
  schema: "ops.artifactRuntimeAppCarryReceipt/2",
  status: "PASS",
  authority: false,
  app: Object.freeze({ id: app.id, version: app.version, manifestSha256: sha(fs.readFileSync(appManifestPath)) }),
  publication: Object.freeze({
    treeDigest: artifactManifest.treeDigest,
    artifactManifestSha256: sha(fs.readFileSync(artifactManifestPath)),
    catalogSha256: sha(fs.readFileSync(catalogPath)),
    kernelDigest: catalog.kernel.digest,
    capabilities: Object.freeze(capabilityIds),
  }),
  operations: Object.freeze({ encode: "PASS", decode: "PASS", execute: "PASS", applyAction: "PASS", compileJsonl: "PASS" }),
  roundTrip: Object.freeze({
    action: detail.action,
    history: compiled.history,
    initialCount: 0,
    nextCount: 1,
    initialUrlSha256: sha(Buffer.from(initialUrl)),
    nextUrlSha256: sha(Buffer.from(nextUrl)),
    nextUrlCharacters: nextUrl.length,
  }),
  jsonl: Object.freeze({
    inputSchema: app.contracts.jsonl.inputSchema,
    receiptSchema: app.contracts.jsonl.receiptSchema,
    sourceCloneUsed: false,
    sourceBuildUsed: false,
    handwrittenSurfaceUsed: false,
    cases: Object.freeze(jsonlCases),
  }),
  consumer: Object.freeze({ sourceCloneUsed: false, sourceBuildUsed: false, repairUsed: false }),
});
fs.writeFileSync(receiptPath, `${canonicalJson(receipt)}\n`, "utf8");
console.log(JSON.stringify(receipt));
