import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { captureIsolation } from "../capture-isolation.mjs";

import {
  SECRET_ENV_NAMES,
  runTargetRuntime,
  sha256File,
  validateProjectionReceipt,
} from "../lib.mjs";

const OPS_SHA = "1".repeat(40);
const ENVS_SHA = "2".repeat(40);
const APPS_SHA = "3".repeat(40);
const ACCOUNT_ID = "account-dev-1";

const digest = value => createHash("sha256").update(value).digest("hex");

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function makeProjection() {
  return {
    kind: "envs.projectionReceipt.v1",
    status: "PASS",
    envs_sha: ENVS_SHA,
    environment: "dev",
    capability: "jev-api",
    source: {
      kind: "public_sops",
      ref: "secrets/jev-api-key.sops.yaml",
      sha256: `sha256:${"4".repeat(64)}`,
    },
    target: {
      provider: "cloudflare-pages",
      account_id: ACCOUNT_ID,
      project: "voice-ui",
      secret_name: "JEV_API_KEY",
    },
    projector: {
      workflow: ".github/workflows/runtime-secret-projection.yml",
      script: "scripts/runtime-secret-projection.sh",
    },
    effect: { operation: "cloudflare_pages_secret_put", status: "PASS" },
    readback: { kind: "secret_name_presence", status: "PASS", present: true },
    workflow: {
      repository: "roccho-dev/envs",
      ref: "proposals",
      run_id: 123,
      run_attempt: 1,
    },
    created_at: "2026-09-28T00:00:00Z",
  };
}

function makeFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "voice-ui-target-runtime-test-"));
  const artifactRoot = path.join(root, "artifact");
  const files = new Map([
    ["e2e/runtime-acceptance.mjs", "// exact acceptance entrypoint\n"],
    ["e2e/public-e2e.mjs", "// exact public e2e\n"],
    ["functions/api/jev.mjs", "export const onRequestPost = () => new Response();\n"],
    ["site/index.html", "<!doctype html><title>voice-ui</title>\n"],
    [".envs/artifact.jsonl", `${JSON.stringify({ artifact: "voice-ui", kind: "artifact.auth.v1", requiredCapabilities: ["jev-api"] })}\n`],
  ]);
  for (const [relative, content] of files) {
    const file = path.join(artifactRoot, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  const manifest = {
    schema: "voice-ui-dist/1",
    sources: { apps: APPS_SHA, ops: OPS_SHA, ui: "5".repeat(40), system: "x86_64-linux" },
    auth: ".envs/artifact.jsonl",
    e2e: {
      runtime_entrypoint: "e2e/runtime-acceptance.mjs",
      public_entrypoint: "e2e/public-e2e.mjs",
    },
    files: [...files].map(([relative, content]) => ({
      path: relative,
      bytes: Buffer.byteLength(content),
      sha256: digest(content),
    })),
  };
  const manifestPath = path.join(artifactRoot, "manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);

  const projectionPath = path.join(root, "projection.json");
  writeJson(projectionPath, makeProjection());
  const isolationPath = path.join(root, "isolation.json");
  writeJson(isolationPath, {
    kind: "ops.secretEffectBoundary.check.v1",
    status: "PASS",
    opsSha: OPS_SHA,
    active: 2,
    secretBearingEffects: 5,
    obsolete: 6,
    unclassified: 0,
    workflows: [
      { path: ".github/workflows/nix-check.yml", classification: "secret_free_verify" },
      { path: ".github/workflows/voice-ui-target-runtime.yml", classification: "secret_bearing_effect" },
    ],
  });

  const deployAdapter = path.join(root, "deploy-adapter.mjs");
  const readbackAdapter = path.join(root, "readback-adapter.mjs");
  writeFileSync(deployAdapter, "// exact deploy adapter\n");
  writeFileSync(readbackAdapter, "// exact readback adapter\n");

  const output = path.join(root, "output");
  const request = {
    kind: "ops.voiceUiTargetRuntimeRequest.v1",
    expected: {
      opsSha: OPS_SHA,
      envsSha: ENVS_SHA,
      appsSha: APPS_SHA,
      artifactManifestSha256: sha256File(manifestPath),
      target: {
        provider: "cloudflare-pages",
        accountId: ACCOUNT_ID,
        project: "voice-ui",
        branch: "proposals",
      },
    },
    inputs: {
      artifactRoot,
      projectionReceipt: projectionPath,
      isolationVerdict: isolationPath,
    },
    adapters: {
      deploy: { path: deployAdapter, sha256: sha256File(deployAdapter) },
      readback: { path: readbackAdapter, sha256: sha256File(readbackAdapter) },
    },
    output,
  };
  return { root, artifactRoot, projectionPath, isolationPath, deployAdapter, readbackAdapter, output, request, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function arg(args, name) {
  const index = args.indexOf(name);
  assert.notEqual(index, -1, `missing ${name}`);
  return args[index + 1];
}

function successfulSpawn(fixture, observations) {
  return (_command, args, options) => {
    if (args[0] === fixture.deployAdapter) {
      const request = JSON.parse(readFileSync(arg(args, "--request"), "utf8"));
      observations.deployEnv = options.env;
      writeJson(arg(args, "--receipt"), {
        kind: "ops.voiceUiDeployReceipt.v1",
        status: "PASS",
        opsSha: OPS_SHA,
        appsSha: APPS_SHA,
        artifactManifestSha256: `sha256:${fixture.request.expected.artifactManifestSha256}`,
        target: fixture.request.expected.target,
        deployment: {
          id: "deployment-1",
          url: "https://deployment-1.voice-ui.pages.dev/",
          stableUrl: "https://voice-ui.pages.dev/",
          commitSha: APPS_SHA,
        },
        effect: { status: "PASS" },
      });
      return { status: 0, stdout: "deploy PASS\n", stderr: "" };
    }
    if (args[0] === fixture.readbackAdapter) {
      observations.readbackEnv = options.env;
      writeJson(arg(args, "--receipt"), {
        kind: "ops.voiceUiReadbackReceipt.v1",
        status: "PASS",
        opsSha: OPS_SHA,
        appsSha: APPS_SHA,
        artifactManifestSha256: fixture.request.expected.artifactManifestSha256,
        deploymentId: "deployment-1",
        publicBytes: { status: "PASS", fileCount: 1 },
        function: { status: "PASS", path: "/api/jev" },
      });
      return { status: 0, stdout: "readback PASS\n", stderr: "" };
    }

    assert.equal(args[0], path.join(fixture.artifactRoot, "e2e/runtime-acceptance.mjs"));
    observations.acceptanceEnvs.push(options.env);
    observations.acceptanceCwds.push(options.cwd);
    const receipt = arg(args, "--receipt");
    const handoffId = arg(args, "--handoff-id");
    writeJson(receipt, {
      kind: "voice-ui.runtimeAcceptanceReceipt.v1",
      status: "PASS",
      stage: "complete",
      target: { url: arg(args, "--url") },
      handoffId,
      sources: {
        apps: APPS_SHA,
        artifactManifestSha256: fixture.request.expected.artifactManifestSha256,
      },
      checks: [
        { id: "artifact-admission", status: "PASS" },
        { id: "secret-free-runtime", status: "PASS" },
        { id: "public-application-e2e", status: "PASS" },
      ],
      dependencies: { envsRuntime: [], secretInputs: [] },
      process: { exitCode: 0, independentProcess: true },
      completedAt: handoffId.endsWith("run-1") ? "2026-09-28T00:00:01Z" : "2026-09-28T00:00:02Z",
    });
    return { status: 0, stdout: "acceptance PASS\n", stderr: "" };
  };
}



test("isolation capture binds the checker result to exact ops source inputs", () => {
  const root = mkdtempSync(path.join(tmpdir(), "voice-ui-isolation-test-"));
  try {
    const checker = path.join(root, "tools/check-ci-intent-workflow-branches.mjs");
    const intent = path.join(root, "ci.intent.v1.jsonl");
    const boundary = path.join(root, "contracts/secret-effect-boundary.v1.jsonl");
    mkdirSync(path.dirname(checker), { recursive: true });
    mkdirSync(path.dirname(boundary), { recursive: true });
    writeFileSync(checker, "// checker\n");
    writeFileSync(intent, "{}\n");
    writeFileSync(boundary, "{}\n");
    const output = path.join(root, "verdict.json");
    const verdict = captureIsolation({
      root,
      opsSha: OPS_SHA,
      output,
      spawn: (command) => {
        assert.equal(command, process.execPath);
        return {
          status: 0,
          stdout: `${JSON.stringify({
            kind: "ops.secretEffectBoundary.check.v1",
            status: "PASS",
            active: 2,
            secretBearingEffects: 1,
            obsolete: 0,
            unclassified: 0,
            workflows: [
              { path: ".github/workflows/nix-check.yml", classification: "secret_free_verify" },
              { path: ".github/workflows/effect.yml", classification: "secret_bearing_effect" },
            ],
          })}\n`,
          stderr: "",
        };
      },
    });
    assert.equal(verdict.opsSha, OPS_SHA);
    assert.match(verdict.inputs.checkerSha256, /^sha256:[0-9a-f]{64}$/);
    assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), verdict);
    assert.throws(() => captureIsolation({ root, opsSha: "proposals", output, spawn: () => ({ status: 0 }) }), /exact 40-character/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("projection receipt presence is insufficient unless effect and readback are exact PASS", () => {
  const receipt = makeProjection();
  receipt.readback.present = false;
  assert.throws(() => validateProjectionReceipt(receipt, ENVS_SHA), /readback is not PASS/);
  receipt.readback.present = true;
  receipt.effect.status = "NOT_RUN";
  assert.throws(() => validateProjectionReceipt(receipt, ENVS_SHA), /effect is not PASS/);
});

test("exact inputs drive deploy, public readback and two independent secret-free acceptances", () => {
  const fixture = makeFixture();
  try {
    const observations = { acceptanceEnvs: [], acceptanceCwds: [] };
    const env = {
      PATH: process.env.PATH ?? "",
      CLOUDFLARE_API_TOKEN: "effect-only-token",
      CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
      JEV_API_KEY: "must-not-reach-acceptance",
    };
    const result = runTargetRuntime(fixture.request, {
      spawn: successfulSpawn(fixture, observations),
      env,
      completedAt: "2026-09-28T00:00:03Z",
    });

    assert.equal(result.status, "PASS");
    assert.equal(result.claim, "NEW_PROJECTION_REAL_USE_PROVEN");
    assert.equal(result.stages.acceptance.length, 2);
    assert.notEqual(result.stages.acceptance[0].workspaceId, result.stages.acceptance[1].workspaceId);
    assert.equal(observations.deployEnv.CLOUDFLARE_API_TOKEN, "effect-only-token");
    assert.equal(observations.deployEnv.CLOUDFLARE_ACCOUNT_ID, ACCOUNT_ID);
    assert.equal(observations.deployEnv.JEV_API_KEY, undefined);
    assert.equal(observations.deployEnv.SOPS_AGE_KEY, undefined);
    assert.equal(observations.readbackEnv.CLOUDFLARE_API_TOKEN, undefined);
    assert.equal(observations.acceptanceCwds.length, 2);
    assert.notEqual(observations.acceptanceCwds[0], observations.acceptanceCwds[1]);
    for (const acceptedEnv of observations.acceptanceEnvs) {
      for (const name of SECRET_ENV_NAMES) assert.equal(acceptedEnv[name], undefined, `${name} reached application acceptance`);
    }

    const finalReceipt = readFileSync(path.join(fixture.output, "receipt.json"), "utf8");
    assert.equal(finalReceipt.includes("effect-only-token"), false);
    assert.equal(finalReceipt.includes("must-not-reach-acceptance"), false);
  } finally {
    fixture.cleanup();
  }
});

test("stale artifact digest fails before provider effect", () => {
  const fixture = makeFixture();
  try {
    fixture.request.expected.artifactManifestSha256 = "f".repeat(64);
    let calls = 0;
    assert.throws(() => runTargetRuntime(fixture.request, { spawn: () => { calls += 1; return { status: 0 }; } }), /manifest digest mismatch/);
    assert.equal(calls, 0);
  } finally {
    fixture.cleanup();
  }
});

test("first acceptance PASS never masks a second acceptance failure", () => {
  const fixture = makeFixture();
  try {
    const observations = { acceptanceEnvs: [], acceptanceCwds: [] };
    let acceptanceCount = 0;
    const baseSpawn = successfulSpawn(fixture, observations);
    const spawn = (command, args, options) => {
      if (args[0] === path.join(fixture.artifactRoot, "e2e/runtime-acceptance.mjs")) {
        acceptanceCount += 1;
        if (acceptanceCount === 2) return { status: 9, stdout: "", stderr: "second run failed\n" };
      }
      return baseSpawn(command, args, options);
    };
    assert.throws(() => runTargetRuntime(fixture.request, { spawn, env: { PATH: process.env.PATH ?? "" } }), /application acceptance failed/);
    assert.equal(acceptanceCount, 2);
    assert.equal(path.join(fixture.output, "receipt.json"), path.join(fixture.output, "receipt.json"));
    assert.throws(() => readFileSync(path.join(fixture.output, "receipt.json"), "utf8"));
  } finally {
    fixture.cleanup();
  }
});
