import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const REPO_ID = "roccho-dev/ops";
export const PACKET_FILES = [
  "ops-package-responses.jsonl",
  "ops-package-evidence.jsonl",
  "ops-package-receipts.jsonl",
  "ops-package-residuals.jsonl",
  "package-inventory.jsonl",
  "package-responses.jsonl",
  "package-residuals.jsonl",
  "package-drifts.jsonl",
  "manifest.json",
];

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
  return value;
}
export function canonicalBytes(value) { return Buffer.from(JSON.stringify(sortValue(value)), "utf8"); }
export function objectDigest(value) { return `sha256:${crypto.createHash("sha256").update(canonicalBytes(value)).digest("hex")}`; }
export function bytesDigest(value) { return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`; }
export function isDigest(value) { return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value); }
export function readJson(file) {
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error(`json-object-required:${file}`);
  return value;
}
export function readJsonl(file) {
  const text = fs.readFileSync(file, "utf8");
  if (text && !text.endsWith("\n")) throw Error(`jsonl-final-newline-required:${file}`);
  return text.split("\n").filter(Boolean).map((line, index) => {
    let value;
    try { value = JSON.parse(line); } catch (error) { throw Error(`${file}:${index + 1}:${error.message}`); }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error(`${file}:${index + 1}:json-object-required`);
    return value;
  });
}
export function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}
function pick(row, ...keys) { for (const key of keys) if (row[key] !== undefined && row[key] !== null) return row[key]; return undefined; }
function list(value) { if (value === undefined || value === null || value === "") return []; return Array.isArray(value) ? value : [value]; }
function has(row, ...keys) { return keys.some((key) => Object.hasOwn(row, key)); }
export function normalizeTestId(value, system) {
  const raw = String(value ?? "").trim();
  if (!raw) throw Error("required-test-empty");
  if (/^[-A-Za-z0-9._]+$/.test(raw)) return raw;
  const escaped = system.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = raw.match(new RegExp(`^checks\\.${escaped}\\.([-A-Za-z0-9._]+)$`));
  if (match) return match[1];
  throw Error(`required-test-invalid:${raw}`);
}
export function normalizeObligation(row, system) {
  const kind = pick(row, "kind");
  if (!["packageObligation.v1", "governance.packageObligation.v1", "adrs.packageObligation.v1"].includes(kind)) throw Error(`package-obligation-kind:${kind ?? "missing"}`);
  const packageId = String(pick(row, "packageId", "package_id") ?? "").trim();
  const packagePath = String(pick(row, "packagePath", "package_path") ?? "").trim();
  const obligationId = String(pick(row, "obligationId", "obligation_id") ?? "").trim();
  const repoLocator = String(pick(row, "repoLocator", "repo_locator", "repo") ?? "").trim();
  const adrsRef = String(pick(row, "adrsRef", "adrs_ref") ?? "").trim();
  const ownerRole = String(pick(row, "ownerRole", "owner_role") ?? "").trim();
  const authoritySurface = String(pick(row, "authoritySurface", "authority_surface") ?? "").trim();
  const targetUniverseId = String(pick(row, "targetUniverseId", "target_universe_id", "targetUniverse") ?? "").trim();
  if (!packageId) throw Error("package-id-missing");
  if (!/^[A-Za-z0-9._-]+$/.test(packageId)) throw Error(`package-id-invalid:${packageId}`);
  if (!packagePath || path.posix.isAbsolute(packagePath) || packagePath.split("/").includes("..")) throw Error(`package-path-invalid:${packageId}`);
  if (!obligationId) throw Error(`obligation-id-missing:${packageId}`);
  if (!repoLocator) throw Error(`repo-locator-missing:${packageId}`);
  if (!adrsRef) throw Error(`adrs-ref-missing:${packageId}`);
  if (!ownerRole) throw Error(`owner-role-missing:${packageId}`);
  if (!authoritySurface) throw Error(`authority-surface-missing:${packageId}`);
  if (!targetUniverseId) throw Error(`target-universe-missing:${packageId}`);
  for (const [name, keys] of [
    ["goals", ["goals"]],
    ["non-goals", ["nonGoals", "non_goals"]],
    ["requirements", ["requirements"]],
    ["required-tests", ["requiredTests", "required_tests", "requiredTest", "required_test"]],
  ]) {
    if (!has(row, ...keys) || !Array.isArray(pick(row, ...keys))) throw Error(`${name}-array-required:${packageId}`);
  }
  for (const [name, keys] of [
    ["claim-required", ["claimRequired", "claim_required"]],
    ["receipt-required", ["receiptRequired", "receipt_required"]],
    ["residual-required", ["residualRequired", "residual_required"]],
    ["freshness-policy", ["freshnessPolicy", "freshness_policy"]],
    ["route-policy", ["routePolicy", "route_policy"]],
  ]) if (!has(row, ...keys)) throw Error(`${name}-missing:${packageId}`);
  const requiredTests = list(pick(row, "requiredTests", "required_tests", "requiredTest", "required_test")).map((value) => normalizeTestId(value, system));
  if (new Set(requiredTests).size !== requiredTests.length) throw Error(`required-test-duplicate:${packageId}`);
  const normalized = {
    kind: "packageObligation.v1",
    obligation_id: obligationId,
    adrs_ref: adrsRef,
    target_universe_id: targetUniverseId,
    repo_locator: repoLocator,
    authority_surface: authoritySurface,
    package_id: packageId,
    package_path: packagePath,
    owner_role: ownerRole,
    goals: list(pick(row, "goals")),
    non_goals: list(pick(row, "nonGoals", "non_goals")),
    requirements: list(pick(row, "requirements")),
    required_tests: requiredTests,
    claim_required: pick(row, "claimRequired", "claim_required") !== false,
    receipt_required: pick(row, "receiptRequired", "receipt_required") !== false,
    residual_required: pick(row, "residualRequired", "residual_required") !== false,
    freshness_policy: pick(row, "freshnessPolicy", "freshness_policy") ?? null,
    route_policy: pick(row, "routePolicy", "route_policy") ?? null,
    authority: false,
  };
  normalized.obligation_digest = objectDigest(normalized);
  return normalized;
}
export function validateReleaseObjects({ manifest, acceptedDecision, engineDescriptor, descriptor, readbackReceipt, observedNarHash }) {
  const manifestFields = ["kind", "releaseId", "sequence", "previousReleaseDigest", "supersedesReleaseDigest", "acceptedDecisionDigest", "govEngineDigest", "nixOutputDigest", "status"].sort();
  if (JSON.stringify(Object.keys(manifest).sort()) !== JSON.stringify(manifestFields)) throw Error("gov-release-manifest-fields");
  if (manifest.kind !== "govReleaseManifest.v1" || manifest.status !== "adopted") throw Error("gov-release-manifest-state");
  for (const field of ["acceptedDecisionDigest", "govEngineDigest", "nixOutputDigest"]) if (!isDigest(manifest[field])) throw Error(`gov-release-${field}-digest`);
  if (objectDigest(acceptedDecision) !== manifest.acceptedDecisionDigest) throw Error("accepted-decision-digest-mismatch");
  if (engineDescriptor.kind !== "govEngineDescriptor.v1" || engineDescriptor.repository !== "roccho-dev/governance" || !/^[0-9a-f]{40}$/.test(engineDescriptor.commitSha)) throw Error("gov-engine-descriptor");
  if (objectDigest(engineDescriptor) !== manifest.govEngineDigest) throw Error("gov-engine-descriptor-digest-mismatch");
  if (descriptor.kind !== "govNixOutputDescriptor.v1" || descriptor.package !== "gov-package-output") throw Error("gov-nix-output-descriptor");
  if (typeof descriptor.narHash !== "string" || !descriptor.narHash.startsWith("sha256-")) throw Error("gov-nix-output-nar-hash");
  if (objectDigest(descriptor) !== manifest.nixOutputDigest) throw Error("gov-nix-output-descriptor-digest-mismatch");
  if (observedNarHash !== descriptor.narHash) throw Error("gov-package-output-nar-hash-mismatch");
  const releaseDigest = objectDigest(manifest);
  if (readbackReceipt.kind !== "govReleaseReadbackReceipt.v1" || readbackReceipt.status !== "pass" || readbackReceipt.adopted !== true || readbackReceipt.authority !== false) throw Error("gov-release-readback-state");
  if (readbackReceipt.releaseId !== manifest.releaseId || readbackReceipt.releaseDigest !== releaseDigest || readbackReceipt.observedManifestDigest !== releaseDigest) throw Error("gov-release-readback-digest-mismatch");
  return { release_id: manifest.releaseId, release_digest: releaseDigest, accepted_decision_digest: manifest.acceptedDecisionDigest, governance_engine_digest: manifest.govEngineDigest, governance_engine_commit: engineDescriptor.commitSha, governance_output_descriptor_digest: manifest.nixOutputDigest, governance_output_nar_hash: descriptor.narHash };
}
export function requirementIds(rows) { return list(rows).map((value) => typeof value === "string" ? value : value && typeof value === "object" ? String(pick(value, "requirementId", "requirement_id", "id", "key") ?? objectDigest(value)) : String(value)); }
export function nonGoalIds(rows) { return list(rows).map((value) => typeof value === "string" ? value : value && typeof value === "object" ? String(pick(value, "nonGoalId", "non_goal_id", "id", "key") ?? objectDigest(value)) : String(value)); }
export function packetStatus(receipts) { return receipts.every((row) => ["pass", "out-of-scope"].includes(row.status)) ? "pass" : "blocked"; }
export function validatePacket(outDir, { strict = false } = {}) {
  const errors = [];
  for (const file of PACKET_FILES) if (!fs.existsSync(path.join(outDir, file))) errors.push({ code: "missing-file", file });
  if (errors.length) return { ok: false, status: "invalid", strict, errors };
  const manifest = readJson(path.join(outDir, "manifest.json"));
  const rows = {
    responses: readJsonl(path.join(outDir, "ops-package-responses.jsonl")),
    evidence: readJsonl(path.join(outDir, "ops-package-evidence.jsonl")),
    receipts: readJsonl(path.join(outDir, "ops-package-receipts.jsonl")),
    residuals: readJsonl(path.join(outDir, "ops-package-residuals.jsonl")),
    inventory: readJsonl(path.join(outDir, "package-inventory.jsonl")),
    canonical_responses: readJsonl(path.join(outDir, "package-responses.jsonl")),
    canonical_residuals: readJsonl(path.join(outDir, "package-residuals.jsonl")),
    drifts: readJsonl(path.join(outDir, "package-drifts.jsonl")),
  };
  if (manifest.kind !== "ops.packageResponsePacket.v2" || manifest.authority !== false || manifest.repo_locator !== REPO_ID) errors.push({ code: "manifest-boundary" });
  if (!isDigest(manifest.governance_release_digest) || !isDigest(manifest.accepted_decision_digest) || !isDigest(manifest.governance_engine_digest) || !isDigest(manifest.governance_output_descriptor_digest)) errors.push({ code: "manifest-release-binding" });
  if (typeof manifest.governance_output_nar_hash !== "string" || !manifest.governance_output_nar_hash.startsWith("sha256-")) errors.push({ code: "manifest-governance-output-nar-hash" });
  if (!manifest.toolchain || typeof manifest.toolchain.nix !== "string" || typeof manifest.toolchain.git !== "string" || typeof manifest.toolchain.system !== "string") errors.push({ code: "manifest-toolchain" });
  for (const [name, values] of Object.entries(rows)) if (manifest.row_counts?.[name] !== values.length) errors.push({ code: "manifest-row-count-drift", field: name });

  function uniqueMap(values, field, code) {
    const out = new Map();
    for (const row of values) {
      const key = row[field];
      if (!key) errors.push({ code: `${code}-missing-id`, field });
      else if (out.has(key)) errors.push({ code: `duplicate-${code}`, id: key });
      else out.set(key, row);
    }
    return out;
  }
  const inventoryPackageIds = new Set(rows.inventory.filter((row) => row.item_kind === "package").map((row) => row.package_id));
  uniqueMap(rows.inventory, "inventory_id", "inventory");
  uniqueMap(rows.inventory.filter((row) => row.item_kind === "package"), "package_id", "inventory-package");
  const responseByPackage = uniqueMap(rows.responses, "package_id", "package-response");
  const receiptById = uniqueMap(rows.receipts, "receipt_id", "receipt");
  const receiptByPackage = uniqueMap(rows.receipts, "package_id", "package-receipt");
  const evidenceById = uniqueMap(rows.evidence, "evidence_id", "evidence");
  const residualById = uniqueMap(rows.residuals, "residual_id", "residual");
  const canonicalResponseByPackage = uniqueMap(rows.canonical_responses, "package_id", "canonical-response");
  const canonicalResidualById = uniqueMap(rows.canonical_residuals, "residual_id", "canonical-residual");
  uniqueMap(rows.drifts, "drift_id", "drift");

  for (const row of rows.responses) {
    if (row.kind !== "ops.packageResponse.v2" || row.authority !== false) errors.push({ code: "response-boundary", package_id: row.package_id });
    if (row.governance_release_digest !== manifest.governance_release_digest || row.accepted_decision_digest !== manifest.accepted_decision_digest) errors.push({ code: "response-release-binding", package_id: row.package_id });
    if (!["covered", "blocked", "out-of-scope"].includes(row.state)) errors.push({ code: "response-state", package_id: row.package_id, state: row.state });
    const receipt = receiptById.get(row.receipt_ref);
    if (!receipt || receipt.package_id !== row.package_id || receipt.response_claim_id !== row.claim_id) errors.push({ code: "response-receipt-binding", package_id: row.package_id });
    for (const ref of row.evidence_refs ?? []) if (!evidenceById.has(ref)) errors.push({ code: "missing-evidence", package_id: row.package_id, ref });
    for (const ref of row.residuals ?? []) if (!residualById.has(ref)) errors.push({ code: "missing-residual", package_id: row.package_id, ref });
    if (row.state === "covered" && (row.residuals?.length || receipt?.status !== "pass")) errors.push({ code: "covered-response-not-pass", package_id: row.package_id });
    if (row.state === "blocked" && (!(row.residuals?.length) || receipt?.status !== "blocked")) errors.push({ code: "blocked-response-incomplete", package_id: row.package_id });
    if (row.state === "out-of-scope" && (row.residuals?.length || receipt?.status !== "out-of-scope")) errors.push({ code: "out-of-scope-response-incomplete", package_id: row.package_id });
    if (receipt) {
      const same = (left, right) => JSON.stringify([...(left ?? [])].sort()) === JSON.stringify([...(right ?? [])].sort());
      if (row.obligation_id !== receipt.obligation_id || row.obligation_digest !== receipt.obligation_digest) errors.push({ code: "response-obligation-binding", package_id: row.package_id });
      if (!same(row.evidence_refs, receipt.evidence_refs) || !same(row.residuals, receipt.residual_refs)) errors.push({ code: "response-receipt-reference-drift", package_id: row.package_id });
      if (receipt.obligation) {
        if (row.adrs_ref !== receipt.obligation.adrs_ref || row.package_path !== receipt.obligation.package_path || row.owner_role !== receipt.obligation.owner_role || !same(row.test_refs, receipt.obligation.required_tests)) errors.push({ code: "response-obligation-field-drift", package_id: row.package_id });
        if (row.state === "covered" && (!same(row.covered_requirements, requirementIds(receipt.obligation.requirements)) || !same(row.protected_non_goals, nonGoalIds(receipt.obligation.non_goals)))) errors.push({ code: "response-coverage-overclaim", package_id: row.package_id });
      }
    }
    const canonical = canonicalResponseByPackage.get(row.package_id);
    if (!canonical || canonical.claim_id !== row.claim_id || canonical.receipt_ref !== row.receipt_ref || canonical.state !== row.state || canonical.governanceReleaseDigest !== row.governance_release_digest) errors.push({ code: "canonical-response-drift", package_id: row.package_id });
  }
  for (const packageId of inventoryPackageIds) if (!responseByPackage.has(packageId)) errors.push({ code: "inventory-package-without-response", package_id: packageId });
  for (const packageId of responseByPackage.keys()) if (!receiptByPackage.has(packageId)) errors.push({ code: "response-without-package-receipt", package_id: packageId });
  for (const packageId of receiptByPackage.keys()) if (!responseByPackage.has(packageId)) errors.push({ code: "receipt-without-response", package_id: packageId });

  for (const row of rows.receipts) {
    if (row.kind !== "ops.packageReceipt.v2" || row.authority !== false || !isDigest(row.receipt_digest)) errors.push({ code: "receipt-boundary", package_id: row.package_id });
    if (row.governance_release_digest !== manifest.governance_release_digest || row.accepted_decision_digest !== manifest.accepted_decision_digest) errors.push({ code: "receipt-release-binding", package_id: row.package_id });
    const base = { ...row }; delete base.receipt_digest;
    if (objectDigest(base) !== row.receipt_digest) errors.push({ code: "receipt-digest-mismatch", package_id: row.package_id });
    if (row.obligation) {
      const obligation = { ...row.obligation };
      const digest = obligation.obligation_digest;
      delete obligation.obligation_digest;
      if (!isDigest(digest) || objectDigest(obligation) !== digest || digest !== row.obligation_digest || row.obligation_id !== row.obligation.obligation_id || row.package_id !== row.obligation.package_id) errors.push({ code: "receipt-obligation-binding", package_id: row.package_id });
    } else if (row.status !== "blocked") errors.push({ code: "nonblocked-receipt-without-obligation", package_id: row.package_id });
    if (!Array.isArray(row.entrypoints)) errors.push({ code: "receipt-entrypoints-shape", package_id: row.package_id });
    const sourceObjects = row.package_source?.objects;
    if (!Array.isArray(sourceObjects) || !isDigest(row.package_source?.digest) || objectDigest(sourceObjects ?? []) !== row.package_source?.digest) errors.push({ code: "receipt-package-source", package_id: row.package_id });
    if (row.status === "pass" && (!sourceObjects?.length || sourceObjects.some((entry) => !entry.path || !["blob", "tree"].includes(entry.type) || !new RegExp(`^git-${entry.type}-sha1:[0-9a-f]{40}$`).test(entry.object_id)))) errors.push({ code: "pass-receipt-package-source-incomplete", package_id: row.package_id });
    if (row.status === "pass" && (!row.entrypoints?.length || row.entrypoints.some((entry) => entry.exists !== true || !isDigest(entry.digest)))) errors.push({ code: "pass-receipt-entrypoint-incomplete", package_id: row.package_id });
    const required = row.required_tests ?? [];
    const requiredIds = new Set();
    for (const test of required) {
      if (requiredIds.has(test.test_id)) errors.push({ code: "duplicate-required-test", package_id: row.package_id, test_id: test.test_id });
      requiredIds.add(test.test_id);
      const evidence = evidenceById.get(test.evidence_ref);
      if (!evidence || evidence.package_id !== row.package_id || evidence.test_id !== test.test_id || evidence.evidence_digest !== test.evidence_digest || evidence.package_source_digest !== row.package_source?.digest) errors.push({ code: "required-test-evidence-binding", package_id: row.package_id, test_id: test.test_id });
    }
    const evidenceRefs = [...new Set(row.evidence_refs ?? [])].sort();
    const requiredRefs = required.map((test) => test.evidence_ref).sort();
    if (JSON.stringify(evidenceRefs) !== JSON.stringify(requiredRefs)) errors.push({ code: "receipt-evidence-set-drift", package_id: row.package_id });
    for (const ref of row.residual_refs ?? []) if (!residualById.has(ref)) errors.push({ code: "receipt-residual-missing", package_id: row.package_id, ref });
    if (row.status === "pass" && ((row.residual_refs?.length ?? 0) > 0 || required.length === 0)) errors.push({ code: "pass-receipt-incomplete", package_id: row.package_id });
    if (row.status === "blocked" && !(row.residual_refs?.length)) errors.push({ code: "blocked-receipt-without-residual", package_id: row.package_id });
    if (row.status === "out-of-scope" && (row.obligation?.claim_required !== false || required.length || row.residual_refs?.length)) errors.push({ code: "out-of-scope-receipt-invalid", package_id: row.package_id });
  }

  for (const row of rows.evidence) {
    if (row.kind !== "ops.packageTestEvidence.v1" || row.authority !== false) errors.push({ code: "evidence-boundary", evidence_id: row.evidence_id });
    if (row.release_digest !== manifest.governance_release_digest || row.accepted_decision_digest !== manifest.accepted_decision_digest) errors.push({ code: "evidence-release-binding", evidence_id: row.evidence_id });
    const semantic = {
      release_digest: row.release_digest,
      accepted_decision_digest: row.accepted_decision_digest,
      obligation_digest: row.obligation_digest,
      repo_commit: row.repo_commit,
      repo_tree: row.repo_tree,
      package_tree: row.package_tree,
      package_source_digest: row.package_source_digest,
      toolchain: row.toolchain,
      package_id: row.package_id,
      test_id: row.test_id,
      check_ref: row.check_ref,
      command: row.command,
      command_digest: row.command_digest,
      exit_code: row.exit_code,
      outputs: row.outputs,
      status: row.status,
    };
    if (!isDigest(row.semantic_evidence_digest) || objectDigest(semantic) !== row.semantic_evidence_digest) errors.push({ code: "semantic-evidence-digest-mismatch", evidence_id: row.evidence_id });
    const evidenceBase = { ...row };
    delete evidenceBase.evidence_digest;
    if (!isDigest(row.evidence_digest) || objectDigest(evidenceBase) !== row.evidence_digest) errors.push({ code: "evidence-digest-mismatch", evidence_id: row.evidence_id });
    if (!Array.isArray(row.command) || !row.command.length || objectDigest(row.command) !== row.command_digest || !isDigest(row.stdout_digest) || !isDigest(row.stderr_digest) || !isDigest(row.command_digest)) errors.push({ code: "evidence-process-digest", evidence_id: row.evidence_id });
    for (const [stream, expected] of [["stdout", row.stdout_digest], ["stderr", row.stderr_digest]]) {
      const ref = row.log_refs?.[stream];
      if (!ref || path.isAbsolute(ref) || ref.split(path.sep).includes("..")) { errors.push({ code: "evidence-log-ref", evidence_id: row.evidence_id, stream }); continue; }
      const file = path.resolve(outDir, ref);
      const root = path.resolve(outDir) + path.sep;
      if (!file.startsWith(root) || !fs.existsSync(file) || !fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) { errors.push({ code: "evidence-log-missing", evidence_id: row.evidence_id, stream }); continue; }
      if (bytesDigest(fs.readFileSync(file)) !== expected) errors.push({ code: "evidence-log-digest-mismatch", evidence_id: row.evidence_id, stream });
    }
    if (row.status === "pass") {
      if (row.exit_code !== 0 || !Array.isArray(row.outputs) || row.outputs.length === 0) errors.push({ code: "pass-evidence-without-output", evidence_id: row.evidence_id });
      for (const output of row.outputs ?? []) if (typeof output.path_digest !== "string" || !output.path_digest.startsWith("sha256-") || !Number.isInteger(output.file_count) || output.file_count < 0 || !Number.isInteger(output.bytes) || output.bytes < 0) errors.push({ code: "evidence-output-shape", evidence_id: row.evidence_id });
    }
  }
  const evidenceReferenceCounts = new Map();
  const residualReferenceCounts = new Map();
  for (const receipt of rows.receipts) {
    for (const ref of receipt.evidence_refs ?? []) evidenceReferenceCounts.set(ref, (evidenceReferenceCounts.get(ref) ?? 0) + 1);
    for (const ref of receipt.residual_refs ?? []) residualReferenceCounts.set(ref, (residualReferenceCounts.get(ref) ?? 0) + 1);
  }
  for (const row of rows.evidence) if (evidenceReferenceCounts.get(row.evidence_id) !== 1) errors.push({ code: "orphan-or-shared-evidence", evidence_id: row.evidence_id, references: evidenceReferenceCounts.get(row.evidence_id) ?? 0 });
  for (const row of rows.residuals) if (residualReferenceCounts.get(row.residual_id) !== 1) errors.push({ code: "orphan-or-shared-residual", residual_id: row.residual_id, references: residualReferenceCounts.get(row.residual_id) ?? 0 });

  for (const row of rows.residuals) {
    if (row.kind !== "ops.packageResidual.v1" || row.authority !== false || row.status !== "returned" || !row.code || !responseByPackage.has(row.package_id)) errors.push({ code: "residual-boundary", residual_id: row.residual_id });
    const canonical = canonicalResidualById.get(row.residual_id);
    if (!canonical || canonical.package_id !== row.package_id || canonical.code !== row.code || canonical.status !== row.status) errors.push({ code: "canonical-residual-drift", residual_id: row.residual_id });
    if (!rows.drifts.some((drift) => drift.package_id === row.package_id && drift.drift_type === row.code && drift.authority === false)) errors.push({ code: "residual-without-drift", residual_id: row.residual_id });
  }
  for (const row of rows.drifts) if (!rows.residuals.some((residual) => residual.package_id === row.package_id && residual.code === row.drift_type)) errors.push({ code: "drift-without-residual", drift_id: row.drift_id });
  for (const row of [...rows.inventory, ...rows.canonical_responses, ...rows.canonical_residuals, ...rows.drifts]) if (row.authority !== false) errors.push({ code: "authority-boundary", kind: row.kind, package_id: row.package_id });

  const status = packetStatus(rows.receipts);
  if (manifest.status !== status) errors.push({ code: "manifest-status-drift", expected: status, actual: manifest.status });
  if (strict && status !== "pass") errors.push({ code: "blocking-package-receipt", blocked: rows.receipts.filter((row) => row.status === "blocked").map((row) => row.package_id) });
  return { ok: errors.length === 0, status, strict, counts: Object.fromEntries(Object.entries(rows).map(([name, values]) => [name, values.length])), errors };
}
