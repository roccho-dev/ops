#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  PACKET_FILES,
  REPO_ID,
  bytesDigest,
  nonGoalIds,
  normalizeObligation,
  objectDigest,
  packetStatus,
  readJson,
  readJsonl,
  requirementIds,
  validatePacket,
  validateReleaseObjects,
  writeJsonl,
} from "../lib/core.mjs";

function usage() {
  return [
    "usage: ops-package-responses execute --release-dir <dir> --out-dir <dir> [--repo-root <dir>] --governance-source <path:...|github:...> [--system <system>] [--nix-bin <path>] [--json]",
    "       ops-package-responses emit --release-dir <dir> --out-dir <dir> [--repo-root <dir>] --governance-source <path:...|github:...> [--system <system>] [--nix-bin <path>] [--json]",
    "       ops-package-responses validate --out-dir <dir> [--strict] [--json]",
    "       ops-package-responses selftest [--json]",
  ].join("\n");
}
function parseArgv(input) {
  const args = [...input];
  let command = "execute", releaseDir, outDir, repoRoot, governanceSource, system = "x86_64-linux", nixBin = "nix", json = false, strict = false;
  if (args[0] && !args[0].startsWith("-")) command = args.shift();
  while (args.length) {
    const arg = args.shift();
    if (arg === "--release-dir") releaseDir = args.shift();
    else if (arg === "--out-dir") outDir = args.shift();
    else if (arg === "--repo-root") repoRoot = args.shift();
    else if (arg === "--governance-source") governanceSource = args.shift();
    else if (arg === "--system") system = args.shift();
    else if (arg === "--nix-bin") nixBin = args.shift();
    else if (arg === "--json") json = true;
    else if (arg === "--strict") strict = true;
    else throw Error(`unknown-argument:${arg}`);
  }
  return { command, releaseDir, outDir, repoRoot, governanceSource, system, nixBin, json, strict };
}
function up(start) {
  const values = [];
  let current = path.resolve(start);
  for (;;) {
    values.push(current);
    const parent = path.dirname(current);
    if (parent === current) return values;
    current = parent;
  }
}
function hasBuild(root) { return fs.existsSync(path.join(root, "build/packages.jsonl")); }
function repoRootOf(given) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return [given, process.cwd(), ...up(here)].filter(Boolean).map((value) => path.resolve(value)).find(hasBuild) ?? path.resolve(given ?? process.cwd());
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
  return { command: [command, ...args], exitCode: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? String(result.error?.message ?? "") };
}
function mustRun(command, args, options = {}) {
  const result = run(command, args, options);
  if (result.exitCode !== 0) throw Error(`command-failed:${result.command.join(" ")}:${result.stderr.trim()}`);
  return result.stdout.trim();
}
function safeId(value) { return String(value).replace(/[^A-Za-z0-9._-]+/g, "_"); }
function packagePathFromEntry(entry) {
  const parts = String(entry).split("/");
  return parts[0] === "packages" && parts[1] ? parts.slice(0, 2).join("/") : path.posix.dirname(String(entry));
}
function git(root, ...args) { return mustRun("git", ["-C", root, ...args]); }
function tryGit(root, ...args) {
  const result = run("git", ["-C", root, ...args]);
  return result.exitCode === 0 ? result.stdout.trim() : null;
}
function isInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
function requireCleanRepo(root) {
  const commit = git(root, "rev-parse", "HEAD");
  if (!/^[0-9a-f]{40}$/.test(commit)) throw Error(`ops-head-invalid:${commit}`);
  const status = git(root, "status", "--porcelain=v1", "--untracked-files=all");
  if (status) throw Error("ops-worktree-not-clean");
  return commit;
}
function prepareOutputDir(root, releaseDir, outDir) {
  const output = path.resolve(outDir);
  if (output === path.parse(output).root || isInside(root, output) || isInside(releaseDir, output) || output === path.resolve(releaseDir)) throw Error(`out-dir-unsafe:${output}`);
  if (fs.existsSync(output) && fs.lstatSync(output).isSymbolicLink()) throw Error(`out-dir-symlink:${output}`);
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  return output;
}
function entrypointRows(root) { return readJsonl(path.join(root, "build/packages.jsonl")); }
function flakeAttrNames(root, nixBin, system, surface, overrideArgs) {
  const raw = mustRun(nixBin, ["eval", "--json", "--no-write-lock-file", ...overrideArgs, `.#${surface}.${system}`, "--apply", "builtins.attrNames"], { cwd: root });
  const values = JSON.parse(raw);
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string")) throw Error(`flake-${surface}-inventory-invalid`);
  return [...new Set(values)].sort();
}
function inventory(root, outDir, observedAt, nixBin, system, overrideArgs) {
  const byId = new Map();
  for (const row of entrypointRows(root)) {
    const id = String(row.name);
    const current = byId.get(id) ?? { package_id: id, package_path: packagePathFromEntry(row.entry), entrypoints: [], source_kinds: new Set(), source_refs: [] };
    current.package_path = current.package_path || packagePathFromEntry(row.entry);
    current.entrypoints.push({ kind: "source", bin: row.bin, entry: row.entry, runtime: row.runtime, deps: row.deps ?? [] });
    current.source_kinds.add("build-packages-jsonl");
    current.source_refs.push(`build/packages.jsonl:${id}`);
    byId.set(id, current);
  }
  for (const id of flakeAttrNames(root, nixBin, system, "packages", overrideArgs)) {
    const current = byId.get(id) ?? { package_id: id, package_path: `flake.nix:packages.${system}.${id}`, entrypoints: [], source_kinds: new Set(), source_refs: [] };
    current.source_kinds.add("flake-package");
    current.source_refs.push(`flake.nix:packages.${system}.${id}`);
    const attr = `packages.${system}.${id}`;
    if (!current.entrypoints.some((entry) => entry.kind === "nix-package" && entry.attr === attr)) current.entrypoints.push({ kind: "nix-package", attr });
    byId.set(id, current);
  }
  const packagesDir = path.join(root, "packages");
  if (fs.existsSync(packagesDir)) {
    for (const item of fs.readdirSync(packagesDir, { withFileTypes: true }).filter((item) => item.isDirectory())) {
      const id = item.name;
      const current = byId.get(id) ?? { package_id: id, package_path: `packages/${id}`, entrypoints: [], source_kinds: new Set(), source_refs: [] };
      current.source_kinds.add("source-dir");
      current.source_refs.push(`packages/${id}`);
      byId.set(id, current);
    }
  }
  for (const file of PACKET_FILES) {
    const id = `ops-package-responses/${file}`;
    byId.set(id, { package_id: id, package_path: path.join(outDir, file), entrypoints: [], source_kinds: new Set(["evidence-output"]), source_refs: [file], item_kind: "evidence-output" });
  }
  return [...byId.values()].sort((a, b) => a.package_id.localeCompare(b.package_id)).map((row) => ({
    kind: "packageInventory.v1",
    inventory_id: `ops.inventory.${row.item_kind ?? "package"}.${safeId(row.package_id)}`,
    repo_locator: REPO_ID,
    repo: REPO_ID,
    package_id: row.package_id,
    packageId: row.package_id,
    package_path: row.package_path,
    packagePath: row.package_path,
    item_kind: row.item_kind ?? "package",
    source_kinds: [...row.source_kinds].sort(),
    source_refs: [...new Set(row.source_refs)].sort(),
    entrypoints: row.entrypoints.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    observed_at: observedAt,
    authority: false,
  }));
}
function loadRelease(releaseDir, nixBin) {
  if (!releaseDir) throw Error("--release-dir-is-required");
  const root = path.resolve(releaseDir);
  const outputDir = path.join(root, "gov-package-output");
  const files = {
    manifest: path.join(root, "gov-release-manifest.json"),
    acceptedDecision: path.join(root, "accepted-decision.json"),
    engineDescriptor: path.join(root, "gov-engine-descriptor.json"),
    descriptor: path.join(root, "gov-nix-output-descriptor.json"),
    readbackReceipt: path.join(root, "gov-release-readback-receipt.json"),
    obligations: path.join(outputDir, "package-obligations.jsonl"),
  };
  if (!fs.existsSync(outputDir) || !fs.lstatSync(outputDir).isDirectory() || fs.lstatSync(outputDir).isSymbolicLink()) throw Error(`gov-release-output-directory-invalid:${outputDir}`);
  const outputReal = fs.realpathSync(outputDir);
  for (const [name, file] of Object.entries(files)) {
    if (!fs.existsSync(file)) throw Error(`gov-release-file-missing:${name}:${file}`);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error(`gov-release-file-not-regular:${name}:${file}`);
    if (name === "obligations") {
      const real = fs.realpathSync(file);
      if (real !== outputReal && !real.startsWith(outputReal + path.sep)) throw Error(`gov-release-obligation-outside-output:${file}`);
    }
  }
  const observedNarHash = mustRun(nixBin, ["hash", "path", "--type", "sha256", outputDir]);
  const identity = validateReleaseObjects({ manifest: readJson(files.manifest), acceptedDecision: readJson(files.acceptedDecision), engineDescriptor: readJson(files.engineDescriptor), descriptor: readJson(files.descriptor), readbackReceipt: readJson(files.readbackReceipt), observedNarHash });
  return { root, outputDir, files, identity };
}
function governanceInput(source, expectedCommit) {
  if (!source) throw Error("--governance-source-is-required");
  if (source.startsWith("path:")) {
    const root = path.resolve(source.slice(5));
    if (!fs.existsSync(path.join(root, ".git"))) throw Error(`governance-source-not-git:${root}`);
    const observed = mustRun("git", ["-C", root, "rev-parse", "HEAD"]);
    if (observed !== expectedCommit) throw Error(`governance-source-commit-mismatch:${observed}:${expectedCommit}`);
    const ref = `git+${pathToFileURL(root).href}?rev=${expectedCommit}`;
    return { ref, mode: "local-git", commit: expectedCommit, override_args: ["--override-input", "governance", ref, "--override-input", "conventionGovernance", ref] };
  }
  const exactGithub = `github:roccho-dev/governance/${expectedCommit}`;
  if (source !== exactGithub) throw Error(`governance-source-ref-mismatch:${source}:${exactGithub}`);
  return { ref: source, mode: "github", commit: expectedCommit, override_args: ["--override-input", "governance", source, "--override-input", "conventionGovernance", source] };
}
function normalizeObligations(release, system) {
  const rows = readJsonl(release.files.obligations).map((row) => normalizeObligation(row, system)).filter((row) => row.repo_locator === REPO_ID);
  const byPackage = new Map(), ids = new Set();
  for (const row of rows) {
    if (byPackage.has(row.package_id)) throw Error(`duplicate-package-obligation:${row.package_id}`);
    if (ids.has(row.obligation_id)) throw Error(`duplicate-obligation-id:${row.obligation_id}`);
    byPackage.set(row.package_id, row); ids.add(row.obligation_id);
  }
  if (!rows.length) throw Error("ops-package-obligations-empty");
  return byPackage;
}
function hashFile(file) { return bytesDigest(fs.readFileSync(file)); }
function sourceObject(root, sourcePath) {
  const sha = tryGit(root, "rev-parse", `HEAD:${sourcePath}`);
  if (!sha) return null;
  const type = tryGit(root, "cat-file", "-t", sha);
  if (!["blob", "tree"].includes(type)) return null;
  return { path: sourcePath, type, object_id: `git-${type}-sha1:${sha}` };
}
function packageIdentity(root, inventoryRow) {
  const packagePath = inventoryRow.package_path;
  const primarySourcePath = packagePath.startsWith("flake.nix:") ? "flake.nix" : packagePath;
  const sourcePaths = new Set(primarySourcePath ? [primarySourcePath] : []);
  for (const entry of inventoryRow.entrypoints ?? []) if (entry.kind === "source") sourcePaths.add(entry.entry);
  const sourceObjects = [...sourcePaths].sort().map((value) => sourceObject(root, value)).filter(Boolean);
  const packageSource = { objects: sourceObjects, digest: objectDigest(sourceObjects) };
  const entrypoints = [];
  for (const entry of inventoryRow.entrypoints ?? []) {
    if (entry.kind === "nix-package") {
      entrypoints.push({ ...entry, exists: true, digest: objectDigest({ kind: entry.kind, attr: entry.attr }) });
      continue;
    }
    const file = path.join(root, entry.entry);
    entrypoints.push({ ...entry, exists: fs.existsSync(file), digest: fs.existsSync(file) ? hashFile(file) : null });
  }
  return { package_tree: sourceObjects.find((row) => row.type === "tree")?.object_id ?? null, package_source: packageSource, entrypoints };
}
function pathSummary(target, nixBin) {
  const stack = [target];
  let fileCount = 0, bytes = 0;
  while (stack.length) {
    const current = stack.pop();
    const stat = fs.lstatSync(current);
    if (stat.isDirectory()) for (const name of fs.readdirSync(current)) stack.push(path.join(current, name));
    else { fileCount += 1; bytes += stat.isSymbolicLink() ? Buffer.byteLength(fs.readlinkSync(current)) : stat.size; }
  }
  return { path_digest: mustRun(nixBin, ["hash", "path", "--type", "sha256", target]), file_count: fileCount, bytes };
}
function executeTest({ root, outDir, packageId, obligation, testId, system, nixBin, repoIdentity, packageIdentityValue, governanceInputValue }) {
  const attr = `.#checks.${system}.${testId}`;
  const args = ["build", "--no-link", "--print-out-paths", "--no-write-lock-file", ...governanceInputValue.override_args, attr];
  const result = run(nixBin, args, { cwd: root });
  const logDir = path.join(outDir, "logs", safeId(packageId));
  fs.mkdirSync(logDir, { recursive: true });
  const stdoutRef = path.relative(outDir, path.join(logDir, `${safeId(testId)}.stdout`));
  const stderrRef = path.relative(outDir, path.join(logDir, `${safeId(testId)}.stderr`));
  fs.writeFileSync(path.join(outDir, stdoutRef), result.stdout);
  fs.writeFileSync(path.join(outDir, stderrRef), result.stderr);
  const outputPaths = result.exitCode === 0 ? result.stdout.split("\n").map((line) => line.trim()).filter((line) => line && fs.existsSync(line)) : [];
  const outputs = outputPaths.map((outputPath) => pathSummary(outputPath, nixBin));
  const command = ["nix", "build", "--no-link", "--print-out-paths", "--no-write-lock-file", "--governance-engine-commit", governanceInputValue.commit, attr];
  const semantic = {
    release_digest: obligation.release_digest,
    accepted_decision_digest: obligation.accepted_decision_digest,
    obligation_digest: obligation.obligation_digest,
    repo_commit: repoIdentity.commit,
    repo_tree: repoIdentity.tree,
    package_tree: packageIdentityValue.package_tree,
    package_source_digest: packageIdentityValue.package_source.digest,
    toolchain: repoIdentity.toolchain,
    package_id: packageId,
    test_id: testId,
    check_ref: `checks.${system}.${testId}`,
    command,
    command_digest: objectDigest(command),
    exit_code: result.exitCode,
    outputs,
    status: result.exitCode === 0 && outputs.length > 0 ? "pass" : "blocked",
  };
  const evidenceId = `evidence.${safeId(packageId)}.${safeId(testId)}.${objectDigest(semantic).slice(7, 19)}`;
  const evidence = {
    kind: "ops.packageTestEvidence.v1",
    evidence_id: evidenceId,
    response_claim_id: `ops-package-response.${packageId}`,
    ...semantic,
    semantic_evidence_digest: objectDigest(semantic),
    stdout_digest: bytesDigest(Buffer.from(result.stdout)),
    stderr_digest: bytesDigest(Buffer.from(result.stderr)),
    log_refs: { stdout: stdoutRef, stderr: stderrRef },
    authority: false,
  };
  return { ...evidence, evidence_digest: objectDigest(evidence) };
}
function residual(packageId, claimId, code, reason, obligation = null) {
  return {
    kind: "ops.packageResidual.v1",
    residual_id: `residual.${safeId(packageId)}.${safeId(code)}`,
    response_claim_id: claimId,
    package_id: packageId,
    obligation_id: obligation?.obligation_id ?? null,
    status: "returned",
    code,
    returned_to: "governance-final-scope-purpose-join",
    reason,
    authority: false,
  };
}
function canonicalResponse(response) {
  return {
    kind: "packageResponse.v1", claimId: response.claim_id, claim_id: response.claim_id, adrsRef: response.adrs_ref, adrs_ref: response.adrs_ref, obligationId: response.obligation_id, obligation_id: response.obligation_id, repo: response.repo_locator, repo_locator: response.repo_locator, packageId: response.package_id, package_id: response.package_id, packagePath: response.package_path, package_path: response.package_path, ownerRole: response.owner_role, owner_role: response.owner_role, tests: response.test_refs, test_refs: response.test_refs, receipt: response.receipt_ref, receipt_ref: response.receipt_ref, residuals: response.residuals, state: response.state, governanceReleaseDigest: response.governance_release_digest, acceptedDecisionDigest: response.accepted_decision_digest, authority: false, source_kind: response.kind,
  };
}
function canonicalResidual(row) {
  return { kind: "packageResidual.v1", residualId: row.residual_id, residual_id: row.residual_id, responseClaimId: row.response_claim_id, response_claim_id: row.response_claim_id, packageId: row.package_id, package_id: row.package_id, obligationId: row.obligation_id, obligation_id: row.obligation_id, status: row.status, code: row.code, returnedTo: row.returned_to, returned_to: row.returned_to, reason: row.reason, authority: false, source_kind: row.kind };
}
function execute({ releaseDir, outDir, repoRoot, governanceSource, system, nixBin }) {
  if (!outDir) throw Error("--out-dir-is-required");
  const root = repoRootOf(repoRoot);
  const repoCommit = requireCleanRepo(root);
  const release = loadRelease(releaseDir, nixBin);
  const output = prepareOutputDir(root, release.root, outDir);
  const governanceInputValue = governanceInput(governanceSource, release.identity.governance_engine_commit);
  const obligations = normalizeObligations(release, system);
  const repoIdentity = {
    commit: repoCommit,
    tree: `git-tree-sha1:${git(root, "rev-parse", "HEAD^{tree}")}`,
    observed_at: git(root, "show", "-s", "--format=%cI", "HEAD"),
    toolchain: { nix: mustRun(nixBin, ["--version"]), git: mustRun("git", ["--version"]), system, governance_engine_commit: governanceInputValue.commit },
  };
  const inventoryRows = inventory(root, output, repoIdentity.observed_at, nixBin, system, governanceInputValue.override_args);
  const availableChecks = new Set(flakeAttrNames(root, nixBin, system, "checks", governanceInputValue.override_args));
  const packageInventory = inventoryRows.filter((row) => row.item_kind === "package");
  const inventoryById = new Map(packageInventory.map((row) => [row.package_id, row]));
  const packageIds = [...new Set([...inventoryById.keys(), ...obligations.keys()])].sort();
  const responses = [], evidence = [], receipts = [], residuals = [], drifts = [];
  for (const packageId of packageIds) {
    const inv = inventoryById.get(packageId), baseObligation = obligations.get(packageId);
    const claimId = `ops-package-response.${packageId}`;
    const localResiduals = [], localEvidence = [];
    const packageIdentityValue = inv ? packageIdentity(root, inv) : { package_tree: null, entrypoints: [] };
    if (!baseObligation) localResiduals.push(residual(packageId, claimId, "obligation-missing", "package exists in ops inventory but exact gov release contains no package obligation"));
    if (!inv) localResiduals.push(residual(packageId, claimId, "registered-package-missing-on-disk", "exact gov release package obligation has no matching ops package", baseObligation));
    if (baseObligation && inv && baseObligation.package_path !== inv.package_path) localResiduals.push(residual(packageId, claimId, "package-path-drift", `gov=${baseObligation.package_path} ops=${inv.package_path}`, baseObligation));
    if (inv && baseObligation?.claim_required && !(inv.entrypoints?.length)) localResiduals.push(residual(packageId, claimId, "entrypoint-missing", "selected package has no executable source or Nix entrypoint", baseObligation));
    if (inv && baseObligation?.claim_required && inv.entrypoints?.some((entry) => entry.kind === "source" && !fs.existsSync(path.join(root, entry.entry)))) localResiduals.push(residual(packageId, claimId, "entrypoint-path-missing", "one or more selected source entrypoints do not exist", baseObligation));
    if (inv && baseObligation?.claim_required && !(packageIdentityValue.package_source?.objects?.length)) localResiduals.push(residual(packageId, claimId, "package-source-missing", "selected package has no exact Git source object", baseObligation));
    const obligation = baseObligation ? { ...baseObligation, ...release.identity } : null;
    if (obligation && obligation.claim_required && !obligation.required_tests.length) localResiduals.push(residual(packageId, claimId, "required-test-missing", "package obligation requires a claim but declares no required tests", obligation));
    if (obligation?.claim_required) {
      for (const testId of obligation.required_tests) if (!availableChecks.has(testId)) localResiduals.push(residual(packageId, claimId, "required-test-unknown", `required test ${testId} is absent from checks.${system}`, obligation));
    }
    if (obligation && inv && localResiduals.length === 0 && obligation.claim_required) {
      for (const testId of obligation.required_tests) {
        const row = executeTest({ root, outDir: output, packageId, obligation, testId, system, nixBin, repoIdentity, packageIdentityValue, governanceInputValue });
        localEvidence.push(row);
        if (row.status !== "pass") localResiduals.push(residual(packageId, claimId, "test-failing", `required test ${testId} did not produce a successful Nix check output`, obligation));
      }
    }
    const status = localResiduals.length ? "blocked" : !obligation?.claim_required && obligation ? "out-of-scope" : "pass";
    const state = status === "pass" ? "covered" : status === "out-of-scope" ? "out-of-scope" : "blocked";
    evidence.push(...localEvidence); residuals.push(...localResiduals);
    for (const row of localResiduals) drifts.push({ kind: "packageDrift.v1", drift_id: `ops.packageDrift.${safeId(row.code)}.${safeId(packageId)}`, driftId: `ops.packageDrift.${safeId(row.code)}.${safeId(packageId)}`, drift_type: row.code, driftType: row.code, repo: REPO_ID, repo_locator: REPO_ID, package_id: packageId, packageId: packageId, package_path: inv?.package_path ?? obligation?.package_path ?? null, packagePath: inv?.package_path ?? obligation?.package_path ?? null, status: "open", severity: "blocking", meaning: row.reason, returned_to: row.returned_to, authority: false });
    const receiptBase = {
      kind: "ops.packageReceipt.v2", receipt_id: `receipt.${safeId(packageId)}`, response_claim_id: claimId, repo_locator: REPO_ID, package_id: packageId, status, governance_release_digest: release.identity.release_digest, accepted_decision_digest: release.identity.accepted_decision_digest, obligation_id: obligation?.obligation_id ?? null, obligation_digest: obligation?.obligation_digest ?? null, obligation: baseObligation ?? null, repo_commit: repoIdentity.commit, repo_tree: repoIdentity.tree, package_tree: packageIdentityValue.package_tree, package_source: packageIdentityValue.package_source, toolchain: repoIdentity.toolchain, entrypoints: packageIdentityValue.entrypoints, required_tests: localEvidence.map((row) => ({ test_id: row.test_id, evidence_ref: row.evidence_id, evidence_digest: row.evidence_digest })), evidence_refs: localEvidence.map((row) => row.evidence_id), residual_refs: localResiduals.map((row) => row.residual_id), observed_at: repoIdentity.observed_at, emitted_by: "ops-package-responses", authority: false,
    };
    const receipt = { ...receiptBase, receipt_digest: objectDigest(receiptBase) };
    receipts.push(receipt);
    responses.push({
      kind: "ops.packageResponse.v2", claim_id: claimId, adrs_ref: obligation?.adrs_ref ?? "", obligation_id: obligation?.obligation_id ?? null, obligation_digest: obligation?.obligation_digest ?? null, governance_release_digest: release.identity.release_digest, accepted_decision_digest: release.identity.accepted_decision_digest, repo_locator: REPO_ID, authority_surface: obligation?.authority_surface ?? "", target_universe_id: obligation?.target_universe_id ?? "", package_id: packageId, package_path: inv?.package_path ?? obligation?.package_path ?? null, owner_role: obligation?.owner_role ?? "unknown", state, covered_requirements: status === "pass" ? requirementIds(obligation.requirements) : [], protected_non_goals: status === "pass" ? nonGoalIds(obligation.non_goals) : [], test_refs: obligation?.required_tests ?? [], evidence_refs: receipt.evidence_refs, receipt_ref: receipt.receipt_id, residuals: receipt.residual_refs, blocked_reason: localResiduals.map((row) => row.code).join(","), evidence_freshness: { status: "current", source: "exact-gov-release+actual-nix-check", repo_commit: repoIdentity.commit, governance_release_digest: release.identity.release_digest }, overclaim_boundary: "ops reports exact execution evidence only; ADRS owns meaning and governance owns final join", authority: false,
    });
  }
  const canonicalResponses = responses.map(canonicalResponse), canonicalResiduals = residuals.map(canonicalResidual);
  writeJsonl(path.join(output, "ops-package-responses.jsonl"), responses);
  writeJsonl(path.join(output, "ops-package-evidence.jsonl"), evidence);
  writeJsonl(path.join(output, "ops-package-receipts.jsonl"), receipts);
  writeJsonl(path.join(output, "ops-package-residuals.jsonl"), residuals);
  writeJsonl(path.join(output, "package-inventory.jsonl"), inventoryRows);
  writeJsonl(path.join(output, "package-responses.jsonl"), canonicalResponses);
  writeJsonl(path.join(output, "package-residuals.jsonl"), canonicalResiduals);
  writeJsonl(path.join(output, "package-drifts.jsonl"), drifts);
  const status = packetStatus(receipts);
  const manifest = { kind: "ops.packageResponsePacket.v2", status, repo_locator: REPO_ID, repo_commit: repoIdentity.commit, repo_tree: repoIdentity.tree, observed_at: repoIdentity.observed_at, governance_release_id: release.identity.release_id, governance_release_digest: release.identity.release_digest, accepted_decision_digest: release.identity.accepted_decision_digest, governance_engine_digest: release.identity.governance_engine_digest, governance_engine_commit: release.identity.governance_engine_commit, governance_output_descriptor_digest: release.identity.governance_output_descriptor_digest, governance_output_nar_hash: release.identity.governance_output_nar_hash, system, toolchain: repoIdentity.toolchain, authority: false, files: PACKET_FILES, row_counts: { responses: responses.length, evidence: evidence.length, receipts: receipts.length, residuals: residuals.length, inventory: inventoryRows.length, canonical_responses: canonicalResponses.length, canonical_residuals: canonicalResiduals.length, drifts: drifts.length }, boundary: "exact gov release obligations are executed through actual Nix check outputs; missing obligation, entrypoint, test, output, receipt, or residual is blocking" };
  fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return { ok: true, ...manifest };
}
async function selftest() {
  const module = await import("../lib/selftest.mjs");
  return module.runSelftest({ execute, validatePacket });
}

try {
  const args = parseArgv(process.argv.slice(2));
  let result;
  if (args.command === "execute" || args.command === "emit") result = execute(args);
  else if (args.command === "validate") result = validatePacket(path.resolve(args.outDir ?? ""), { strict: args.strict });
  else if (args.command === "selftest") result = await selftest();
  else throw Error(`unknown-command:${args.command}`);
  if (args.json || args.command !== "execute") process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  else process.stdout.write(`ops package response packet: ${result.status}\n`);
  process.exit(result.ok === false ? 1 : 0);
} catch (error) {
  process.stderr.write(`${error.message}\n${usage()}\n`);
  process.exit(2);
}
