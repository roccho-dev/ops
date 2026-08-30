import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const [uiRootInput, packageRootInput, evidenceRootInput] = process.argv.slice(2);
if (!uiRootInput || !packageRootInput || !evidenceRootInput) {
  throw new Error("usage: node build-real-case.mjs <ui-root> <package-root> <evidence-root>");
}

const UI_COMMIT = "7ea789ebae6c2c4452087b97c898b679603a6ade";
const UI_TREE = "02c79b880f0aaa8d932c34ee609081b8c5ad8738";
const GOVERNANCE_REPOSITORY = "roccho-dev/governance";
const GOVERNANCE_COMMIT = "6b20ba62e5b84de7549cc1df801af453dec03a38";
const GOVERNANCE_PATH = "docs/gov-package-output/packages.jsonl";
const MEANING_BYTES = 950;
const MEANING_DIGEST = "sha256:4e5438c2b7a52e1d993fc518c251effefed77bcc98a16ba3567a06221e4473d2";
const PROFILE_ID = "gov-package-output-map/1";
const PROFILE_DIGEST = "sha256:e0cc044ec2c2baed8405dec2a0942443f37c0ec187b300cbdbdf82eecfb15261";

const uiRoot = path.resolve(uiRootInput);
const packageRoot = path.resolve(packageRootInput);
const evidenceRoot = path.resolve(evidenceRootInput);
const publicRoot = path.join(packageRoot, "public");
const bindingPath = path.join(packageRoot, "bindings", "selected-universe.json");
const sha256 = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const exactRun = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${command} failed`);
  return result.stdout.trim();
};

const rawUrl = `https://raw.githubusercontent.com/${GOVERNANCE_REPOSITORY}/${GOVERNANCE_COMMIT}/${GOVERNANCE_PATH}`;
const response = await fetch(rawUrl, {
  headers: { accept: "application/x-ndjson", "user-agent": "roccho-ops-gov-map-binding/1" },
});
if (!response.ok) throw new Error(`Governance readback failed: HTTP ${response.status}`);
const meaningBytes = Buffer.from(await response.arrayBuffer());
if (meaningBytes.byteLength !== MEANING_BYTES) throw new Error(`meaning bytes mismatch: ${meaningBytes.byteLength}`);
if (sha256(meaningBytes) !== MEANING_DIGEST) throw new Error(`meaning digest mismatch: ${sha256(meaningBytes)}`);

const profilePath = path.join(uiRoot, "packages", "semantic-map-profiles", "gov-package-output", "profile.jsonl");
const profileBytes = await fs.readFile(profilePath);
if (sha256(profileBytes) !== PROFILE_DIGEST) throw new Error(`profile digest mismatch: ${sha256(profileBytes)}`);
const profile = JSON.parse(profileBytes.toString("utf8").trim());
if (profile.profileId !== PROFILE_ID || profile.authority !== false || profile.generatedArtifactsAreAuthority !== false) {
  throw new Error("profile boundary mismatch");
}

await fs.mkdir(evidenceRoot, { recursive: true });
await fs.rm(publicRoot, { recursive: true, force: true });
await fs.mkdir(publicRoot, { recursive: true });
const workRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gov-package-map-"));
try {
  const meaningPath = path.join(workRoot, "packages.jsonl");
  const envelopePath = path.join(workRoot, "envelope.json");
  const generatedRoot = path.join(workRoot, "generated");
  await fs.writeFile(meaningPath, meaningBytes);

  exactRun(process.execPath, [
    path.join(uiRoot, "packages", "semantic-map-profiles", "gov-package-output", "build-envelope.mjs"),
    `--meaning=${meaningPath}`,
    `--profile=${profilePath}`,
    `--source-commit=${GOVERNANCE_COMMIT}`,
    `--out=${envelopePath}`,
  ], { cwd: uiRoot });

  const envelopeBytes = await fs.readFile(envelopePath);
  const envelope = JSON.parse(envelopeBytes.toString("utf8"));
  if (envelope.schema !== "semantic-map-envelope/3" || envelope.view?.pattern !== "map/1") {
    throw new Error("generated envelope boundary mismatch");
  }
  const decision = JSON.parse(envelope.log);
  const create = decision.operations?.find(operation => operation.type === "CreateMap");
  const regionIds = new Set((create?.records ?? []).filter(record => record.type === "region").map(record => record.id));
  for (const id of ["package:tools", "package:modules"]) {
    if (!regionIds.has(id)) throw new Error(`generated envelope is missing ${id}`);
  }

  exactRun(process.execPath, [
    path.join(uiRoot, "packages", "semantic-map", "scripts", "build-browser-example.mjs"),
    `--input=${envelopePath}`,
    `--out=${generatedRoot}`,
  ], { cwd: uiRoot });

  const generatedReceipt = JSON.parse(await fs.readFile(path.join(generatedRoot, "receipt.json"), "utf8"));
  if (generatedReceipt.status !== "PASS" || generatedReceipt.pattern !== "map/1") {
    throw new Error("Semantic Map generator receipt mismatch");
  }

  const indexPath = path.join(generatedRoot, "index.html");
  let html = await fs.readFile(indexPath, "utf8");
  if (!html.includes("<title>Semantic Map</title>") || !html.includes("package:tools") || !html.includes("package:modules")) {
    throw new Error("generated HTML does not contain the expected Semantic Map");
  }
  const metadata = [
    `<link rel="icon" href="data:,">`,
    `<meta name="governance-meaning-sha256" content="${MEANING_DIGEST}">`,
    `<meta name="governance-source-commit" content="${GOVERNANCE_COMMIT}">`,
    `<meta name="semantic-map-ui-commit" content="${UI_COMMIT}">`,
    `<meta name="semantic-map-ui-tree" content="${UI_TREE}">`,
    `<meta name="semantic-map-profile" content="${PROFILE_ID}">`,
    `<meta name="semantic-map-profile-sha256" content="${PROFILE_DIGEST}">`,
    `<meta name="generated-artifacts-authority" content="false">`,
    `<meta name="production-cutover" content="false">`,
  ].join("\n");
  html = html.replace("<title>Semantic Map</title>", `<title>Semantic Map</title>\n${metadata}`);
  const htmlBytes = Buffer.from(html.endsWith("\n") ? html : `${html}\n`);
  const htmlDigest = sha256(htmlBytes);
  await fs.writeFile(path.join(publicRoot, "index.html"), htmlBytes);

  const binding = {
    schema: "ops.govReleaseProxyBinding/1",
    bindingId: "governance.gov-package-output.semantic-map/1",
    authority: false,
    claimCeiling: "VISUAL_EVALUATION_ONLY",
    productionCutover: false,
    endpoint: "/",
    deliveryModel: "one-root",
    browserDirectGitHubFetch: false,
    release: {
      sourceKind: "git-raw",
      repository: GOVERNANCE_REPOSITORY,
      releaseId: null,
      tag: `git/${GOVERNANCE_COMMIT}/${GOVERNANCE_PATH}`,
      targetCommit: GOVERNANCE_COMMIT,
      visibility: "public",
    },
    asset: {
      assetId: null,
      name: "packages.jsonl",
      path: GOVERNANCE_PATH,
      bytes: MEANING_BYTES,
      digest: MEANING_DIGEST,
      contentType: "application/x-ndjson; charset=utf-8",
      downloadUrl: rawUrl,
      requiresCredential: false,
    },
    ui: {
      repository: "roccho-dev/ui",
      rendererSourceCommit: UI_COMMIT,
      rendererSourceTree: UI_TREE,
      rendererPackage: "packages/semantic-map",
      artifactCommit: UI_COMMIT,
      artifactTree: UI_TREE,
      artifactRoot: "generated:packages/semantic-map/scripts/build-browser-example.mjs",
      profileId: PROFILE_ID,
      profileDigest: PROFILE_DIGEST,
      htmlBytes: htmlBytes.byteLength,
      htmlDigest,
      svgDigest: "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      meaningDigest: MEANING_DIGEST,
      purpose: "visual-evaluation-only",
    },
  };
  await fs.writeFile(bindingPath, `${JSON.stringify(binding, null, 2)}\n`);

  const expected = {
    schema: "ops.govPackageSemanticMapExpected/1",
    status: "PASS",
    authority: false,
    productionCutover: false,
    bindingId: binding.bindingId,
    meaning: { bytes: MEANING_BYTES, sha256: MEANING_DIGEST, source: rawUrl },
    ui: {
      commit: UI_COMMIT,
      tree: UI_TREE,
      profileId: PROFILE_ID,
      profileSha256: PROFILE_DIGEST,
      htmlBytes: htmlBytes.byteLength,
      htmlSha256: htmlDigest,
      standaloneSvg: false,
    },
    projection: { pattern: "map/1", regionCount: 13, relationCount: 10, requiredRegionIds: ["package:tools", "package:modules"] },
    generated: generatedReceipt,
  };
  await fs.writeFile(path.join(evidenceRoot, "expected.json"), `${JSON.stringify(expected, null, 2)}\n`);
  await fs.writeFile(path.join(evidenceRoot, "meaning.jsonl"), meaningBytes);
  await fs.writeFile(path.join(evidenceRoot, "envelope.json"), envelopeBytes);
  console.log(JSON.stringify(expected));
} finally {
  await fs.rm(workRoot, { recursive: true, force: true });
}
