import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const root = path.resolve(new URL("../../..", import.meta.url).pathname);
const cli = path.join(root, "packages/artifact-app/bin/artifact-app.mjs");
const definition = path.join(root, "apps/artifact-runtime-interactive/app.json");
const controller = path.join(root, "packages/artifact-app/runtime/controller.mjs");
const runtimeDir = process.env.ARTIFACT_RUNTIME_DIR;
const runtimeManifest = process.env.ARTIFACT_RUNTIME_MANIFEST ?? path.join(root, "verification/artifact-runtime-publication/manifest.json");
const appPublication = process.env.ARTIFACT_APP_PUBLICATION ?? path.join(root, "verification/artifact-app-publication/manifest.json");
assert.ok(runtimeDir, "ARTIFACT_RUNTIME_DIR is required");
const run = args => JSON.parse(execFileSync(process.execPath, [cli, ...args], { encoding: "utf8" }));
const reject = (args, pattern) => {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, pattern);
};
const walk = directory => {
  const rows = [];
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) visit(target);
      else rows.push({ path: path.relative(directory, target).replaceAll(path.sep, "/"), sha256: crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex") });
    }
  };
  visit(directory);
  return rows;
};

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-app-e2e-"));
try {
  const a = path.join(temp, "a");
  const b = path.join(temp, "b");
  const common = ["--definition", definition, "--runtime-dir", runtimeDir, "--runtime-manifest", runtimeManifest, "--controller", controller];
  const buildA = run(["build", ...common, "--out", a]);
  const buildB = run(["build", ...common, "--out", b]);
  assert.equal(buildA.status, "PASS");
  assert.deepEqual(buildA, buildB);
  assert.deepEqual(walk(a), walk(b));
  assert.equal(run(["verify", "--input", a]).treeDigest, buildA.treeDigest);

  const app = JSON.parse(fs.readFileSync(path.join(a, "app.manifest.json"), "utf8"));
  const defaultFile = path.join(a, app.fixtures.defaultInvocation);
  const actionFile = path.join(a, app.fixtures.action);
  const executeFile = path.join(a, app.fixtures.execute);
  const encoded = run(["encode", "--input", a, "--request", defaultFile, "--base", "https://example.invalid/app/"]);
  const encodedAgain = run(["encode", "--input", a, "--request", defaultFile, "--base", "https://example.invalid/app/"]);
  assert.equal(encoded.url, encodedAgain.url);
  const decoded = run(["decode", "--input", a, "--url", encoded.url]);
  assert.deepEqual(decoded.request, encoded.request);

  const applied = run(["apply-action", "--input", a, "--detail", actionFile, "--base", encoded.url]);
  assert.equal(applied.status, "PASS");
  assert.equal(applied.next.id, "request.interactive-a2ui.state-b");
  assert.notEqual(applied.url, encoded.url);
  assert.deepEqual(run(["decode", "--input", a, "--url", applied.url]).request, applied.next);

  const executed = run(["execute", "--input", a, "--request", executeFile]);
  assert.equal(executed.status, "PASS");
  assert.equal(executed.outcome.result.status, "PASS");
  assert.ok(executed.outcome.result.outputs.some(item => item.contract === "json-inspection/1"));

  const publication = JSON.parse(fs.readFileSync(appPublication, "utf8"));
  assert.equal(publication.publication.treeDigest, buildA.treeDigest);
  const plan = run(["source-plan", "--input", a, "--publication", appPublication]);
  assert.equal(plan.status, "PASS");
  assert.deepEqual(plan.sources.map(item => item.repository), ["roccho-dev/ui", "roccho-dev/ops"]);
  assert.equal(plan.sources[0].identity.commit, "126226fb666e71b395af172e3b9068c89f267ef5");
  assert.equal(plan.sources[1].identity.tag, publication.publication.tag);
  const carry = run(["carry-request", "--publication", appPublication]);
  assert.equal(carry.schema, "carrier-job/1");
  assert.equal(carry.sources.length, 2);
  assert.equal(carry.payload_sha256, publication.publication.archive.sha256.slice("sha256:".length));
  const sourceCarry = run(["source-carry-request", "--publication", appPublication, "--role", "runtime"]);
  assert.equal(sourceCarry.schema, "artifact-app-source-carry/1");
  assert.equal(sourceCarry.role, "runtime");

  const badAction = path.join(temp, "bad-action.json");
  const detail = JSON.parse(fs.readFileSync(actionFile, "utf8"));
  detail.version = "v9.9.9";
  fs.writeFileSync(badAction, JSON.stringify(detail));
  reject(["apply-action", "--input", a, "--detail", badAction, "--base", encoded.url], /action.version/);

  const tampered = path.join(temp, "tampered");
  fs.cpSync(a, tampered, { recursive: true });
  fs.appendFileSync(path.join(tampered, "entry.mjs"), "\n// tampered\n");
  reject(["verify", "--input", tampered], /inventory or digest mismatch/);
  reject(["decode", "--input", a, "--url", "https://example.invalid/app/"], /does not contain/);
  reject(["build", ...common, "--out", a], /output exists/);

  console.log(JSON.stringify({ schema: "artifact-app-e2e/1", status: "PASS", treeDigest: buildA.treeDigest, positive: 20, negative: 4 }));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
