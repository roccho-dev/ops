#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoId = "roccho-dev/ops";
const repoClass = "effectful_executor";
const packetFiles = [
  "manifest.json",
  "repo.json",
  "packages.jsonl",
  "assertions.jsonl",
  "receipts.jsonl",
  "readmeProjectionReceipt.jsonl",
  "provider-ci.jsonl",
  "findings.jsonl",
  "admission.jsonl",
];
function usage() {
  return [
    "usage: ops-gov-package-output execute --release-dir <dir> --out-dir <dir> [--repo-root <dir>] --governance-source <path:...|github:...> [--system <system>] [--nix-bin <path>] [--json]",
    "       ops-gov-package-output emit --release-dir <dir> --out-dir <dir> [--repo-root <dir>] --governance-source <path:...|github:...> [--system <system>] [--nix-bin <path>] [--json]",
    "       ops-gov-package-output validate --out-dir <dir> [--strict] [--json]",
    "       ops-gov-package-output selftest [--json]",
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
function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
  return value;
}
function objectDigest(value) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(sortValue(value))).digest("hex")}`;
}
function bytesDigest(value) { return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`; }
function isDigest(value) { return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value); }
function readJson(file) {
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error(`json-object-required:${file}`);
  return value;
}
function readJsonl(file) {
  const text = fs.readFileSync(file, "utf8");
  if (text && !text.endsWith("\n")) throw Error(`jsonl-final-newline-required:${file}`);
  return text.split("\n").filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch (error) { throw Error(`${file}:${index + 1}:${error.message}`); }
  });
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}
function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
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
function packageResponsesCommand(_repoRoot) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sourceSibling = path.resolve(here, "..", "..", "ops-package-responses", "bin", "ops-package-responses.mjs");
  return fs.existsSync(sourceSibling) ? [process.execPath, sourceSibling] : ["ops-package-responses"];
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
  return { exitCode: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? String(result.error?.message ?? "") };
}
function runPackageResponses({ repoRoot, releaseDir, outDir, governanceSource, system, nixBin }) {
  const cmd = packageResponsesCommand(repoRoot);
  const args = [...cmd.slice(1), "execute", "--release-dir", releaseDir, "--out-dir", outDir, "--repo-root", repoRoot, "--governance-source", governanceSource, "--system", system, "--nix-bin", nixBin, "--json"];
  const emitted = run(cmd[0], args);
  if (emitted.exitCode !== 0) throw Error(`ops-package-responses-execute-failed:${emitted.stderr.trim()}`);
  const validate = run(cmd[0], [...cmd.slice(1), "validate", "--out-dir", outDir, "--json"]);
  if (validate.exitCode !== 0) throw Error(`ops-package-responses-validate-failed:${validate.stdout || validate.stderr}`);
  const report = JSON.parse(validate.stdout);
  if (!report.ok) throw Error(`ops-package-responses-invalid:${JSON.stringify(report.errors)}`);
  return report;
}
function sourcePacket(sourceDir) {
  const manifest = readJson(path.join(sourceDir, "manifest.json"));
  if (manifest.kind !== "ops.packageResponsePacket.v2" || manifest.authority !== false) throw Error("source-packet-boundary");
  const rows = {
    responses: readJsonl(path.join(sourceDir, "ops-package-responses.jsonl")),
    evidence: readJsonl(path.join(sourceDir, "ops-package-evidence.jsonl")),
    receipts: readJsonl(path.join(sourceDir, "ops-package-receipts.jsonl")),
    residuals: readJsonl(path.join(sourceDir, "ops-package-residuals.jsonl")),
    drifts: readJsonl(path.join(sourceDir, "package-drifts.jsonl")),
  };
  return { manifest, rows, digest: objectDigest({ manifest, ...rows }) };
}
function project(sourceDir, outDir) {
  const source = sourcePacket(sourceDir);
  const output = path.resolve(outDir);
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const sourceLogs = path.join(sourceDir, "logs");
  if (fs.existsSync(sourceLogs)) fs.cpSync(sourceLogs, path.join(output, "logs"), { recursive: true });
  const responseByPackage = new Map(source.rows.responses.map((row) => [row.package_id, row]));
  const evidenceById = new Map(source.rows.evidence.map((row) => [row.evidence_id, row]));
  const residualsByPackage = new Map();
  for (const row of source.rows.residuals) {
    const values = residualsByPackage.get(row.package_id) ?? [];
    values.push(row);
    residualsByPackage.set(row.package_id, values);
  }
  const packageRows = source.rows.responses.map((row) => ({
    kind: "govPackageRow.v1",
    repoId,
    packageId: row.package_id,
    packagePath: row.package_path,
    packageClass: "ops_effectful_evidence_surface",
    purposeRef: row.adrs_ref,
    contractRefs: row.obligation_id ? [row.obligation_id] : [],
    assertionRefs: [row.claim_id],
    receiptRefs: [row.receipt_ref],
    status: row.state === "covered" ? "candidate-pass" : row.state,
    governanceReleaseDigest: row.governance_release_digest,
    acceptedDecisionDigest: row.accepted_decision_digest,
    nonAuthority: true,
  }));
  const assertionRows = source.rows.responses.map((row) => ({
    kind: "govPackageAssertion.v1",
    repoId,
    packageId: row.package_id,
    assertion: row.state === "covered"
      ? "actual Nix check outputs satisfy the exact package obligation"
      : "the package answered the exact release with blocking residual evidence",
    adrsRef: row.adrs_ref,
    obligationId: row.obligation_id,
    obligationDigest: row.obligation_digest,
    claimId: row.claim_id,
    governanceReleaseDigest: row.governance_release_digest,
    acceptedDecisionDigest: row.accepted_decision_digest,
    status: row.state === "covered" ? "candidate-pass" : row.state,
    authority: false,
  }));
  const receiptRows = source.rows.receipts.map((row) => ({
    kind: "govPackageReceipt.v1",
    repoId,
    packageId: row.package_id,
    receiptRef: row.receipt_id,
    receiptClass: "ops-package-execution",
    receiptDigest: row.receipt_digest,
    checkId: "ops-package-responses",
    governanceReleaseDigest: row.governance_release_digest,
    acceptedDecisionDigest: row.accepted_decision_digest,
    obligationId: row.obligation_id,
    obligationDigest: row.obligation_digest,
    repoCommit: row.repo_commit,
    repoTree: row.repo_tree,
    packageTree: row.package_tree,
    packageSource: row.package_source,
    entrypoints: row.entrypoints,
    requiredTests: row.required_tests,
    evidence: (row.evidence_refs ?? []).map((id) => evidenceById.get(id)).filter(Boolean),
    residualRefs: row.residual_refs,
    status: row.status,
    authority: false,
  }));
  const findingRows = source.rows.residuals.map((row) => ({
    kind: "govPackageFinding.v1",
    repoId,
    packageId: row.package_id,
    contractId: row.obligation_id,
    adrsRef: responseByPackage.get(row.package_id)?.adrs_ref ?? "",
    diagnosticClass: row.code,
    severity: "blocking",
    blocking: true,
    expected: "one exact obligation-bound PASS receipt for every ops package",
    actual: row.reason,
    delta: row.status,
    likelyOwner: row.obligation_id ? "ops" : "adrs/governance",
    nextAction: row.returned_to,
    decisionDigest: source.manifest.accepted_decision_digest,
    receiptDigest: source.rows.receipts.find((receipt) => receipt.package_id === row.package_id)?.receipt_digest ?? null,
    authority: false,
  }));
  const admissionRows = source.rows.responses.map((row) => ({
    kind: "govPackageAdmission.v1",
    repoId,
    packageId: row.package_id,
    status: row.state === "covered" ? "candidate-pass" : row.state === "out-of-scope" ? "out-of-scope" : "blocked",
    active: false,
    reason: row.state === "covered"
      ? "exact package execution is Green; organization-active remains owned by the governance final join"
      : row.state === "out-of-scope"
        ? "the exact release explicitly requires no package claim"
        : "blocking package execution residual remains",
    governanceReleaseDigest: row.governance_release_digest,
    authority: false,
  }));
  const repo = {
    kind: "govRepoOutput.v1",
    repoId,
    repoClass,
    purpose: "Emit actual ops package execution receipts against one exact governance release.",
    authorityBoundary: "ADRS owns accepted meaning; governance owns final join; ops executes package obligations and emits evidence only.",
    finalGateRef: "gov-final-scope-purpose-join / gate",
    nonGoals: [
      "do not mint package obligations in ops",
      "do not replace exact release digests with local fallback hashes",
      "do not mark organization-active inside ops",
      "do not convert missing obligation, test, output, or receipt into Green",
    ],
  };
  const readmeReceipt = [{
    kind: "readmeProjectionReceipt.v1",
    repoId,
    surface: "README.md",
    projectionMode: "exact-release-execution",
    status: "not-final-authority",
    governanceReleaseDigest: source.manifest.governance_release_digest,
    authority: false,
  }];
  const providerCi = [{
    kind: "govProviderCiRow.v1",
    repoId,
    workflow: "gov package validation",
    role: "exact-release-package-receipt-producer",
    status: source.manifest.status,
    governanceReleaseDigest: source.manifest.governance_release_digest,
    sourcePacketDigest: source.digest,
    evidenceLogRoot: "logs",
    authority: false,
  }];
  const manifest = {
    kind: "govPackageOutput.v1",
    repoId,
    repoClass,
    projectionMode: "exact-release-execution",
    nonAuthority: true,
    status: source.manifest.status,
    governanceReleaseId: source.manifest.governance_release_id,
    governanceReleaseDigest: source.manifest.governance_release_digest,
    acceptedDecisionDigest: source.manifest.accepted_decision_digest,
    opsCommit: source.manifest.repo_commit,
    opsTree: source.manifest.repo_tree,
    sourcePacketDigest: source.digest,
    sourceRefs: [
      `gov-release:${source.manifest.governance_release_digest}`,
      `accepted-decision:${source.manifest.accepted_decision_digest}`,
      `ops-commit:${source.manifest.repo_commit}`,
    ],
    packetFiles,
    rowCounts: {
      packages: packageRows.length,
      assertions: assertionRows.length,
      receipts: receiptRows.length,
      findings: findingRows.length,
      admission: admissionRows.length,
    },
  };
  writeJson(path.join(output, "manifest.json"), manifest);
  writeJson(path.join(output, "repo.json"), repo);
  writeJsonl(path.join(output, "packages.jsonl"), packageRows);
  writeJsonl(path.join(output, "assertions.jsonl"), assertionRows);
  writeJsonl(path.join(output, "receipts.jsonl"), receiptRows);
  writeJsonl(path.join(output, "readmeProjectionReceipt.jsonl"), readmeReceipt);
  writeJsonl(path.join(output, "provider-ci.jsonl"), providerCi);
  writeJsonl(path.join(output, "findings.jsonl"), findingRows);
  writeJsonl(path.join(output, "admission.jsonl"), admissionRows);
  return { ok: true, ...manifest };
}
function execute({ releaseDir, outDir, repoRoot, governanceSource, system, nixBin }) {
  if (!releaseDir) throw Error("--release-dir-is-required");
  if (!outDir) throw Error("--out-dir-is-required");
  const root = repoRootOf(repoRoot);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ops-gov-package-output-source-"));
  try {
    runPackageResponses({ repoRoot: root, releaseDir: path.resolve(releaseDir), outDir: tmp, governanceSource, system, nixBin });
    return project(tmp, outDir);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
function validate(outDir, { strict = false } = {}) {
  const root = path.resolve(outDir ?? "");
  const errors = [];
  for (const file of packetFiles) if (!fs.existsSync(path.join(root, file))) errors.push({ code: "missing-file", file });
  if (errors.length) return { ok: false, status: "invalid", strict, errors };
  const manifest = readJson(path.join(root, "manifest.json"));
  const rows = {
    packages: readJsonl(path.join(root, "packages.jsonl")),
    assertions: readJsonl(path.join(root, "assertions.jsonl")),
    receipts: readJsonl(path.join(root, "receipts.jsonl")),
    readme: readJsonl(path.join(root, "readmeProjectionReceipt.jsonl")),
    provider: readJsonl(path.join(root, "provider-ci.jsonl")),
    findings: readJsonl(path.join(root, "findings.jsonl")),
    admission: readJsonl(path.join(root, "admission.jsonl")),
  };
  if (manifest.kind !== "govPackageOutput.v1" || manifest.repoId !== repoId || manifest.projectionMode !== "exact-release-execution" || manifest.nonAuthority !== true) errors.push({ code: "manifest-boundary" });
  if (!isDigest(manifest.governanceReleaseDigest) || !isDigest(manifest.acceptedDecisionDigest) || !isDigest(manifest.sourcePacketDigest)) errors.push({ code: "manifest-digest-binding" });
  for (const [name, values] of Object.entries({ packages: rows.packages, assertions: rows.assertions, receipts: rows.receipts, findings: rows.findings, admission: rows.admission })) {
    if (manifest.rowCounts?.[name] !== values.length) errors.push({ code: "manifest-row-count-drift", field: name });
  }
  const packageIds = new Set(rows.packages.map((row) => row.packageId));
  const assertionIds = new Set(rows.assertions.map((row) => row.packageId));
  const receiptByPackage = new Map(rows.receipts.map((row) => [row.packageId, row]));
  const admissionByPackage = new Map(rows.admission.map((row) => [row.packageId, row]));
  const findingsByPackage = new Map();
  for (const row of rows.findings) {
    const values = findingsByPackage.get(row.packageId) ?? [];
    values.push(row);
    findingsByPackage.set(row.packageId, values);
  }
  if (packageIds.size !== rows.packages.length) errors.push({ code: "duplicate-package-row" });
  for (const packageId of packageIds) {
    if (!assertionIds.has(packageId)) errors.push({ code: "package-without-assertion", packageId });
    const receipt = receiptByPackage.get(packageId);
    const admission = admissionByPackage.get(packageId);
    if (!receipt) errors.push({ code: "package-without-receipt", packageId });
    if (!admission) errors.push({ code: "package-without-admission", packageId });
    if (admission?.active !== false) errors.push({ code: "ops-minted-active-admission", packageId });
    if (receipt && (receipt.governanceReleaseDigest !== manifest.governanceReleaseDigest || receipt.acceptedDecisionDigest !== manifest.acceptedDecisionDigest || !isDigest(receipt.receiptDigest))) errors.push({ code: "receipt-release-binding", packageId });
    if (receipt) {
      if (!Array.isArray(receipt.packageSource?.objects) || !isDigest(receipt.packageSource?.digest) || objectDigest(receipt.packageSource.objects ?? []) !== receipt.packageSource?.digest) errors.push({ code: "receipt-package-source", packageId });
      const expectedEvidence = new Map((receipt.requiredTests ?? []).map((row) => [row.evidence_ref, row.evidence_digest]));
      const observedEvidence = new Set();
      for (const evidence of receipt.evidence ?? []) {
        if (!evidence || evidence.kind !== "ops.packageTestEvidence.v1" || evidence.package_id !== packageId || evidence.authority !== false) { errors.push({ code: "receipt-evidence-boundary", packageId }); continue; }
        if (observedEvidence.has(evidence.evidence_id)) errors.push({ code: "receipt-evidence-duplicate", packageId, evidenceId: evidence.evidence_id });
        observedEvidence.add(evidence.evidence_id);
        if (expectedEvidence.get(evidence.evidence_id) !== evidence.evidence_digest || evidence.package_source_digest !== receipt.packageSource?.digest) errors.push({ code: "receipt-evidence-digest-binding", packageId, evidenceId: evidence.evidence_id });
        const semantic = {
          release_digest: evidence.release_digest,
          accepted_decision_digest: evidence.accepted_decision_digest,
          obligation_digest: evidence.obligation_digest,
          repo_commit: evidence.repo_commit,
          repo_tree: evidence.repo_tree,
          package_tree: evidence.package_tree,
          package_source_digest: evidence.package_source_digest,
          toolchain: evidence.toolchain,
          package_id: evidence.package_id,
          test_id: evidence.test_id,
          check_ref: evidence.check_ref,
          command: evidence.command,
          command_digest: evidence.command_digest,
          exit_code: evidence.exit_code,
          outputs: evidence.outputs,
          status: evidence.status,
        };
        if (!isDigest(evidence.semantic_evidence_digest) || objectDigest(semantic) !== evidence.semantic_evidence_digest) errors.push({ code: "receipt-evidence-semantic-digest", packageId, evidenceId: evidence.evidence_id });
        const evidenceBase = { ...evidence };
        delete evidenceBase.evidence_digest;
        if (!isDigest(evidence.evidence_digest) || objectDigest(evidenceBase) !== evidence.evidence_digest) errors.push({ code: "receipt-evidence-full-digest", packageId, evidenceId: evidence.evidence_id });
        for (const [stream, expectedDigest] of [["stdout", evidence.stdout_digest], ["stderr", evidence.stderr_digest]]) {
          const ref = evidence.log_refs?.[stream];
          if (!ref || path.isAbsolute(ref) || ref.split(path.sep).includes("..")) { errors.push({ code: "receipt-evidence-log-ref", packageId, evidenceId: evidence.evidence_id, stream }); continue; }
          const file = path.resolve(root, ref);
          const boundary = root + path.sep;
          if (!file.startsWith(boundary) || !fs.existsSync(file) || !fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) { errors.push({ code: "receipt-evidence-log-missing", packageId, evidenceId: evidence.evidence_id, stream }); continue; }
          if (bytesDigest(fs.readFileSync(file)) !== expectedDigest) errors.push({ code: "receipt-evidence-log-digest", packageId, evidenceId: evidence.evidence_id, stream });
        }
      }
      if (JSON.stringify([...observedEvidence].sort()) !== JSON.stringify([...expectedEvidence.keys()].sort())) errors.push({ code: "receipt-evidence-set-drift", packageId });
    }
    const packageRow = rows.packages.find((row) => row.packageId === packageId);
    if (packageRow?.status === "candidate-pass" && (receipt?.status !== "pass" || findingsByPackage.get(packageId)?.some((row) => row.blocking))) errors.push({ code: "candidate-pass-without-clean-receipt", packageId });
    if (packageRow?.status === "blocked" && (!findingsByPackage.get(packageId)?.length || receipt?.status !== "blocked")) errors.push({ code: "blocked-without-finding", packageId });
  }
  for (const row of [...rows.assertions, ...rows.receipts, ...rows.readme, ...rows.provider, ...rows.findings, ...rows.admission]) if (row.authority !== false) errors.push({ code: "authority-boundary", kind: row.kind, packageId: row.packageId });
  if (rows.packages.some((row) => row.nonAuthority !== true)) errors.push({ code: "package-row-authority-boundary" });
  const status = rows.receipts.every((row) => ["pass", "out-of-scope"].includes(row.status)) ? "pass" : "blocked";
  if (manifest.status !== status) errors.push({ code: "manifest-status-drift", expected: status, actual: manifest.status });
  if (strict && status !== "pass") errors.push({ code: "blocking-package-output", blocked: rows.receipts.filter((row) => row.status === "blocked").map((row) => row.packageId) });
  return { ok: errors.length === 0, status, strict, counts: Object.fromEntries(Object.entries(rows).map(([name, values]) => [name, values.length])), errors };
}
function writeSourceFixture(root, blocked = false) {
  const releaseDigest = objectDigest({ release: "fixture" });
  const decisionDigest = objectDigest({ decision: "fixture" });
  const command = ["nix", "build", ".#checks.x86_64-linux.alpha-check"];
  const packageSource = { objects: [{ path: "packages/alpha", type: "tree", object_id: `git-tree-sha1:${"a".repeat(40)}` }], digest: null };
  packageSource.digest = objectDigest(packageSource.objects);
  const semantic = { release_digest: releaseDigest, accepted_decision_digest: decisionDigest, obligation_digest: objectDigest({ obligation: "alpha" }), repo_commit: "fixture", repo_tree: "git-tree-sha1:fixture", package_tree: `git-tree-sha1:${"a".repeat(40)}`, package_source_digest: packageSource.digest, toolchain: { nix: "fixture" }, package_id: "alpha", test_id: "alpha-check", check_ref: "checks.x86_64-linux.alpha-check", command, command_digest: objectDigest(command), exit_code: 0, outputs: [{ path_digest: "sha256-fixture", file_count: 1, bytes: 1 }], status: "pass" };
  const stdout = "fixture output\n", stderr = "";
  const evidenceBase = { kind: "ops.packageTestEvidence.v1", evidence_id: "evidence.alpha", response_claim_id: "ops-package-response.alpha", ...semantic, semantic_evidence_digest: objectDigest(semantic), stdout_digest: bytesDigest(Buffer.from(stdout)), stderr_digest: bytesDigest(Buffer.from(stderr)), log_refs: { stdout: "logs/alpha/alpha-check.stdout", stderr: "logs/alpha/alpha-check.stderr" }, authority: false };
  const evidence = blocked ? [] : [{ ...evidenceBase, evidence_digest: objectDigest(evidenceBase) }];
  if (!blocked) {
    fs.mkdirSync(path.join(root, "logs", "alpha"), { recursive: true });
    fs.writeFileSync(path.join(root, "logs", "alpha", "alpha-check.stdout"), stdout);
    fs.writeFileSync(path.join(root, "logs", "alpha", "alpha-check.stderr"), stderr);
  }
  const residuals = blocked ? [{ kind: "ops.packageResidual.v1", residual_id: "residual.alpha.test-failing", response_claim_id: "ops-package-response.alpha", package_id: "alpha", obligation_id: "obligation.alpha", status: "returned", code: "test-failing", returned_to: "governance-final-scope-purpose-join", reason: "fixture failure", authority: false }] : [];
  const receiptBase = { kind: "ops.packageReceipt.v2", receipt_id: "receipt.alpha", response_claim_id: "ops-package-response.alpha", repo_locator: repoId, package_id: "alpha", status: blocked ? "blocked" : "pass", governance_release_digest: releaseDigest, accepted_decision_digest: decisionDigest, obligation_id: "obligation.alpha", obligation_digest: objectDigest({ obligation: "alpha" }), repo_commit: "fixture", repo_tree: "git-tree-sha1:fixture", package_tree: semantic.package_tree, package_source: packageSource, entrypoints: [], required_tests: blocked ? [] : [{ test_id: "alpha-check", evidence_ref: "evidence.alpha", evidence_digest: evidence[0].evidence_digest }], evidence_refs: blocked ? [] : ["evidence.alpha"], residual_refs: residuals.map((row) => row.residual_id), observed_at: "2026-01-01T00:00:00Z", emitted_by: "ops-package-responses", authority: false };
  const receipt = { ...receiptBase, receipt_digest: objectDigest(receiptBase) };
  const response = { kind: "ops.packageResponse.v2", claim_id: "ops-package-response.alpha", adrs_ref: "roccho-dev/adrs#fixture", obligation_id: "obligation.alpha", obligation_digest: receipt.obligation_digest, governance_release_digest: releaseDigest, accepted_decision_digest: decisionDigest, repo_locator: repoId, package_id: "alpha", package_path: "packages/alpha", owner_role: "ops", state: blocked ? "blocked" : "covered", test_refs: ["alpha-check"], evidence_refs: receipt.evidence_refs, receipt_ref: receipt.receipt_id, residuals: receipt.residual_refs, authority: false };
  const manifest = { kind: "ops.packageResponsePacket.v2", status: blocked ? "blocked" : "pass", repo_locator: repoId, repo_commit: "fixture", repo_tree: "git-tree-sha1:fixture", observed_at: "2026-01-01T00:00:00Z", governance_release_id: "fixture", governance_release_digest: releaseDigest, accepted_decision_digest: decisionDigest, authority: false };
  writeJson(path.join(root, "manifest.json"), manifest);
  writeJsonl(path.join(root, "ops-package-responses.jsonl"), [response]);
  writeJsonl(path.join(root, "ops-package-evidence.jsonl"), evidence);
  writeJsonl(path.join(root, "ops-package-receipts.jsonl"), [receipt]);
  writeJsonl(path.join(root, "ops-package-residuals.jsonl"), residuals);
  writeJsonl(path.join(root, "package-drifts.jsonl"), residuals.map((row) => ({ kind: "packageDrift.v1", package_id: row.package_id, authority: false })));
}
function selftest(repoRoot) {
  const root = repoRootOf(repoRoot);
  const cmd = packageResponsesCommand(root);
  const upstream = run(cmd[0], [...cmd.slice(1), "selftest", "--json"]);
  if (upstream.exitCode !== 0 || JSON.parse(upstream.stdout).ok !== true) throw Error("upstream-package-responses-selftest-failed");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ops-gov-package-output-selftest-"));
  try {
    const passSource = path.join(tmp, "pass-source"), passOut = path.join(tmp, "pass-out");
    writeSourceFixture(passSource, false);
    project(passSource, passOut);
    const pass = validate(passOut, { strict: true });
    if (!pass.ok) throw Error(`gov-output-pass-validation:${JSON.stringify(pass.errors)}`);
    const receiptsFile = path.join(passOut, "receipts.jsonl");
    const tamperedReceipts = readJsonl(receiptsFile);
    const tamperedEvidence = tamperedReceipts[0].evidence[0];
    tamperedEvidence.stdout_digest = bytesDigest(Buffer.from("coordinated downstream tamper\n"));
    const tamperedEvidenceBase = { ...tamperedEvidence };
    delete tamperedEvidenceBase.evidence_digest;
    tamperedEvidence.evidence_digest = objectDigest(tamperedEvidenceBase);
    writeJsonl(receiptsFile, tamperedReceipts);
    const coordinatedTamper = validate(passOut, { strict: true });
    if (coordinatedTamper.ok || !coordinatedTamper.errors.some((row) => row.code === "receipt-evidence-digest-binding")) throw Error("gov-output-coordinated-evidence-tamper-not-rejected");
    project(passSource, passOut);
    const blockedSource = path.join(tmp, "blocked-source"), blockedOut = path.join(tmp, "blocked-out");
    writeSourceFixture(blockedSource, true);
    project(blockedSource, blockedOut);
    const structural = validate(blockedOut);
    const strict = validate(blockedOut, { strict: true });
    if (!structural.ok || strict.ok || !strict.errors.some((row) => row.code === "blocking-package-output")) throw Error("gov-output-blocked-gate");
    fs.rmSync(path.join(passOut, "receipts.jsonl"));
    if (validate(passOut).ok) throw Error("gov-output-missing-receipt-not-rejected");
    return { ok: true, kind: "ops.govPackageOutputSelftest.v2", exact_release_projection: "pass", blocked_packet: "blocked", missing_receipts: "rejected", coordinated_evidence_tamper: "rejected", organization_active_minted: false };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

try {
  const args = parseArgv(process.argv.slice(2));
  let result;
  if (args.command === "execute" || args.command === "emit") result = execute(args);
  else if (args.command === "validate") result = validate(args.outDir, { strict: args.strict });
  else if (args.command === "selftest") result = selftest(args.repoRoot);
  else throw Error(`unknown-command:${args.command}`);
  if (args.json || args.command !== "execute") process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  else process.stdout.write(`ops gov package output: ${result.status}\n`);
  process.exit(result.ok === false ? 1 : 0);
} catch (error) {
  process.stderr.write(`${error.message}\n${usage()}\n`);
  process.exit(2);
}
