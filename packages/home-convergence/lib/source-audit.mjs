import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { digest } from "./home-convergence.mjs";

const SOURCE_FILES = [
  { path: "bin/home-convergence.mjs", scan: true },
  { path: "lib/home-convergence.mjs", scan: true },
  { path: "lib/signed-convergence.mjs", scan: true },
  { path: "lib/source-audit.mjs", scan: false },
];

const sha256 = (bytes) =>
  `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;

const countMatches = (text, patterns) =>
  patterns.reduce((count, pattern) => count + [...text.matchAll(pattern)].length, 0);

export const auditRuntimeSource = ({ root, exactOpsRevision }) => {
  if (!/^[0-9a-f]{40}$/.test(exactOpsRevision)) {
    throw new Error("exactOpsRevision must be a 40-character lowercase git revision");
  }

  const sourceFiles = SOURCE_FILES.map((source) => {
    const absolutePath = path.join(root, source.path);
    const bytes = fs.readFileSync(absolutePath);
    return {
      ...source,
      sha256: sha256(bytes),
      text: bytes.toString("utf8"),
    };
  });
  const runtimeText = sourceFiles
    .filter((file) => file.scan)
    .map((file) => file.text)
    .join("\n");

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
  const files = sourceFiles.map(({ path: filePath, scan, sha256: fileDigest }) => ({
    path: filePath,
    scan,
    sha256: fileDigest,
  }));
  const evidence = {
    kind: "ops.homeConvergenceSourceAuditEvidence.v1",
    exact_ops_revision: exactOpsRevision,
    source_files: files,
    source_files_digest: digest(files),
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
