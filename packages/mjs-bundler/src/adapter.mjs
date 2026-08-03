const ENGINE = __rollupModule.exports;
const rollup = ENGINE.rollup;

if (typeof rollup !== "function") {
  throw new Error("Rollup browser engine did not expose rollup()");
}

export const manifest = Object.freeze({
  id: "urn:roccho-dev:ops:dist:mjs-bundler:rollup",
  version: "0.1.0",
  engine: "rollup",
  engineVersion: "2.80.0",
  runtime: "browser-node",
  externalDependencies: [],
  sideAssets: [],
  entrypoints: ["bundle", "run", "manifest"]
});

function normalizeId(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError("module id must be a non-empty string");
  }
  if (value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) {
    throw new Error(`absolute or backslash module id is unsupported: ${value}`);
  }
  const parts = [];
  for (const part of value.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) throw new Error(`module id escapes root: ${value}`);
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  if (!parts.length) throw new Error(`invalid module id: ${value}`);
  return parts.join("/");
}

function resolveRelative(source, importer) {
  if (!source.startsWith(".")) {
    throw new Error(`bare or external import is unsupported: ${source}`);
  }
  const base = importer.split("/").slice(0, -1).join("/");
  return normalizeId(`${base}/${source}`);
}

function validateModules(modules) {
  if (!modules || typeof modules !== "object" || Array.isArray(modules)) {
    throw new TypeError("modules must be an object keyed by module id");
  }
  const normalized = new Map();
  for (const [id, source] of Object.entries(modules)) {
    const normalizedId = normalizeId(id);
    if (normalized.has(normalizedId)) throw new Error(`duplicate module id: ${normalizedId}`);
    if (typeof source !== "string") throw new TypeError(`module source must be text: ${normalizedId}`);
    normalized.set(normalizedId, source);
  }
  return normalized;
}

export async function bundle(request) {
  if (!request || typeof request !== "object") throw new TypeError("request must be an object");
  const modules = validateModules(request.modules);
  const entry = normalizeId(request.entry);
  if (!modules.has(entry)) throw new Error(`entry module is missing: ${entry}`);

  const virtualModules = {
    name: "ops-virtual-modules",
    resolveId(source, importer) {
      if (!importer) return normalizeId(source);
      return resolveRelative(source, importer);
    },
    load(id) {
      if (!modules.has(id)) throw new Error(`module is missing: ${id}`);
      return modules.get(id);
    }
  };

  const build = await rollup({
    input: entry,
    plugins: [virtualModules],
    treeshake: true,
    onwarn(warning) {
      throw new Error(`Rollup warning is rejected: ${warning.code}: ${warning.message}`);
    }
  });

  try {
    const generated = await build.generate({
      format: "es",
      inlineDynamicImports: true,
      sourcemap: false,
      exports: "named"
    });
    const chunks = generated.output.filter((item) => item.type === "chunk");
    const assets = generated.output.filter((item) => item.type === "asset");
    if (chunks.length !== 1 || assets.length !== 0 || generated.output.length !== 1) {
      throw new Error("bundle must produce exactly one JavaScript chunk and no assets");
    }
    return chunks[0].code;
  } finally {
    await build.close();
  }
}

export async function run(request) {
  if (!request || request.operation !== "bundle") {
    throw new Error(`unsupported operation: ${String(request?.operation)}`);
  }
  return bundle(request);
}
