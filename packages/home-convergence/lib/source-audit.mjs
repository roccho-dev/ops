import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { digest } from "./home-convergence.mjs";

const RUNTIME_FILES = [
  "bin/home-convergence.mjs",
  "lib/home-convergence.mjs",
];

const sha256 = (bytes) =>
  `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;

const countMatches = (text, patterns) =>
  patterns.reduce((count, pattern) => count + [...text.matchAll(pattern)].length, 0);

export const auditRuntimeSource = ({ root, exactOpsRevision }) => {
  if (!/^[0-9a-f]{40}$/.test(exactOpsRevision)) {
    throw new Error("exactOpsRevision must be a 40-character lowercase git revision");
  }

  const runtimeFiles = RUNTIME_FILES.map((relativePath) => {
    const absolutePath = path.join(root, relativePath);
    const bytes = fs.readFileSync(absolutePath);
    return {
      path: relativePath,
      sha256: sha256(bytes),
      text: bytes.toString("utf8"),
    };
  });
  const runtimeText = runtimeFiles.map((file) => file.text).join("\n");

  const desiredStateRedefinitions = countMatches(runtimeText, [
    /\bdesired_state_id\s*:/g,
    /\bdesired_state_digest\s*:/g,
    /\bprojection_identity\s*:/g,
    /\bchanges\s*:\s*\[/g,
  ]);
  const productPackageDuplicates = countMatches(runtimeText, [
    /node:(?:https|http|net|tls|dgram)/g,
    /\bfetch\s*\(/g,
    /\bdownload\s*\(/g,
    /\bbuildGoModule\b/g,
    /\bfetchurl\b/g,
    /\bpackage_recipe\s*:/g,
  ]);
  const rawSecretSchemaFields = countMatches(runtimeText, [
    /\bcredential_value\b/g,
    /\bsecret_value\b/g,
    /\bprivate_target_identity\b/g,
    /\bhost_name\b/g,
    /\bip_address\b/g,
    /\bprivate_domain\b/g,
    /\bsecret_path\b/g,
  ]);
  const unclassifiedEffects = countMatches(runtimeText, [
    /node:child_process/g,
    /\b(?:spawn|execFile|fork)\s*\(/g,
    /\bfs\.(?:writeFile|appendFile|rm|unlink|rename|mkdir|copyFile)Sync?\s*\(/g,
    /\bprocess\.kill\s*\(/g,
  ]);

  const counters = {
    desired_state_redefined_in_ops: desiredStateRedefinitions,
    product_package_duplicates: productPackageDuplicates,
    raw_secret_schema_fields: rawSecretSchemaFields,
    unclassified_effects: unclassifiedEffects,
  };
  const files = runtimeFiles.map(({ path: filePath, sha256: fileDigest }) => ({
    path: filePath,
    sha256: fileDigest,
  }));
  const evidence = {
    kind: "ops.homeConvergenceSourceAuditEvidence.v1",
    exact_ops_revision: exactOpsRevision,
    runtime_files: files,
    runtime_files_digest: digest(files),
    counters,
  };
  const status = Object.values(counters).every((value) => value === 0) ? "pass" : "fail";
  return {
    summary: {
      status,
      evidence_digest: digest(evidence),
      ...counters,
    },
    evidence,
  };
};
