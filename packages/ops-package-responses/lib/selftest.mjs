import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bytesDigest, objectDigest, readJsonl } from "./core.mjs";

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}
function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}
function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}
function writeFakeNix(file, fakeRoot) {
  const rootLiteral = JSON.stringify(fakeRoot);
  fs.writeFileSync(file, `#!${process.execPath}
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
const root=${rootLiteral};
function hashTree(target){
  const rows=[];
  function walk(current, rel){
    const stat=fs.lstatSync(current);
    if(stat.isDirectory()) for(const name of fs.readdirSync(current).sort()) walk(path.join(current,name), rel?rel+"/"+name:name);
    else if(stat.isSymbolicLink()) rows.push([rel,"l",fs.readlinkSync(current)]);
    else rows.push([rel,"f",fs.readFileSync(current).toString("base64")]);
  }
  walk(target,"");
  return "sha256-"+crypto.createHash("sha256").update(JSON.stringify(rows)).digest("base64");
}
const args=process.argv.slice(2);
if(args[0]==="--version"){ console.log("nix (fake) 1"); process.exit(0); }
if(args[0]==="hash"&&args[1]==="path"){ console.log(hashTree(args.at(-1))); process.exit(0); }
if(args[0]==="eval"){
  const attr=args.find((value)=>value.startsWith(".#"))||"";
  if(attr.includes(".#packages.")){ console.log(JSON.stringify(["alpha","beta"])); process.exit(0); }
  if(attr.includes(".#checks.")){ console.log(JSON.stringify(["alpha-check","beta-check"])); process.exit(0); }
  console.error("unknown fake eval attr",attr); process.exit(2);
}
if(args[0]==="build"){
  const id=args.at(-1).split(".").at(-1);
  const marker=path.join(root,"fail",id);
  if(fs.existsSync(marker)){ console.error("fake check failed: "+id); process.exit(1); }
  const out=path.join(root,"outputs",id);
  if(!fs.existsSync(out)){ console.error("missing fake output: "+id); process.exit(2); }
  console.log(out); process.exit(0);
}
console.error("unsupported fake nix command",args); process.exit(2);
`);
  fs.chmodSync(file, 0o755);
}
function obligationRows(includeBeta = true) {
  const rows = [
    {
      kind: "packageObligation.v1",
      obligation_id: "obligation.alpha",
      adrs_ref: "roccho-dev/adrs#fixture",
      target_universe_id: "ops-all",
      repo_locator: "roccho-dev/ops",
      authority_surface: "adrs-release",
      package_id: "alpha",
      package_path: "packages/alpha",
      owner_role: "ops",
      goals: ["alpha-goal"],
      non_goals: ["alpha-non-goal"],
      requirements: ["alpha-requirement"],
      required_tests: ["alpha-check"],
      claim_required: true,
      receipt_required: true,
      residual_required: true,
      freshness_policy: "exact-commit",
      route_policy: "ops",
    },
  ];
  if (includeBeta) {
    rows.push({
      kind: "packageObligation.v1",
      obligation_id: "obligation.beta",
      adrs_ref: "roccho-dev/adrs#fixture",
      target_universe_id: "ops-all",
      repo_locator: "roccho-dev/ops",
      authority_surface: "adrs-release",
      package_id: "beta",
      package_path: "packages/beta",
      owner_role: "ops",
      goals: ["beta-goal"],
      non_goals: ["beta-non-goal"],
      requirements: ["beta-requirement"],
      required_tests: ["beta-check"],
      claim_required: true,
      receipt_required: true,
      residual_required: true,
      freshness_policy: "exact-commit",
      route_policy: "ops",
    });
  }
  rows.push({
    kind: "packageObligation.v1",
    obligation_id: "obligation.gamma",
    adrs_ref: "roccho-dev/adrs#fixture",
    target_universe_id: "ops-all",
    repo_locator: "roccho-dev/ops",
    authority_surface: "adrs-release",
    package_id: "gamma",
    package_path: "packages/gamma",
    owner_role: "ops",
    goals: ["explicit out-of-scope response"],
    non_goals: ["do not require an executable entrypoint"],
    requirements: ["emit one out-of-scope receipt"],
    required_tests: [],
    claim_required: false,
    receipt_required: true,
    residual_required: false,
    freshness_policy: "exact-commit",
    route_policy: "ops",
  });
  return rows;
}
function createRelease(root, fakeNixBin, rows, suffix, engineCommit) {
  const releaseDir = path.join(root, `release-${suffix}`);
  const output = path.join(releaseDir, "gov-package-output");
  writeJsonl(path.join(output, "package-obligations.jsonl"), rows);
  const narHash = execFileSync(fakeNixBin, ["hash", "path", "--type", "sha256", output], { encoding: "utf8" }).trim();
  const acceptedDecision = { kind: "acceptedDecision.fixture.v1", id: "package-obligations", status: "accepted" };
  const engineDescriptor = { kind: "govEngineDescriptor.v1", repository: "roccho-dev/governance", commitSha: engineCommit };
  const descriptor = { kind: "govNixOutputDescriptor.v1", package: "gov-package-output", narHash };
  const manifest = {
    kind: "govReleaseManifest.v1",
    releaseId: `fixture-package-obligations-${suffix}`,
    sequence: 0,
    previousReleaseDigest: null,
    supersedesReleaseDigest: null,
    acceptedDecisionDigest: objectDigest(acceptedDecision),
    govEngineDigest: objectDigest(engineDescriptor),
    nixOutputDigest: objectDigest(descriptor),
    status: "adopted",
  };
  const releaseDigest = objectDigest(manifest);
  const receipt = {
    kind: "govReleaseReadbackReceipt.v1",
    status: "pass",
    releaseId: manifest.releaseId,
    releaseDigest,
    observedManifestDigest: releaseDigest,
    adopted: true,
    authority: false,
    transport: { provider: "fixture" },
  };
  writeJson(path.join(releaseDir, "accepted-decision.json"), acceptedDecision);
  writeJson(path.join(releaseDir, "gov-engine-descriptor.json"), engineDescriptor);
  writeJson(path.join(releaseDir, "gov-nix-output-descriptor.json"), descriptor);
  writeJson(path.join(releaseDir, "gov-release-manifest.json"), manifest);
  writeJson(path.join(releaseDir, "gov-release-readback-receipt.json"), receipt);
  return releaseDir;
}
function createRepo(root) {
  fs.mkdirSync(path.join(root, "build"), { recursive: true });
  for (const id of ["alpha", "beta"]) {
    fs.mkdirSync(path.join(root, "packages", id, "bin"), { recursive: true });
    fs.writeFileSync(path.join(root, "packages", id, "bin", `${id}.mjs`), `#!/usr/bin/env node\nconsole.log(${JSON.stringify(id)})\n`);
  }
  fs.mkdirSync(path.join(root, "packages", "gamma"), { recursive: true });
  fs.writeFileSync(path.join(root, "packages", "gamma", "README.md"), "out of scope fixture package\n");
  writeJsonl(path.join(root, "build", "packages.jsonl"), [
    { kind: "package", name: "alpha", bin: "alpha", entry: "packages/alpha/bin/alpha.mjs", runtime: "node", deps: [], env: [] },
    { kind: "package", name: "beta", bin: "beta", entry: "packages/beta/bin/beta.mjs", runtime: "node", deps: [], env: [] },
  ]);
  writeJsonl(path.join(root, "build", "checks.jsonl"), []);
  git(root, "init", "-q");
  git(root, "config", "user.name", "fixture");
  git(root, "config", "user.email", "fixture@example.invalid");
  git(root, "add", ".");
  git(root, "commit", "-qm", "fixture");
}

export function createPackageResponseFixture({ includeBeta = true, suffix = includeBeta ? "all" : "missing" } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ops-package-responses-fixture-"));
  const repo = path.join(tmp, "repo");
  const fakeRoot = path.join(tmp, "fake-nix");
  const fakeBin = path.join(tmp, "nix");
  createRepo(repo);
  writeFakeNix(fakeBin, fakeRoot);
  for (const id of ["alpha-check", "beta-check"]) {
    const out = path.join(fakeRoot, "outputs", id);
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, "result.json"), JSON.stringify({ id, status: "pass" }) + "\n");
  }
  const engineCommit = git(repo, "rev-parse", "HEAD");
  const releaseDir = createRelease(tmp, fakeBin, obligationRows(includeBeta), suffix, engineCommit);
  return { tmp, repo, fakeRoot, fakeBin, releaseDir, governanceSource: `path:${repo}`, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

export function runSelftest({ execute, validatePacket }) {
  const passFixture = createPackageResponseFixture({ includeBeta: true, suffix: "all" });
  const blockedFixture = createPackageResponseFixture({ includeBeta: false, suffix: "missing" });
  try {
    const passOut = path.join(passFixture.tmp, "pass-out");
    const pass = execute({ releaseDir: passFixture.releaseDir, outDir: passOut, repoRoot: passFixture.repo, governanceSource: passFixture.governanceSource, system: "x86_64-linux", nixBin: passFixture.fakeBin });
    if (pass.status !== "pass" || pass.row_counts.receipts !== 3) throw Error("selftest-pass-packet");
    const passValidation = validatePacket(passOut, { strict: true });
    if (!passValidation.ok) throw Error(`selftest-pass-validation:${JSON.stringify(passValidation.errors)}`);
    const passReceipts = readJsonl(path.join(passOut, "ops-package-receipts.jsonl"));
    if (passReceipts.filter((row) => row.status === "pass").length !== 2 || passReceipts.filter((row) => row.status === "out-of-scope").length !== 1) throw Error("selftest-real-receipts");
    const gamma = passReceipts.find((row) => row.package_id === "gamma");
    if (!gamma || gamma.status !== "out-of-scope" || gamma.entrypoints.length !== 0 || gamma.residual_refs.length !== 0) throw Error("selftest-out-of-scope-entrypoint-boundary");
    const passEvidence = readJsonl(path.join(passOut, "ops-package-evidence.jsonl"));
    if (!passEvidence.every((row) => Array.isArray(row.command) && row.command.length && row.outputs.length === 1)) throw Error("selftest-command-and-output-binding");

    const firstLog = path.join(passOut, passEvidence[0].log_refs.stdout);
    const firstLogBytes = fs.readFileSync(firstLog);
    fs.appendFileSync(firstLog, "tamper\n");
    const logTamper = validatePacket(passOut, { strict: true });
    if (logTamper.ok || !logTamper.errors.some((row) => row.code === "evidence-log-digest-mismatch")) throw Error("selftest-log-tamper-not-rejected");
    fs.writeFileSync(firstLog, firstLogBytes);

    const evidenceFile = path.join(passOut, "ops-package-evidence.jsonl");
    fs.appendFileSync(firstLog, "coordinated-tamper\n");
    const coordinatedEvidence = readJsonl(evidenceFile);
    coordinatedEvidence[0].stdout_digest = bytesDigest(fs.readFileSync(firstLog));
    const coordinatedBase = { ...coordinatedEvidence[0] };
    delete coordinatedBase.evidence_digest;
    coordinatedEvidence[0].evidence_digest = objectDigest(coordinatedBase);
    writeJsonl(evidenceFile, coordinatedEvidence);
    const coordinatedTamper = validatePacket(passOut, { strict: true });
    if (coordinatedTamper.ok || !coordinatedTamper.errors.some((row) => row.code === "required-test-evidence-binding")) throw Error("selftest-coordinated-log-evidence-tamper-not-rejected");
    fs.writeFileSync(firstLog, firstLogBytes);
    writeJsonl(evidenceFile, passEvidence);

    const failMarker = path.join(passFixture.fakeRoot, "fail", "beta-check");
    fs.mkdirSync(path.dirname(failMarker), { recursive: true });
    fs.writeFileSync(failMarker, "fail\n");
    const failedCheckOut = path.join(passFixture.tmp, "failed-check-out");
    const failedCheck = execute({ releaseDir: passFixture.releaseDir, outDir: failedCheckOut, repoRoot: passFixture.repo, governanceSource: passFixture.governanceSource, system: "x86_64-linux", nixBin: passFixture.fakeBin });
    if (failedCheck.status !== "blocked" || !readJsonl(path.join(failedCheckOut, "ops-package-residuals.jsonl")).some((row) => row.code === "test-failing")) throw Error("selftest-failing-check-not-blocked");
    fs.rmSync(failMarker);

    const blockedOut = path.join(blockedFixture.tmp, "blocked-out");
    const blocked = execute({ releaseDir: blockedFixture.releaseDir, outDir: blockedOut, repoRoot: blockedFixture.repo, governanceSource: blockedFixture.governanceSource, system: "x86_64-linux", nixBin: blockedFixture.fakeBin });
    if (blocked.status !== "blocked") throw Error("selftest-blocked-packet");
    const structural = validatePacket(blockedOut);
    if (!structural.ok || structural.status !== "blocked") throw Error("selftest-blocked-structural");
    const strict = validatePacket(blockedOut, { strict: true });
    if (strict.ok || !strict.errors.some((row) => row.code === "blocking-package-receipt")) throw Error("selftest-blocked-strict");

    const dirtyFile = path.join(passFixture.repo, "untracked-dirty-file");
    fs.writeFileSync(dirtyFile, "dirty\n");
    let dirtyRejected = false;
    try {
      execute({ releaseDir: passFixture.releaseDir, outDir: path.join(passFixture.tmp, "dirty-out"), repoRoot: passFixture.repo, governanceSource: passFixture.governanceSource, system: "x86_64-linux", nixBin: passFixture.fakeBin });
    } catch (error) {
      dirtyRejected = String(error.message).includes("ops-worktree-not-clean");
    }
    fs.rmSync(dirtyFile);
    if (!dirtyRejected) throw Error("selftest-dirty-worktree-not-rejected");

    let sourceRejected = false;
    try {
      execute({ releaseDir: passFixture.releaseDir, outDir: path.join(passFixture.tmp, "wrong-source-out"), repoRoot: passFixture.repo, governanceSource: `github:roccho-dev/governance/${"0".repeat(40)}`, system: "x86_64-linux", nixBin: passFixture.fakeBin });
    } catch (error) {
      sourceRejected = String(error.message).includes("governance-source-ref-mismatch");
    }
    if (!sourceRejected) throw Error("selftest-wrong-governance-source-not-rejected");

    fs.appendFileSync(path.join(passFixture.releaseDir, "gov-package-output", "package-obligations.jsonl"), JSON.stringify({ tampered: true }) + "\n");
    let rejected = false;
    try {
      execute({ releaseDir: passFixture.releaseDir, outDir: path.join(passFixture.tmp, "tampered-out"), repoRoot: passFixture.repo, governanceSource: passFixture.governanceSource, system: "x86_64-linux", nixBin: passFixture.fakeBin });
    } catch (error) {
      rejected = String(error.message).includes("gov-package-output-nar-hash-mismatch");
    }
    if (!rejected) throw Error("selftest-tamper-not-rejected");
    return {
      ok: true,
      kind: "ops.packageResponseSelftest.v2",
      positive_all_packages: "pass",
      missing_obligation: "blocked",
      failing_required_check: "blocked",
      exact_release_tamper: "rejected",
      log_tamper: "rejected",
      coordinated_log_and_evidence_tamper: "rejected",
      dirty_worktree: "rejected",
      wrong_governance_source: "rejected",
      actual_check_outputs_bound: true,
      explicit_out_of_scope_without_entrypoint: true,
    };
  } finally {
    passFixture.cleanup();
    blockedFixture.cleanup();
  }
}
