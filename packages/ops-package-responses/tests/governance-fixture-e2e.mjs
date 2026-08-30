#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { bytesDigest, objectDigest, readJsonl } from "../lib/core.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const exampleRoot = path.join(packageRoot, "examples", "governance-package-obligations-v1");
const govOutputBin = path.resolve(packageRoot, "..", "ops-gov-package-output", "bin", "ops-gov-package-output.mjs");

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}
function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}
function sha256File(file) { return bytesDigest(fs.readFileSync(file)); }
function git(root, ...args) { return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim(); }
function sortedDirectories(root) {
  return fs.readdirSync(root, { withFileTypes: true }).filter((item) => item.isDirectory()).map((item) => item.name).sort();
}
function directorySetDigest(root) { return bytesDigest(Buffer.from(sortedDirectories(root).join("\n") + "\n")); }

function validateCheckedInExample() {
  const manifest = readJson(path.join(exampleRoot, "source-manifest.json"));
  const projection = readJson(path.join(exampleRoot, "inventory-projection.json"));
  const source = readJson(path.join(exampleRoot, "governance-source.json"));
  const materialization = readJson(path.join(exampleRoot, "package-obligations-materialization.json"));
  const expected = readJson(path.join(exampleRoot, "expected.json"));
  const receipt = readJson(path.join(exampleRoot, "receipt.json"));
  const obligationFile = path.join(exampleRoot, "package-obligations.jsonl");
  const obligations = readJsonl(obligationFile);

  assert.equal(manifest.kind, "adrsPackageObligationFixtureManifest.v1");
  assert.equal(manifest.authority, false);
  assert.equal(manifest.accepted_meaning_authority, false);
  assert.equal(manifest.production_gate, false);
  assert.equal(source.authority, false);
  assert.equal(source.accepted_meaning_authority, false);
  assert.equal(source.production_gate, false);
  assert.equal(materialization.authority, false);
  assert.equal(materialization.accepted_meaning_authority, false);
  assert.equal(materialization.production_gate, false);

  const sourceDigest = sha256File(obligationFile);
  assert.equal(sourceDigest, manifest.source_sha256);
  assert.equal(sourceDigest, source.source_sha256);
  assert.equal(sourceDigest, materialization.source_sha256);
  assert.equal(sourceDigest, materialization.output_sha256);
  assert.equal(obligations.length, expected.packages);
  assert.equal(obligations.length, manifest.row_count);
  assert.equal(obligations.length, materialization.row_count);

  const packageIds = obligations.map((row) => row.package_id);
  assert.deepEqual(packageIds, [...packageIds].sort());
  assert.equal(new Set(packageIds).size, packageIds.length);
  assert.deepEqual(packageIds, projection.package_ids);
  assert.deepEqual(
    obligations.filter((row) => row.claim_required).map((row) => row.package_id),
    manifest.active_package_ids,
  );
  assert.deepEqual(manifest.active_package_ids, projection.active_package_ids);
  assert.deepEqual(
    obligations.flatMap((row) => row.required_tests).sort(),
    projection.required_check_ids,
  );
  for (const row of obligations) {
    assert.equal(row.authority, false);
    assert.equal(row.package_path, projection.package_paths[row.package_id]);
    assert.equal(row.repo_locator, "roccho-dev/ops");
    assert.equal(row.target_universe_id, `roccho-dev/ops@${manifest.target_commit}`);
    if (row.claim_required) assert.equal(row.required_tests.length, 1);
    else assert.deepEqual(row.required_tests, []);
  }

  const packageIdsDigest = bytesDigest(Buffer.from(packageIds.join("\n") + "\n"));
  assert.equal(packageIdsDigest, materialization.package_ids_sha256);
  assert.equal(sha256File(path.join(exampleRoot, "inventory-projection.json")), source.inventory_projection_sha256);
  assert.equal(sha256File(path.join(exampleRoot, "package-obligations-materialization.json")), source.materialization_receipt_sha256);

  assert.equal(expected.kind, "ops.packageObligationGoldenExpected.v1");
  assert.equal(expected.status, "pass");
  assert.equal(expected.packages, manifest.row_count);
  assert.equal(expected.active, manifest.active_package_ids.length);
  assert.equal(expected.out_of_scope, expected.packages - expected.active);
  assert.equal(expected.evidence, expected.active);
  assert.equal(expected.findings, 0);
  assert.equal(expected.organization_active_minted, false);
  assert.equal(expected.authority, false);
  assert.equal(receipt.kind, "ops.packageObligationGoldenReceipt.v1");
  assert.equal(receipt.status, "pass");
  assert.equal(receipt.authority, false);
  assert.equal(receipt.environment.real_nix_proven, false);
  assert.deepEqual(receipt.observed, expected);
  const receiptBase = { ...receipt };
  delete receiptBase.receipt_digest;
  assert.equal(objectDigest(receiptBase), receipt.receipt_digest);
  for (const [name, digest] of Object.entries(receipt.input_digests)) assert.equal(sha256File(path.join(exampleRoot, name)), digest);
  assert.equal(git(repoRoot, "rev-parse", `${receipt.implementation_commit}^{tree}`), receipt.implementation_tree.slice("git-tree-sha1:".length));
  assert.equal(git(repoRoot, "rev-parse", `${receipt.implementation_commit}:packages/ops-package-responses`), receipt.package_tree.slice("git-tree-sha1:".length));
  assert.equal(git(repoRoot, "rev-parse", `${receipt.implementation_commit}:packages/ops-package-responses/tests/governance-fixture-e2e.mjs`), receipt.test_blob.slice("git-blob-sha1:".length));

  for (const input of manifest.inventory_inputs) {
    const observed = input.path === "packages/<directory-name-set>"
      ? directorySetDigest(path.join(repoRoot, "packages"))
      : sha256File(path.join(repoRoot, input.path));
    assert.equal(observed, input.sha256, `inventory source drift: ${input.path}`);
  }
  assert.deepEqual(sortedDirectories(path.join(repoRoot, "packages")), projection.source_directory_ids);
  return { manifest, projection, obligations, source, materialization, expected, receipt };
}

function writeFakeNix(file, fakeRoot, projection) {
  const config = JSON.stringify({
    fakeRoot,
    packages: projection.flake_package_ids,
    checks: projection.required_check_ids,
  });
  fs.writeFileSync(file, `#!${process.execPath}\n`
    + `import crypto from "node:crypto";\n`
    + `import fs from "node:fs";\n`
    + `import path from "node:path";\n`
    + `const cfg=${config};\n`
    + `function hashTree(target){const rows=[];function walk(current,rel){const stat=fs.lstatSync(current);if(stat.isDirectory()){for(const name of fs.readdirSync(current).sort())walk(path.join(current,name),rel?rel+"/"+name:name);}else if(stat.isSymbolicLink())rows.push([rel,"l",fs.readlinkSync(current)]);else rows.push([rel,"f",fs.readFileSync(current).toString("base64")]);}walk(target,"");return "sha256-"+crypto.createHash("sha256").update(JSON.stringify(rows)).digest("base64");}\n`
    + `const args=process.argv.slice(2);\n`
    + `if(args[0]==="--version"){console.log("nix (fixture) 1");process.exit(0);}\n`
    + `if(args[0]==="hash"&&args[1]==="path"){console.log(hashTree(args.at(-1)));process.exit(0);}\n`
    + `if(args[0]==="eval"){const attr=args.find((value)=>value.startsWith(".#"))||"";if(attr.includes(".#packages.")){console.log(JSON.stringify(cfg.packages));process.exit(0);}if(attr.includes(".#checks.")){console.log(JSON.stringify(cfg.checks));process.exit(0);}console.error("unknown fixture eval attr",attr);process.exit(2);}\n`
    + `if(args[0]==="build"){const id=args.at(-1).split(".").at(-1);if(!cfg.checks.includes(id)){console.error("unknown fixture check: "+id);process.exit(2);}const out=path.join(cfg.fakeRoot,"outputs",id);if(!fs.existsSync(out)){console.error("missing fixture output: "+id);process.exit(2);}console.log(out);process.exit(0);}\n`
    + `console.error("unsupported fixture nix command",JSON.stringify(args));process.exit(2);\n`);
  fs.chmodSync(file, 0o755);
}

function createSyntheticOpsRepo(root, projection) {
  fs.mkdirSync(path.join(root, "build"), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, "build", "packages.jsonl"), path.join(root, "build", "packages.jsonl"));
  writeJsonl(path.join(root, "build", "checks.jsonl"), []);
  fs.writeFileSync(path.join(root, "flake.nix"), "# fixture inventory is supplied by the exact fake Nix adapter\n");

  for (const packageId of projection.source_directory_ids) {
    const dir = path.join(root, "packages", packageId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, ".fixture-source"), `${packageId}\n`);
  }
  for (const row of readJsonl(path.join(root, "build", "packages.jsonl"))) {
    const entry = path.join(root, row.entry);
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    const body = row.runtime === "python"
      ? `#!/usr/bin/env python3\nprint(${JSON.stringify(row.name)})\n`
      : `#!/usr/bin/env node\nconsole.log(${JSON.stringify(row.name)})\n`;
    fs.writeFileSync(entry, body);
  }

  git(root, "init", "-q");
  git(root, "config", "user.name", "fixture");
  git(root, "config", "user.email", "fixture@example.invalid");
  git(root, "add", ".");
  git(root, "commit", "-qm", "fixture ops inventory");
}

function createGovernanceSource(root, example) {
  fs.mkdirSync(path.join(root, "fixture"), { recursive: true });
  for (const name of ["governance-source.json", "package-obligations.jsonl", "package-obligations-materialization.json"]) {
    fs.copyFileSync(path.join(exampleRoot, name), path.join(root, "fixture", name));
  }
  git(root, "init", "-q");
  git(root, "config", "user.name", "fixture");
  git(root, "config", "user.email", "fixture@example.invalid");
  git(root, "add", ".");
  git(root, "commit", "-qm", `fixture governance source ${example.source.governance_commit.slice(0, 12)}`);
  return git(root, "rev-parse", "HEAD");
}

function createRelease(root, fakeNix, governanceCommit) {
  const releaseDir = path.join(root, "release");
  const outputDir = path.join(releaseDir, "gov-package-output");
  fs.mkdirSync(outputDir, { recursive: true });
  for (const name of ["package-obligations.jsonl", "package-obligations-materialization.json"]) {
    fs.copyFileSync(path.join(exampleRoot, name), path.join(outputDir, name));
  }
  const narHash = execFileSync(fakeNix, ["hash", "path", "--type", "sha256", outputDir], { encoding: "utf8" }).trim();
  const acceptedDecision = { kind: "acceptedDecision.fixture.v1", id: "governance-package-obligations-v1", status: "accepted-for-fixture-replay-only", authority: false };
  const engineDescriptor = { kind: "govEngineDescriptor.v1", repository: "roccho-dev/governance", commitSha: governanceCommit };
  const descriptor = { kind: "govNixOutputDescriptor.v1", package: "gov-package-output", narHash };
  const manifest = {
    kind: "govReleaseManifest.v1",
    releaseId: "fixture-governance-package-obligations-v1",
    sequence: 0,
    previousReleaseDigest: null,
    supersedesReleaseDigest: null,
    acceptedDecisionDigest: objectDigest(acceptedDecision),
    govEngineDigest: objectDigest(engineDescriptor),
    nixOutputDigest: objectDigest(descriptor),
    status: "adopted",
  };
  const releaseDigest = objectDigest(manifest);
  const readbackReceipt = {
    kind: "govReleaseReadbackReceipt.v1",
    status: "pass",
    releaseId: manifest.releaseId,
    releaseDigest,
    observedManifestDigest: releaseDigest,
    adopted: true,
    authority: false,
    transport: { provider: "package-owned-golden-fixture" },
  };
  writeJson(path.join(releaseDir, "accepted-decision.json"), acceptedDecision);
  writeJson(path.join(releaseDir, "gov-engine-descriptor.json"), engineDescriptor);
  writeJson(path.join(releaseDir, "gov-nix-output-descriptor.json"), descriptor);
  writeJson(path.join(releaseDir, "gov-release-manifest.json"), manifest);
  writeJson(path.join(releaseDir, "gov-release-readback-receipt.json"), readbackReceipt);
  return releaseDir;
}

export function runGovernanceFixtureE2E() {
  const example = validateCheckedInExample();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ops-governance-obligation-e2e-"));
  try {
    const syntheticOps = path.join(tmp, "ops");
    const governance = path.join(tmp, "governance");
    const fakeRoot = path.join(tmp, "fake-nix");
    const fakeNix = path.join(tmp, "nix");
    createSyntheticOpsRepo(syntheticOps, example.projection);
    const governanceCommit = createGovernanceSource(governance, example);
    writeFakeNix(fakeNix, fakeRoot, example.projection);
    for (const checkId of example.projection.required_check_ids) {
      const output = path.join(fakeRoot, "outputs", checkId);
      fs.mkdirSync(output, { recursive: true });
      writeJson(path.join(output, "result.json"), { checkId, status: "pass" });
    }
    const releaseDir = createRelease(tmp, fakeNix, governanceCommit);
    const outDir = path.join(tmp, "ops-gov-package-output");
    const result = JSON.parse(execFileSync(process.execPath, [
      govOutputBin,
      "execute",
      "--release-dir", releaseDir,
      "--out-dir", outDir,
      "--repo-root", syntheticOps,
      "--governance-source", `path:${governance}`,
      "--nix-bin", fakeNix,
      "--json",
    ], { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 }));

    assert.equal(result.ok, true);
    assert.equal(result.status, "pass");
    assert.equal(result.rowCounts.packages, example.expected.packages);
    assert.equal(result.rowCounts.assertions, example.expected.packages);
    assert.equal(result.rowCounts.receipts, example.expected.packages);
    assert.equal(result.rowCounts.admission, example.expected.packages);
    assert.equal(result.rowCounts.findings, 0);
    assert.deepEqual({
      kind: example.expected.kind,
      status: result.status,
      packages: result.rowCounts.packages,
      active: example.expected.active,
      out_of_scope: example.expected.out_of_scope,
      evidence: example.expected.evidence,
      findings: result.rowCounts.findings,
      organization_active_minted: false,
      authority: false,
    }, example.expected);

    const packages = readJsonl(path.join(outDir, "packages.jsonl"));
    const receipts = readJsonl(path.join(outDir, "receipts.jsonl"));
    const admissions = readJsonl(path.join(outDir, "admission.jsonl"));
    assert.equal(packages.filter((row) => row.status === "candidate-pass").length, example.expected.active);
    assert.equal(packages.filter((row) => row.status === "out-of-scope").length, example.expected.out_of_scope);
    assert.equal(receipts.filter((row) => row.status === "pass").length, example.expected.active);
    assert.equal(receipts.filter((row) => row.status === "out-of-scope").length, example.expected.out_of_scope);
    assert.equal(receipts.reduce((count, row) => count + row.evidence.length, 0), example.expected.evidence);
    assert.ok(admissions.every((row) => row.active === false && row.authority === false));
    assert.equal(admissions.filter((row) => row.status === "candidate-pass").length, example.expected.active);
    assert.equal(admissions.filter((row) => row.status === "out-of-scope").length, example.expected.out_of_scope);

    return {
      ok: true,
      kind: "ops.governancePackageObligationGoldenE2E.v1",
      packages: packages.length,
      active: example.expected.active,
      out_of_scope: example.expected.out_of_scope,
      evidence: example.expected.evidence,
      findings: 0,
      organization_active_minted: false,
      authority: false,
      fixture_source_sha256: example.manifest.source_sha256,
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runGovernanceFixtureE2E();
  if (process.argv.includes("--json")) process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  else process.stdout.write(`ops-package-responses: ${result.packages}-package governance fixture replay passed\n`);
}
