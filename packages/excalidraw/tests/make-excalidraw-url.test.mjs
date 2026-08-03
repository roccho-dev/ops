import assert from "node:assert/strict";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const moduleUrl = pathToFileURL(resolve(repoRoot, "dist/excalidraw/make-excalidraw-url.mjs")).href;
const tool = await import(`${moduleUrl}?test=1`);

test("dist URL generator exposes one capability", () => {
  assert.deepEqual(tool.manifest.entrypoints, ["run", "makeExcalidrawUrl"]);
  assert.equal(tool.manifest.externalDependencies.length, 0);
});

test("dist URL generator emits the official #url form", () => {
  const scene = "https://raw.githubusercontent.com/roccho-dev/ops/COMMIT/dist/excalidraw/example.excalidraw";
  const expected = `https://excalidraw.com/#url=${encodeURIComponent(scene)}`;
  assert.equal(tool.makeExcalidrawUrl(scene), expected);
  assert.equal(tool.run({ publicSceneUrl: scene }), expected);
});

test("dist URL generator rejects missing input", () => {
  assert.throws(() => tool.makeExcalidrawUrl(""), /non-empty string/);
});
