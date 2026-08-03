import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const REPOSITORY = "roccho-dev/ops";
const REF = "a".repeat(40);
const indexText = fs.readFileSync("dist/index.jsonl", "utf8");

function invoke(command, { args = [], request } = {}) {
  const options = { encoding: "utf8" };
  if (request !== undefined) options.input = JSON.stringify(request);
  return JSON.parse(execFileSync("dist-runner", [command, ...args], options));
}

function reject(command, options = {}) {
  try {
    invoke(command, options);
  } catch (error) {
    const stderr = String(error.stderr ?? "").trim();
    assert.ok(stderr, `missing error payload for ${command}`);
    return JSON.parse(stderr);
  }
  throw new Error(`expected ${command} to fail`);
}

function resolve(query, ref = REF, text = indexText) {
  return invoke("resolve", {
    request: {
      indexText: text,
      kind: "ops.distResolve.request.v1",
      query,
      ref,
      repository: REPOSITORY,
    },
  });
}

function identity(data) {
  return {
    bytes: data.length,
    gitBlobSha1: crypto
      .createHash("sha1")
      .update(Buffer.concat([Buffer.from(`blob ${data.length}\0`), data]))
      .digest("hex"),
    sha256: crypto.createHash("sha256").update(data).digest("hex"),
  };
}

function connector(plan, data = fs.readFileSync(plan.entry.path)) {
  const encoding = plan.entry.executor === "python-zipapp" ? "base64" : "utf-8";
  return {
    content: encoding === "base64" ? data.toString("base64") : data.toString("utf8"),
    encoding,
    sha: identity(data).gitBlobSha1,
  };
}

function run(plan, input, envelope = connector(plan)) {
  return invoke("run", {
    request: {
      connector: envelope,
      input,
      kind: "ops.distRun.request.v1",
      plan,
      timeoutSeconds: 120,
    },
  });
}

function fixtureRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dist-runner-e2e-"));
  fs.mkdirSync(path.join(root, "packages"), { recursive: true });
  for (const entry of fs.readdirSync("packages", { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const source = path.join("packages", entry.name, "dist.json");
    if (!fs.existsSync(source)) continue;
    const destination = path.join(root, source);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
  fs.cpSync("dist", path.join(root, "dist"), { recursive: true, dereference: false });
  return root;
}

function withFixture(mutator, expectedCodes) {
  const root = fixtureRepo();
  try {
    mutator(root);
    const failure = reject("audit", { args: ["--repo-root", root] });
    assert.ok(expectedCodes.includes(failure.error?.code), JSON.stringify(failure));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const audit = invoke("audit", { args: ["--repo-root", "."] });
assert.equal(audit.ok, true);
assert.equal(audit.entryCount, 4);
assert.equal(audit.declaredArtifactCount, 5);

const beforeIndex = fs.readFileSync("dist/index.jsonl");
const firstWrite = invoke("index", { args: ["--repo-root", ".", "--write"] });
const middleIndex = fs.readFileSync("dist/index.jsonl");
const secondWrite = invoke("index", { args: ["--repo-root", ".", "--write"] });
const afterIndex = fs.readFileSync("dist/index.jsonl");
assert.deepEqual(beforeIndex, middleIndex);
assert.deepEqual(middleIndex, afterIndex);
assert.equal(firstWrite.sha256, secondWrite.sha256);

assert.equal(resolve("jsonl").entry.name, "jsonl-inspect");
assert.equal(resolve("mjs*").entry.name, "mjs-bundler");
assert.equal(resolve("excalidraw-url").entry.name, "make-excalidraw-url");
assert.equal(reject("resolve", {
  request: {
    indexText,
    kind: "ops.distResolve.request.v1",
    query: "*",
    ref: REF,
    repository: REPOSITORY,
  },
}).error.code, "ambiguous-query");
assert.equal(reject("resolve", {
  request: {
    indexText,
    kind: "ops.distResolve.request.v1",
    query: "jsonl",
    ref: "proposals",
    repository: REPOSITORY,
  },
}).error.code, "mutable-ref-rejected");

const jsonlPlan = resolve("jsonl*");
const jsonl = run(jsonlPlan, {
  action: "inspect-jsonl",
  text: '{"id":"a"}\n{"id":"a"}\n{"id":"b"}\n',
});
assert.equal(jsonl.entryName, "jsonl-inspect");
assert.equal(jsonl.result.rowCount, 3);
assert.deepEqual(jsonl.result.duplicateIds, ["a"]);

const rollup = run(resolve("mjs*"), {
  operation: "bundle",
  entry: "src/index.mjs",
  modules: {
    "src/index.mjs": 'import {twice} from "./math.mjs"; export const result=twice(20)+1;',
    "src/math.mjs": "export const twice=(value)=>value*2;",
  },
});
assert.equal(rollup.manifest.engine, "rollup");
const generated = await import(`data:text/javascript;base64,${Buffer.from(rollup.result).toString("base64")}`);
assert.equal(generated.result, 41);

const url = run(resolve("excalidraw-url"), {
  publicSceneUrl: "https://example.invalid/a.excalidraw",
});
assert.equal(
  url.result,
  "https://excalidraw.com/#url=https%3A%2F%2Fexample.invalid%2Fa.excalidraw",
);

const browserPlan = run(resolve("excalidraw-html"), { text: "browser-ok" });
assert.equal(browserPlan.kind, "ops.distBrowser.plan.v1");
const completed = invoke("complete", {
  request: {
    browser: {
      ok: true,
      manifest: {
        id: "urn:roccho-dev:ops:dist:excalidraw:html-to-excalidraw",
        generatedIsAuthority: false,
      },
      result: { count: 1, text: "browser-ok" },
    },
    kind: "ops.distComplete.request.v1",
    plan: browserPlan,
  },
});
assert.equal(completed.entryName, "html-to-excalidraw");

const alteredEnvelope = connector(jsonlPlan);
alteredEnvelope.content = `${alteredEnvelope.content[0] === "A" ? "B" : "A"}${alteredEnvelope.content.slice(1)}`;
assert.ok(
  ["computed-blob-mismatch", "artifact-identity-mismatch"].includes(
    reject("run", {
      request: {
        connector: alteredEnvelope,
        input: { action: "inspect-jsonl", text: '{"id":"a"}\n' },
        kind: "ops.distRun.request.v1",
        plan: jsonlPlan,
        timeoutSeconds: 60,
      },
    }).error.code,
  ),
);

const alteredPlan = structuredClone(jsonlPlan);
alteredPlan.entry.path = "dist/other/other.pyz";
assert.equal(
  reject("run", {
    request: {
      connector: connector(jsonlPlan),
      input: { action: "inspect-jsonl", text: '{"id":"a"}\n' },
      kind: "ops.distRun.request.v1",
      plan: alteredPlan,
      timeoutSeconds: 60,
    },
  }).error.code,
  "resolve-plan-tampered",
);

const alteredBrowserPlan = structuredClone(browserPlan);
alteredBrowserPlan.expression += " ";
assert.equal(
  reject("complete", {
    request: {
      browser: { ok: true, manifest: {}, result: null },
      kind: "ops.distComplete.request.v1",
      plan: alteredBrowserPlan,
    },
  }).error.code,
  "browser-plan-tampered",
);

withFixture((root) => {
  const target = path.join(root, "dist/jsonl-inspect/jsonl-inspect.pyz");
  fs.appendFileSync(target, "stale");
}, ["stale-index", "manifest-command-failed"]);

withFixture((root) => {
  const target = path.join(root, "packages/mjs-bundler/dist.json");
  const value = JSON.parse(fs.readFileSync(target, "utf8"));
  value.artifacts[0].aliases = ["bundle"];
  fs.writeFileSync(target, `${JSON.stringify(value)}\n`);
}, ["stale-index"]);

withFixture((root) => {
  const target = path.join(root, "dist/index.jsonl");
  fs.writeFileSync(target, fs.readFileSync(target, "utf8").replace('"mjs"', '"mjs2"'));
}, ["stale-index", "invalid-index-row"]);

withFixture((root) => {
  const target = path.join(root, "packages/mjs-bundler/dist.json");
  const value = JSON.parse(fs.readFileSync(target, "utf8"));
  value.artifacts[0].aliases = ["jsonl"];
  fs.writeFileSync(target, `${JSON.stringify(value)}\n`);
}, ["duplicate-search-token"]);

withFixture((root) => {
  const target = path.join(root, "dist/jsonl-inspect/jsonl-inspect.pyz");
  const actual = path.join(root, "real.pyz");
  fs.renameSync(target, actual);
  fs.symlinkSync(actual, target);
}, ["symlink-artifact-rejected", "symlink-dist-rejected"]);

withFixture((root) => {
  const extra = path.join(root, "dist/extra/extra.mjs");
  fs.mkdirSync(path.dirname(extra), { recursive: true });
  fs.writeFileSync(extra, "export const x=1;\n");
}, ["dist-inventory-mismatch"]);

const large = run(resolve("mjs"), {
  operation: "bundle",
  entry: "index.mjs",
  modules: {
    "index.mjs": `/*${"x".repeat(410_000)}*/ export const result=41;`,
  },
});
assert.match(large.result, /result/);

const beforeRunner = fs.readFileSync("dist/dist-runner/dist-runner.pyz");
execFileSync("packages/dist-runner/build.sh", [], { stdio: "inherit" });
const firstRunner = fs.readFileSync("dist/dist-runner/dist-runner.pyz");
execFileSync("packages/dist-runner/build.sh", [], { stdio: "inherit" });
const secondRunner = fs.readFileSync("dist/dist-runner/dist-runner.pyz");
assert.deepEqual(beforeRunner, firstRunner);
assert.deepEqual(firstRunner, secondRunner);

process.stdout.write("dist-runner:index-e2e-pass\n");
