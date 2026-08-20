#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const APP_DEFINITION_SCHEMA = "artifact-app-definition/1";
const APP_SCHEMA = "artifact-app/1";
const APP_ARTIFACT_SCHEMA = "artifact-app-publication-artifact/1";
const invariant = (condition, message) => { if (!condition) throw new Error(`artifact-app: ${message}`); };
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const exactKeys = (value, required, optional, name) => {
  invariant(plain(value), `${name} must be a plain object`);
  const allowed = new Set([...required, ...optional]);
  for (const key of required) invariant(Object.hasOwn(value, key), `${name}.${key} is required`);
  for (const key of Object.keys(value)) invariant(allowed.has(key), `${name}.${key} is not allowed`);
};
const sha = bytes => `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
const stable = value => {
  if (Array.isArray(value)) return value.map(stable);
  if (plain(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  if (typeof value === "number" && Object.is(value, -0)) return 0;
  return value;
};
const canonical = value => JSON.stringify(stable(value));
const json = value => `${JSON.stringify(stable(value), null, 2)}\n`;
const readJson = target => JSON.parse(fs.readFileSync(target, "utf8"));
const writeJson = (target, value) => { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, json(value)); };
const token = (value, name, maximum = 128) => {
  invariant(typeof value === "string" && value.length > 0 && value.length <= maximum, `${name} is invalid`);
  invariant(/^[a-z0-9][a-z0-9._-]*$/u.test(value), `${name} is invalid`);
  return value;
};
const fullSha = (value, name) => {
  invariant(typeof value === "string" && /^[0-9a-f]{40}$/u.test(value), `${name} must be a full commit SHA`);
  return value;
};
const sha256 = (value, name) => {
  invariant(typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value), `${name} must be sha256:<64 lowercase hex>`);
  return value;
};
const safeRelative = (value, name) => {
  invariant(typeof value === "string" && value.length > 0 && value.length <= 512, `${name} is invalid`);
  const normalized = value.replaceAll("\\", "/");
  invariant(!normalized.startsWith("/") && !normalized.split("/").some(part => !part || part === "." || part === ".."), `${name} is unsafe`);
  return normalized;
};

const normalizeDefinition = value => {
  exactKeys(value, ["action", "codec", "defaultInvocation", "fixtures", "id", "runtime", "schema", "sourceAuthorities", "title", "version"], [], "definition");
  invariant(value.schema === APP_DEFINITION_SCHEMA, `definition.schema must be ${APP_DEFINITION_SCHEMA}`);
  token(value.id, "definition.id"); token(value.version, "definition.version", 64);
  invariant(typeof value.title === "string" && value.title.length > 0 && value.title.length <= 160, "definition.title is invalid");
  exactKeys(value.runtime, ["publicationManifest", "requiredCapabilities"], [], "definition.runtime");
  safeRelative(value.runtime.publicationManifest, "definition.runtime.publicationManifest");
  invariant(Array.isArray(value.runtime.requiredCapabilities) && value.runtime.requiredCapabilities.length > 0, "definition.runtime.requiredCapabilities is empty");
  const requiredCapabilities = value.runtime.requiredCapabilities.map((item, index) => {
    exactKeys(item, ["id", "version"], [], `definition.runtime.requiredCapabilities[${index}]`);
    return Object.freeze({ id: token(item.id, `requiredCapabilities[${index}].id`), version: token(item.version, `requiredCapabilities[${index}].version`, 64) });
  });
  invariant(new Set(requiredCapabilities.map(item => `${item.id}@${item.version}`)).size === requiredCapabilities.length, "required capabilities contain duplicates");
  exactKeys(value.codec, ["fragment", "invocationSchema"], [], "definition.codec");
  invariant(value.codec.fragment === "invoke" && value.codec.invocationSchema === "artifact-invocation/2", "definition.codec is unsupported");
  exactKeys(value.action, ["contextSchema", "event", "history", "name", "version"], [], "definition.action");
  invariant(value.action.event === "a2ui-client-action" && value.action.name === "artifact.invoke" && value.action.contextSchema === "artifact-app-action/1" && value.action.history === "push", "definition.action is unsupported");
  invariant(/^v[0-9]+\.[0-9]+\.[0-9]+$/u.test(value.action.version), "definition.action.version is unsupported");
  exactKeys(value.fixtures, ["execute"], [], "definition.fixtures");
  safeRelative(value.fixtures.execute, "definition.fixtures.execute");
  invariant(Array.isArray(value.sourceAuthorities) && value.sourceAuthorities.length >= 2, "definition.sourceAuthorities must contain at least two entries");
  const sourceAuthorities = value.sourceAuthorities.map((item, index) => {
    exactKeys(item, ["carry", "repository", "role"], ["commit", "commitBinding", "paths", "tree"], `sourceAuthorities[${index}]`);
    invariant(/^[-A-Za-z0-9_.]+\/[-A-Za-z0-9_.]+$/u.test(item.repository), `sourceAuthorities[${index}].repository is invalid`);
    invariant(typeof item.role === "string" && item.role.length > 0, `sourceAuthorities[${index}].role is invalid`);
    invariant(Boolean(item.commit) !== Boolean(item.commitBinding), `sourceAuthorities[${index}] requires exactly one commit identity`);
    if (item.commit) fullSha(item.commit, `sourceAuthorities[${index}].commit`);
    if (item.tree) fullSha(item.tree, `sourceAuthorities[${index}].tree`);
    if (item.commitBinding) invariant(item.commitBinding === "release.target", `sourceAuthorities[${index}].commitBinding is unsupported`);
    if (item.paths) {
      invariant(Array.isArray(item.paths) && item.paths.length > 0, `sourceAuthorities[${index}].paths is invalid`);
      item.paths.forEach((entry, position) => safeRelative(entry, `sourceAuthorities[${index}].paths[${position}]`));
    }
    exactKeys(item.carry, ["identity", "kind"], [], `sourceAuthorities[${index}].carry`);
    invariant(item.carry.kind === "repo-head", `sourceAuthorities[${index}].carry.kind is unsupported`);
    invariant(["commit", "release.target"].includes(item.carry.identity), `sourceAuthorities[${index}].carry.identity is unsupported`);
    return stable(item);
  });
  return stable({ ...value, runtime: { ...value.runtime, requiredCapabilities }, sourceAuthorities });
};

const listFiles = root => {
  const result = [];
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const target = path.join(directory, entry.name);
      const stat = fs.lstatSync(target);
      invariant(!stat.isSymbolicLink(), `symlink is forbidden: ${target}`);
      if (stat.isDirectory()) walk(target);
      else {
        invariant(stat.isFile(), `non-file entry is forbidden: ${target}`);
        result.push(target);
      }
    }
  };
  walk(root);
  return result;
};
const descriptor = (root, target) => {
  const bytes = fs.readFileSync(target);
  return Object.freeze({ bytes: bytes.length, path: path.relative(root, target).split(path.sep).join("/"), sha256: sha(bytes) });
};
const verifyDescriptorSet = (root, manifest, { includeManifest = false } = {}) => {
  invariant(Array.isArray(manifest.files), "manifest.files is invalid");
  const expected = [...manifest.files].sort((a, b) => a.path.localeCompare(b.path));
  const actualTargets = listFiles(root).filter(target => includeManifest || path.basename(target) !== "artifact-manifest.json");
  const actual = actualTargets.map(target => descriptor(root, target)).sort((a, b) => a.path.localeCompare(b.path));
  invariant(canonical(actual) === canonical(expected), "artifact file inventory or digest mismatch");
  const treeDigest = sha(Buffer.from(canonical(expected)));
  invariant(treeDigest === manifest.treeDigest, "artifact tree digest mismatch");
  return Object.freeze({ files: actual, treeDigest });
};
const copyTree = (source, destination) => {
  invariant(path.resolve(source) !== path.resolve(destination), "source and destination must differ");
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  for (const target of listFiles(source)) {
    const relative = path.relative(source, target);
    const output = path.join(destination, relative);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.copyFileSync(target, output);
  }
};
const stripAutoBoot = source => {
  const marker = '\nif (globalThis.location?.protocol === "http:" || globalThis.location?.protocol === "https:") {';
  const offset = source.indexOf(marker);
  invariant(offset > 0 && source.indexOf(marker, offset + marker.length) === -1, "runtime entry auto-boot boundary is missing or ambiguous");
  return `${source.slice(0, offset).trimEnd()}\n`;
};
const runtimeInfo = root => {
  const catalog = readJson(path.join(root, "catalog.json"));
  invariant(catalog.schema === "artifact-capability-catalog/2", "runtime catalog schema is unsupported");
  sha256(catalog.kernel?.digest, "runtime catalog kernel digest");
  const kernelId = catalog.kernel.digest.slice("sha256:".length);
  const moduleRoot = path.join(root, "kernel", kernelId);
  invariant(fs.existsSync(path.join(moduleRoot, "packages", "url-module", "src", "index.mjs")), "runtime URL codec is missing");
  invariant(fs.existsSync(path.join(moduleRoot, "packages", "artifact-invocation", "src", "index.mjs")), "runtime invocation contract is missing");
  return Object.freeze({ catalog, kernelId, moduleRoot });
};
const importRuntimeModules = async root => {
  const info = runtimeInfo(root);
  const codec = await import(`${pathToFileURL(path.join(info.moduleRoot, "packages", "url-module", "src", "index.mjs")).href}?v=${Date.now()}`);
  const invocation = await import(`${pathToFileURL(path.join(info.moduleRoot, "packages", "artifact-invocation", "src", "index.mjs")).href}?v=${Date.now()}`);
  return Object.freeze({ ...info, codec, invocation });
};

const actionFixture = (definition, defaultInvocation) => {
  const surfaces = defaultInvocation.inputs.filter(input => input.schema === "a2ui-surface/1" && input.source.kind === "inline");
  invariant(surfaces.length === 1, "default invocation must contain one inline A2UI surface");
  const surface = surfaces[0].source.value;
  invariant(plain(surface) && Array.isArray(surface.components) && typeof surface.surfaceId === "string", "default A2UI surface is invalid");
  const buttons = surface.components.filter(component => plain(component) && component.component === "Button" && component.action === definition.action.name);
  invariant(buttons.length === 1, "default A2UI surface must contain one app action Button");
  const button = buttons[0];
  return stable({
    action: button.action,
    context: button.context,
    sourceComponentId: button.id,
    surfaceId: surface.surfaceId,
    version: definition.action.version,
  });
};

const appEntrySource = kernelId => `import { bootPublishedArtifactShell } from "./runtime-entry.mjs";
import { createArtifactAppController } from "./app/controller.mjs";
import { createUrlModuleUrl, readUrlModule } from "./kernel/${kernelId}/packages/url-module/src/index.mjs";
import { validateArtifactInvocation } from "./kernel/${kernelId}/packages/artifact-invocation/src/index.mjs";

const invariant = (condition, message) => { if (!condition) throw new Error(\`artifact-app-entry: \${message}\`); };
const response = await fetch(new URL("./app.manifest.json", import.meta.url), { cache: "force-cache", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
invariant(response.ok, \`app manifest fetch failed: \${response.status}\`);
const app = await response.json();
const shell = await bootPublishedArtifactShell();
const controller = createArtifactAppController({ app, createUrlModuleUrl, readUrlModule, scope: globalThis, shell, validateArtifactInvocation });
globalThis.artifactApp = controller;
await controller.boot();
`;

const build = async ({ definitionFile, runtimeDir, runtimeManifestFile, outDir, controllerFile }) => {
  invariant(!fs.existsSync(outDir), `output exists: ${outDir}`);
  const definition = normalizeDefinition(readJson(definitionFile));
  const runtimeBinding = readJson(runtimeManifestFile);
  invariant(runtimeBinding.schema === "ops.artifactRuntimePublication/1" && runtimeBinding.status === "accepted-source", "runtime publication binding is unsupported");
  const runtimeArtifact = readJson(path.join(runtimeDir, "artifact-manifest.json"));
  invariant(runtimeArtifact.schema === "artifact-shell-publication-artifact/2", "runtime artifact schema is unsupported");
  invariant(runtimeArtifact.treeDigest === runtimeBinding.publication.treeDigest, "runtime tree does not match binding");
  verifyDescriptorSet(runtimeDir, runtimeArtifact);
  const modules = await importRuntimeModules(runtimeDir);
  const defaultInvocation = modules.invocation.validateArtifactInvocation(definition.defaultInvocation);
  const actualCapabilities = new Set(modules.catalog.capabilities.map(entry => `${entry.capability.id}@${entry.capability.version}`));
  for (const required of definition.runtime.requiredCapabilities) invariant(actualCapabilities.has(`${required.id}@${required.version}`), `required capability is missing: ${required.id}@${required.version}`);

  copyTree(runtimeDir, outDir);
  fs.renameSync(path.join(outDir, "artifact-manifest.json"), path.join(outDir, "runtime-artifact-manifest.json"));
  const runtimeEntry = fs.readFileSync(path.join(outDir, "entry.mjs"), "utf8");
  fs.writeFileSync(path.join(outDir, "runtime-entry.mjs"), stripAutoBoot(runtimeEntry));
  fs.mkdirSync(path.join(outDir, "app", "bin"), { recursive: true });
  fs.mkdirSync(path.join(outDir, "app", "fixtures"), { recursive: true });
  fs.copyFileSync(fileURLToPath(import.meta.url), path.join(outDir, "app", "bin", "artifact-app.mjs"));
  fs.copyFileSync(controllerFile, path.join(outDir, "app", "controller.mjs"));
  writeJson(path.join(outDir, "app", "fixtures", "default-invocation.json"), defaultInvocation);
  writeJson(path.join(outDir, "app", "fixtures", "action.json"), actionFixture(definition, defaultInvocation));
  const executeFixture = modules.invocation.validateArtifactInvocation(readJson(definition.fixtures.execute));
  writeJson(path.join(outDir, "app", "fixtures", "execute.json"), executeFixture);

  const app = stable({
    action: definition.action,
    codec: definition.codec,
    defaultInvocation,
    fixtures: {
      action: "app/fixtures/action.json",
      defaultInvocation: "app/fixtures/default-invocation.json",
      execute: "app/fixtures/execute.json",
    },
    id: definition.id,
    interfaces: { agent: "app/bin/artifact-app.mjs", browser: "index.html" },
    runtime: {
      capabilities: definition.runtime.requiredCapabilities,
      kernel: modules.catalog.kernel,
      publication: {
        archive: runtimeBinding.publication.archive,
        carrier: runtimeBinding.publication.carrier,
        source: runtimeBinding.source,
        tag: runtimeBinding.publication.tag,
        treeDigest: runtimeBinding.publication.treeDigest
      }
    },
    schema: APP_SCHEMA,
    sourceAuthorities: definition.sourceAuthorities,
    title: definition.title,
    version: definition.version,
  });
  writeJson(path.join(outDir, "app.manifest.json"), app);
  fs.writeFileSync(path.join(outDir, "entry.mjs"), appEntrySource(modules.kernelId));
  const files = listFiles(outDir).filter(target => path.basename(target) !== "artifact-manifest.json").map(target => descriptor(outDir, target)).sort((a, b) => a.path.localeCompare(b.path));
  const treeDigest = sha(Buffer.from(canonical(files)));
  const artifactManifest = stable({
    app: { id: app.id, version: app.version },
    files,
    runtimeTreeDigest: runtimeBinding.publication.treeDigest,
    schema: APP_ARTIFACT_SCHEMA,
    treeDigest,
  });
  writeJson(path.join(outDir, "artifact-manifest.json"), artifactManifest);
  return verifyApp(outDir);
};

const verifyApp = async root => {
  const manifest = readJson(path.join(root, "artifact-manifest.json"));
  invariant(manifest.schema === APP_ARTIFACT_SCHEMA, "app artifact schema is unsupported");
  const checked = verifyDescriptorSet(root, manifest);
  const runtimeManifest = readJson(path.join(root, "runtime-artifact-manifest.json"));
  invariant(runtimeManifest.schema === "artifact-shell-publication-artifact/2", "embedded runtime manifest schema is unsupported");
  const app = readJson(path.join(root, "app.manifest.json"));
  invariant(app.schema === APP_SCHEMA && app.id === manifest.app.id && app.version === manifest.app.version, "app identity mismatch");
  invariant(app.runtime.publication.treeDigest === manifest.runtimeTreeDigest, "runtime tree binding mismatch");
  exactKeys(app.interfaces, ["agent", "browser"], [], "app.interfaces");
  for (const [name, relative] of Object.entries(app.interfaces)) invariant(fs.existsSync(path.join(root, safeRelative(relative, `app.interfaces.${name}`))), `app interface is missing: ${name}`);
  exactKeys(app.fixtures, ["action", "defaultInvocation", "execute"], [], "app.fixtures");
  for (const [name, relative] of Object.entries(app.fixtures)) invariant(fs.existsSync(path.join(root, safeRelative(relative, `app.fixtures.${name}`))), `app fixture is missing: ${name}`);
  const modules = await importRuntimeModules(root);
  modules.invocation.validateArtifactInvocation(app.defaultInvocation);
  invariant(canonical(readJson(path.join(root, app.fixtures.defaultInvocation))) === canonical(app.defaultInvocation), "default invocation fixture mismatch");
  modules.invocation.validateArtifactInvocation(readJson(path.join(root, app.fixtures.execute)));
  const entry = fs.readFileSync(path.join(root, "entry.mjs"), "utf8");
  invariant(entry.includes("createArtifactAppController") && entry.includes("controller.boot()"), "app entry is incomplete");
  invariant(!fs.readFileSync(path.join(root, "runtime-entry.mjs"), "utf8").includes("bootPublishedArtifactShell().catch"), "runtime entry still auto-boots");
  return Object.freeze({ app: `${app.id}@${app.version}`, files: checked.files.length, runtimeTreeDigest: manifest.runtimeTreeDigest, schema: "artifact-app-verification/1", status: "PASS", treeDigest: checked.treeDigest });
};

const loadApp = root => {
  const app = readJson(path.join(root, "app.manifest.json"));
  invariant(app.schema === APP_SCHEMA, "app manifest schema is unsupported");
  return app;
};
const encode = async ({ base, requestFile, root }) => {
  await verifyApp(root);
  const app = loadApp(root);
  const modules = await importRuntimeModules(root);
  const request = modules.invocation.validateArtifactInvocation(readJson(requestFile));
  const url = await modules.codec.createUrlModuleUrl({ base, fragment: app.codec.fragment, value: request });
  return Object.freeze({ request, schema: "artifact-app-encode/1", status: "PASS", url });
};
const decode = async ({ root, url }) => {
  await verifyApp(root);
  const app = loadApp(root);
  const modules = await importRuntimeModules(root);
  const value = await modules.codec.readUrlModule({ fragment: app.codec.fragment, input: url });
  invariant(value !== null, "URL does not contain an invocation");
  return Object.freeze({ request: modules.invocation.validateArtifactInvocation(value), schema: "artifact-app-decode/1", status: "PASS" });
};
const localManifests = async (root, catalog) => Promise.all(catalog.capabilities.map(async entry => {
  const publicationRoot = path.join(root, ...entry.root.split("/"));
  const publication = readJson(path.join(publicationRoot, "manifest.json"));
  return stable({
    ...publication.capability,
    engine: { ...publication.capability.engine, href: `./${entry.root}/engine.mjs` },
  });
}));
const execute = async ({ requestFile, root }) => {
  await verifyApp(root);
  const modules = await importRuntimeModules(root);
  const manifests = await localManifests(root, modules.catalog);
  const runtime = await modules.invocation.createArtifactInvocationRuntime({
    engineBaseUrl: pathToFileURL(path.join(root, "catalog.json")).href,
    environment: { features: ["crypto.subtle"], runtime: "node" },
    fetchEngine: async href => {
      const url = new URL(href); invariant(url.protocol === "file:", "local execute only accepts carried engines");
      return new Response(fs.readFileSync(fileURLToPath(url)), { headers: { "content-type": "text/javascript" } });
    },
    fetchInput: async href => {
      const url = new URL(href);
      if (url.protocol === "file:") return new Response(fs.readFileSync(fileURLToPath(url)));
      invariant(url.protocol === "https:", "input URL is unsupported");
      return fetch(url.href, { redirect: "error" });
    },
    manifests,
    runtimeBuild: modules.catalog.kernel,
  });
  const outcome = await runtime.execute({ request: readJson(requestFile) });
  return Object.freeze({ outcome, schema: "artifact-app-execute/1", status: outcome.result.status });
};
const applyAction = async ({ base, detailFile, root }) => {
  await verifyApp(root);
  const app = loadApp(root);
  const modules = await importRuntimeModules(root);
  const controllerModule = await import(`${pathToFileURL(path.join(root, "app", "controller.mjs")).href}?v=${Date.now()}`);
  const listeners = new Map();
  const scope = {
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: name => listeners.delete(name),
    history: {
      pushState: (_state, _title, href) => { scope.location.href = String(href); },
      replaceState: (_state, _title, href) => { scope.location.href = String(href); },
    },
    location: { href: base },
  };
  let executed = null;
  const shell = { execute: async request => { executed = modules.invocation.validateArtifactInvocation(request); return Object.freeze({ result: Object.freeze({ status: "PASS" }) }); } };
  const controller = controllerModule.createArtifactAppController({ app, createUrlModuleUrl: modules.codec.createUrlModuleUrl, readUrlModule: modules.codec.readUrlModule, scope, shell, validateArtifactInvocation: modules.invocation.validateArtifactInvocation });
  const result = await controller.applyAction(readJson(detailFile));
  invariant(executed?.id === result.next.id, "compiled invocation was not executed");
  controller.dispose();
  return Object.freeze({ next: result.next, schema: "artifact-app-apply-action/1", status: "PASS", url: result.url });
};
const normalizePublication = (value, publicationFile) => {
  invariant(value.schema === "ops.artifactAppPublication/1" && value.status === "accepted-source", "app publication binding is unsupported");
  invariant(value.authority === false, "app publication must be non-authority");
  sha256(value.publication.treeDigest, "publication.treeDigest");
  sha256(value.publication.archive.sha256, "publication.archive.sha256");
  sha256(value.publication.carrier.sha256, "publication.carrier.sha256");
  invariant(typeof value.publication.tag === "string" && value.publication.tag.length > 0, "publication.tag is invalid");
  invariant(typeof value.publication.manifest?.name === "string" && /^[A-Za-z0-9._-]+$/u.test(value.publication.manifest.name), "publication manifest name is invalid");
  invariant(typeof value.publication.manifest?.url === "string" && value.publication.manifest.url.startsWith("https://"), "publication manifest URL is invalid");
  return value;
};
const sourcePlan = ({ publicationFile, root }) => {
  const app = loadApp(root);
  const artifact = readJson(path.join(root, "artifact-manifest.json"));
  const publication = normalizePublication(readJson(publicationFile), publicationFile);
  invariant(publication.app.id === app.id && publication.app.version === app.version, "publication app identity mismatch");
  invariant(publication.publication.treeDigest === artifact.treeDigest, "publication tree does not match carried app");
  const sources = app.sourceAuthorities.map(source => stable({
    carry: source.carry,
    identity: source.commit
      ? { commit: source.commit, kind: "commit", tree: source.tree ?? null }
      : { kind: "release-target", tag: publication.publication.tag },
    paths: source.paths ?? null,
    repository: source.repository,
    role: source.role,
  }));
  return Object.freeze({ app: `${app.id}@${app.version}`, publicationTag: publication.publication.tag, schema: "artifact-app-source-plan/1", sources, status: "PASS" });
};
const carryRequest = ({ publicationFile }) => {
  const bytes = fs.readFileSync(publicationFile);
  const publication = normalizePublication(JSON.parse(bytes), publicationFile);
  return Object.freeze({
    carrier_name: publication.publication.carrier.name,
    payload_sha256: publication.publication.archive.sha256.slice("sha256:".length),
    request_id: `artifact-app-${publication.publication.treeDigest.slice("sha256:".length, 20)}`,
    schema: "carrier-job/1",
    sources: [
      Object.freeze({ name: publication.publication.carrier.name, sha256: publication.publication.carrier.sha256.slice("sha256:".length), url: publication.publication.carrier.url }),
      Object.freeze({ name: publication.publication.manifest.name, sha256: sha(bytes).slice("sha256:".length), url: publication.publication.manifest.url }),
    ],
  });
};
const sourceCarryRequest = ({ publicationFile, role }) => {
  const bytes = fs.readFileSync(publicationFile);
  const publication = normalizePublication(JSON.parse(bytes), publicationFile);
  invariant(typeof role === "string" && publication.sources.some(source => source.role === role), "source role is unknown");
  return Object.freeze({
    app: `${publication.app.id}@${publication.app.version}`,
    manifest: Object.freeze({ name: publication.publication.manifest.name, sha256: sha(bytes).slice("sha256:".length), url: publication.publication.manifest.url }),
    publicationTag: publication.publication.tag,
    request_id: `artifact-app-source-${role}-${publication.publication.treeDigest.slice("sha256:".length, 16)}`,
    role,
    schema: "artifact-app-source-carry/1",
  });
};

const parse = (args, names) => {
  const result = {};
  while (args.length) {
    const key = args.shift(); const value = args.shift();
    invariant(names.includes(key) && value !== undefined && !Object.hasOwn(result, key), "invalid options");
    result[key] = value;
  }
  for (const name of names) invariant(Object.hasOwn(result, name), `missing ${name}`);
  return result;
};
const main = async () => {
  const [command, ...args] = process.argv.slice(2);
  if (command === "build") {
    const options = parse(args, ["--definition", "--runtime-dir", "--runtime-manifest", "--controller", "--out"]);
    console.log(JSON.stringify(await build({ controllerFile: options["--controller"], definitionFile: options["--definition"], outDir: options["--out"], runtimeDir: options["--runtime-dir"], runtimeManifestFile: options["--runtime-manifest"] })));
    return;
  }
  if (command === "verify") { const o = parse(args, ["--input"]); console.log(JSON.stringify(await verifyApp(o["--input"]))); return; }
  if (command === "encode") { const o = parse(args, ["--input", "--request", "--base"]); console.log(JSON.stringify(await encode({ base: o["--base"], requestFile: o["--request"], root: o["--input"] }))); return; }
  if (command === "decode") { const o = parse(args, ["--input", "--url"]); console.log(JSON.stringify(await decode({ root: o["--input"], url: o["--url"] }))); return; }
  if (command === "execute") { const o = parse(args, ["--input", "--request"]); console.log(JSON.stringify(await execute({ requestFile: o["--request"], root: o["--input"] }))); return; }
  if (command === "apply-action") { const o = parse(args, ["--input", "--detail", "--base"]); console.log(JSON.stringify(await applyAction({ base: o["--base"], detailFile: o["--detail"], root: o["--input"] }))); return; }
  if (command === "source-plan") { const o = parse(args, ["--input", "--publication"]); console.log(JSON.stringify(sourcePlan({ publicationFile: o["--publication"], root: o["--input"] }))); return; }
  if (command === "carry-request") { const o = parse(args, ["--publication"]); console.log(JSON.stringify(carryRequest({ publicationFile: o["--publication"] }))); return; }
  if (command === "source-carry-request") { const o = parse(args, ["--publication", "--role"]); console.log(JSON.stringify(sourceCarryRequest({ publicationFile: o["--publication"], role: o["--role"] }))); return; }
  throw new Error("usage: artifact-app build|verify|encode|decode|execute|apply-action|source-plan|carry-request|source-carry-request ...");
};
main().catch(error => { console.error(`artifact-app: ${error.message}`); process.exit(1); });
