import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run as bundle } from "../../dist/mjs-bundler/bundle.mjs";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageRoot, "../..");
const sourceRoot = path.join(packageRoot, "src");

const outputs = Object.freeze([
  {
    entry: "src/html-to-excalidraw/index.mjs",
    output: "dist/excalidraw/html-to-excalidraw.mjs",
  },
  {
    entry: "src/make-excalidraw-url/index.mjs",
    output: "dist/excalidraw/make-excalidraw-url.mjs",
  },
]);

function modulesBelow(directory, out = {}) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) modulesBelow(absolute, out);
    else if (entry.isFile() && entry.name.endsWith(".mjs")) {
      const id = path.relative(packageRoot, absolute).split(path.sep).join("/");
      out[id] = fs.readFileSync(absolute, "utf8");
    }
  }
  return out;
}

export async function buildAll({ write = true, check = false } = {}) {
  const modules = modulesBelow(sourceRoot);
  const result = {};
  for (const item of outputs) {
    const code = await bundle({ operation: "bundle", entry: item.entry, modules });
    const output = path.join(repoRoot, item.output);
    if (check) {
      if (!fs.existsSync(output) || fs.readFileSync(output, "utf8") !== code) {
        throw new Error(`stale committed dist: ${item.output}`);
      }
    }
    if (write) {
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, code, "utf8");
    }
    result[item.output] = Buffer.byteLength(code);
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  const result = await buildAll({ write: !check, check });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
