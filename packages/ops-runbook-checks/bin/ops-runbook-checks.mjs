#!/usr/bin/env node
// Static ops runbook checks that cannot claim live success.
//
// This guardrail intentionally proves only a minimum static gate. It does not
// contact ChatGPT, GitHub, Tailscale, or a browser. A pass means the router,
// schemas, package entrypoints, and "not-proven" boundaries are discoverable.
//
// Node ESM port of ops-runbook-checks.py (stdlib only, behavior-identical).

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

process.on("unhandledRejection", (e) => {
  console.error(e);
  process.exit(1);
});

const REQUIRED_STATIC_PATHS = [
  "AGENTS.md",
  ".agents/actor-relations.md",
  ".agents/role-catalog.md",
  ".agents/canonical-event-log.md",
  ".agents/authority-write-gate.md",
  ".agents/protocol-fsm.md",
  ".agents/command-board.md",
  ".agents/claim-stream.md",
  ".agents/evidence-integrity.md",
  ".agents/transport.md",
  ".agents/project-workspace.md",
  ".agents/specs-package-work.md",
  ".agents/package-entrypoints.md",
  ".agents/runtime-discovery.md",
  ".agents/schemas/command-board-record.v1.schema.json",
  ".agents/schemas/claim-record.v1.schema.json",
  ".agents/schemas/evidence-record.v1.schema.json",
  ".agents/schemas/transport-only-record.v1.schema.json",
  "specs/packages/ops-cdp-core/default.nix",
  "specs/packages/ops-thread-fsm/default.nix",
  "specs/packages/ops-tailnet-github-egress/default.nix",
  "specs/packages/ops-refs-vault/default.nix",
  "specs/packages/ops-runbook-checks/default.nix",
  "ops/flake.nix",
  "ops/packages/ops-cdp-core/default.nix",
  "ops/packages/ops-thread-fsm/default.nix",
  "ops/packages/ops-tailnet-github-egress",
  "ops/packages/ops-refs-vault",
  "ops/packages/ops-runbook-checks/default.nix",
];

const OPTIONAL_LEGACY_PATHS = [
  "cdp-ops-poc",
  "ops/packages/ops-artifact-materialize",
  "ops/packages/ops-knowledge-intake",
];

const FORBIDDEN_AGENTS_MD_TOKENS = [
  "0/9",
  "$HOME/.agents/status.md",
  "merge executor",
  "role-override",
  "post-hoc-merge-review-required",
  "delivery-verified",
  "app-connector-push-test-20260507T191701Z",
  "app-connector-mtu-probing-push-20260507T221847Z",
  "single-remote-restore-proof-20260508T010136Z",
  "specs-local-layout-restore-proof-20260508T010136Z",
  "refs-vault-real-repo-shelter-20260508T042439Z",
  "refs-vault-ux-restore-proof-20260508T041421Z",
  "specs-merge",
  "ops-merge",
];

const REQUIRED_FILE_TOKENS = [
  {
    relPath: "AGENTS.md",
    tokens: [
      "rootActor",
      "parentActor",
      "childActor",
      "delegatedParentActor",
      "transportOnlyActor",
      "complete-approved",
      "repos/specs",
      "package contract",
    ],
  },
  {
    relPath: ".agents/transport.md",
    tokens: [
      "Project Source",
      "thread-file-upload",
      "cdp-readback",
      "transport-sent",
      "transport-read",
      "semantic approval",
      "artifact-observed",
    ],
  },
  {
    relPath: ".agents/project-workspace.md",
    tokens: [
      "Project Source-only input rule",
      "worker-readable proof",
      "REQUEST.md",
      "role.chatgpt.thread",
      "threadFunction",
    ],
  },
  {
    relPath: ".agents/claim-stream.md",
    tokens: ["claim.completion.v1", "policyReadSnapshot", "claim はどれだけ詳細でも command"],
  },
  {
    relPath: ".agents/specs-package-work.md",
    tokens: [
      "spec.output.package = feat.input.package",
      "package/package.json",
      "implementation-ready",
      "specs-contract-completion",
    ],
  },
  {
    relPath: ".agents/package-entrypoints.md",
    tokens: ["ops-cdp-core", "ops-thread-fsm", "ops-tailnet-github-egress", "ops-refs-vault"],
  },
  {
    relPath: "ops/flake.nix",
    tokens: [
      "ops-runbook-checks",
      "ops-cdp-core",
      "ops-thread-fsm",
      "ops-tailnet-github-egress",
      "ops-refs-vault",
      "checks =",
    ],
  },
];

const LIVE_PROOF_STATUSES = [
  {
    capability: "chatgpt.projectSource.uploadReadback",
    status: "not-proven-by-static-check",
    requiredEvidence: [
      "upload result",
      "Project Sources list/readback with expected filename",
      "new thread proof-token readback",
      "proof token absent from prompt body",
    ],
  },
  {
    capability: "chatgpt.artifact.receipt",
    status: "not-proven-by-static-check",
    requiredEvidence: ["artifact file", "sha256", "materialization manifest", "readback or gate log"],
  },
  {
    capability: "review.impl.pass",
    status: "not-proven-by-static-check",
    requiredEvidence: [
      "review artifact",
      "target candidate hash",
      "explicit impl-review verdict",
      "review criteria satisfied",
    ],
  },
  {
    capability: "review.merge.pass",
    status: "not-proven-by-static-check",
    requiredEvidence: [
      "merge-review artifact",
      "base and candidate hashes",
      "explicit merge-review verdict",
      "merge-review criteria satisfied",
    ],
  },
  {
    capability: "tailnet.github.egressPush",
    status: "not-proven-by-static-check",
    requiredEvidence: [
      "route-gated push command",
      "selected github.com route evidence",
      "remote head readback",
    ],
  },
  {
    capability: "authority.completeApproved",
    status: "not-proven-by-static-check",
    requiredEvidence: [
      "completion claim",
      "parent approval record",
      "accepted event with complete-approved",
      "evidence matching approved criteria",
    ],
  },
];

// Python json.dumps(obj, indent=2) with default ensure_ascii=True.
function pyJsonIndent2(value) {
  return ser(value, 2, 0);
}

function jsonString(s) {
  let out = '"';
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\f") out += "\\f";
    else if (code < 0x20) out += "\\u" + code.toString(16).padStart(4, "0");
    else if (code < 0x7f) out += ch;
    else if (code > 0xffff) {
      const c = code - 0x10000;
      const hi = 0xd800 + (c >> 10);
      const lo = 0xdc00 + (c & 0x3ff);
      out += "\\u" + hi.toString(16).padStart(4, "0") + "\\u" + lo.toString(16).padStart(4, "0");
    } else {
      out += "\\u" + code.toString(16).padStart(4, "0");
    }
  }
  return out + '"';
}

function ser(value, indent, depth) {
  if (value === null || value === undefined) return "null";
  const t = typeof value;
  if (t === "string") return jsonString(value);
  if (t === "boolean") return value ? "true" : "false";
  if (t === "number") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const pad = " ".repeat(indent * (depth + 1));
    const closePad = " ".repeat(indent * depth);
    return "[\n" + value.map((v) => pad + ser(v, indent, depth + 1)).join(",\n") + "\n" + closePad + "]";
  }
  const keys = Object.keys(value);
  if (keys.length === 0) return "{}";
  const pad = " ".repeat(indent * (depth + 1));
  const closePad = " ".repeat(indent * depth);
  const items = keys.map((k) => pad + jsonString(k) + ": " + ser(value[k], indent, depth + 1));
  return "{\n" + items.join(",\n") + "\n" + closePad + "}";
}

function statKind(p) {
  try {
    const st = fs.statSync(p);
    if (st.isDirectory()) return "directory";
    if (st.isFile()) return "file";
    return "missing";
  } catch {
    return "missing";
  }
}

function pathExists(p) {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}

function checkPath(root, rel, required) {
  const p = path.join(root, rel);
  return {
    relPath: rel,
    exists: pathExists(p),
    required,
    kind: statKind(p),
  };
}

function readTextIfExists(p) {
  try {
    return fs.readFileSync(p, { encoding: "utf-8" });
  } catch {
    return "";
  }
}

function checkForbiddenAgents(root) {
  const p = path.join(root, "AGENTS.md");
  const text = readTextIfExists(p);
  return FORBIDDEN_AGENTS_MD_TOKENS.map((token) => ({
    token,
    present: text.includes(token),
    requiredAbsent: true,
  }));
}

function checkFileTokens(root) {
  const rows = [];
  for (const spec of REQUIRED_FILE_TOKENS) {
    const rel = spec.relPath;
    const text = readTextIfExists(path.join(root, rel));
    for (const token of spec.tokens) {
      rows.push({
        relPath: rel,
        token,
        present: text.includes(token),
        required: true,
      });
    }
  }
  return rows;
}

function run(root) {
  const paths = REQUIRED_STATIC_PATHS.map((rel) => checkPath(root, rel, true));
  for (const rel of OPTIONAL_LEGACY_PATHS) paths.push(checkPath(root, rel, false));
  const forbiddenAgents = checkForbiddenAgents(root);
  const fileTokens = checkFileTokens(root);
  const failures = [];
  for (const row of paths) {
    if (row.required && !row.exists) failures.push(`missing required path: ${row.relPath}`);
  }
  for (const row of fileTokens) {
    if (row.required && !row.present)
      failures.push(`${row.relPath} missing required token: ${row.token}`);
  }
  for (const row of forbiddenAgents) {
    if (row.present)
      failures.push(`AGENTS.md still contains legacy or raw-success token: ${row.token}`);
  }
  const ok = failures.length === 0;
  return {
    kind: "ops.runbookChecks.report.v2",
    classification: ok ? "minimum-static-gate-pass" : "minimum-static-gate-fail",
    root: String(root),
    ok,
    scope: "static-only",
    doesNotProve: [
      "ChatGPT Project Source upload/readback",
      "ChatGPT artifact receipt",
      "review pass",
      "merge-review pass",
      "tailnet GitHub push",
      "complete-approved",
    ],
    failures,
    paths,
    liveProofs: LIVE_PROOF_STATUSES,
    forbiddenAgentsTokens: forbiddenAgents,
    fileTokens,
  };
}

function main(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        root: { type: "string", default: "/home/nixos/repos" },
        json: { type: "boolean" },
      },
      strict: true,
    }));
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    return 2;
  }

  const report = run(values.root);
  if (values.json) {
    process.stdout.write(pyJsonIndent2(report) + "\n");
  } else {
    process.stdout.write(`ops-runbook-checks: ${report.classification}\n`);
    for (const failure of report.failures) {
      process.stdout.write(`- ${failure}\n`);
    }
    if (report.ok) {
      process.stdout.write("- live proof remains not-proven by this static check\n");
    }
  }
  return report.ok ? 0 : 1;
}

const code = main(process.argv.slice(2));
process.exit(code);
