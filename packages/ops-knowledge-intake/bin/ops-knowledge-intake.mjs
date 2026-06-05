#!/usr/bin/env node
// Extract reusable knowledge candidates from zip inventory TSV files.
//
// The input TSV is an evidence inventory, not a rulebook. This command keeps the
// raw evidence as paths and emits small records that can later be promoted to a
// spec, check, or retry template.
//
// Node ESM port of ops-knowledge-intake.py (stdlib only, behavior-identical).

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

process.on("unhandledRejection", (e) => {
  console.error(e);
  process.exit(1);
});

const FIELDNAMES = [
  "knowledge_id",
  "kind",
  "symptom",
  "cause",
  "detection",
  "recovery",
  "applies_to",
  "evidence_paths",
  "status",
  "promoted_to",
];

const PROMOTABLE_ROLES = new Set([
  "thread_prompt",
  "runtime_report",
  "run_report",
  "thread_artifact",
  "patch_payload",
  "receipt_or_source_read_proof",
  "project_source_input",
  "ledger",
  "event_log",
  "b64_payload",
]);

function loadRows(filePath) {
  const text = fs.readFileSync(filePath, { encoding: "utf-8" });
  // Python csv with delimiter="\t". The input has no embedded tabs/quotes in
  // fields, so a line/tab split matches Python's csv.DictReader here.
  // Strip a single trailing newline (Python csv ignores the final empty line).
  let body = text;
  if (body.endsWith("\r\n")) body = body.slice(0, -2);
  else if (body.endsWith("\n")) body = body.slice(0, -1);
  if (body === "") {
    throw new Error(`empty TSV: ${filePath}`);
  }
  const lines = body.split("\n");
  if (lines.length === 0 || lines[0] === "") {
    throw new Error(`empty TSV: ${filePath}`);
  }
  const header = lines[0].split("\t");
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === "") continue;
    const cells = line.split("\t");
    const row = {};
    for (let j = 0; j < header.length; j++) {
      row[header[j]] = cells[j] !== undefined && cells[j] !== null ? cells[j] : "";
    }
    rows.push(row);
  }
  return rows;
}

// Mirror Python str.isalnum(): unicode-aware alphanumeric, no underscore.
const ALNUM_RE = /[\p{L}\p{Nd}\p{Nl}\p{No}]/u;
function isAlnum(ch) {
  return ALNUM_RE.test(ch);
}

function safeSlug(value) {
  const out = [];
  for (const ch of value.toLowerCase()) {
    if (isAlnum(ch)) {
      out.push(ch);
    } else if (out.length && out[out.length - 1] !== "-") {
      out.push("-");
    }
  }
  let s = out.join("");
  // strip leading/trailing "-"
  s = s.replace(/^-+/, "").replace(/-+$/, "");
  s = s.slice(0, 80);
  // Re-strip in case slicing cut mid-run (Python strips before slicing, but
  // since stripping leaves no leading "-", a trailing "-" can only appear if
  // slice ends on one). Match Python: strip THEN slice -> trailing "-" possible.
  return s || "unknown";
}

function get(row, key) {
  return Object.prototype.hasOwnProperty.call(row, key) ? row[key] : "";
}

function classify(row) {
  const role = get(row, "role_hint");
  if (!PROMOTABLE_ROLES.has(role)) {
    return null;
  }

  const logicalUnit = get(row, "logical_unit") || get(row, "group") || "unknown";
  const path_ = get(row, "normalized_path") || get(row, "member_path");
  const basename = get(row, "basename");

  let kind, symptom, cause, detection, recovery;

  if (role === "thread_prompt") {
    kind = "retry-template-candidate";
    symptom = `thread prompt exists: ${basename}`;
    cause = "A previous operation needed a reusable prompt to recover or drive a thread.";
    detection = "A future run hits the same failure kind or needs the same worker/review role.";
    recovery = "Promote the prompt into a named retry template only after confirming it is not one-off prose.";
  } else if (role === "runtime_report" || role === "run_report") {
    kind = "run-evidence";
    symptom = `run report exists in ${logicalUnit}`;
    cause = "The run produced operational facts that may contain reusable decisions or blockers.";
    detection = "Review the report for repeated failure kinds, accepted gates, and rejected paths.";
    recovery = "Extract only repeated or safety-critical facts into a check/template; keep report as raw evidence.";
  } else if (role === "receipt_or_source_read_proof") {
    kind = "gate-candidate";
    symptom = `source receipt proof exists: ${basename}`;
    cause = "A thread had to prove it read Project Source or local accepted base.";
    detection = "A worker starts without declaring source files, snapshot id, or missing context.";
    recovery = "Promote to a hard Source Receipt gate when the proof shape repeats.";
  } else if (role === "thread_artifact") {
    kind = "artifact-evidence";
    symptom = `thread artifact exists: ${basename}`;
    cause = "A worker or review thread produced an output that may be recoverable or evaluable.";
    detection = "Artifact is referenced by thread output, RUN_REPORT, or materialize manifest.";
    recovery = "Keep as evidence unless it defines a reusable schema or successful output contract.";
  } else if (role === "patch_payload") {
    kind = "implementation-evidence";
    symptom = `patch payload exists: ${basename}`;
    cause = "A thread produced a concrete change candidate.";
    detection = "Patch can be applied, normalized, rejected, or compared against accepted worktree.";
    recovery = "Promote only the validation rule or merge lesson, not the patch body itself.";
  } else if (role === "project_source_input") {
    kind = "source-seed-evidence";
    symptom = `Project Source input exists: ${basename}`;
    cause = "A run used shared context to seed worker/merge/review threads.";
    detection = "A later run needs the same seed, manifest, contract, or accepted cache structure.";
    recovery = "Promote stable source files into a package contract; keep run-specific source payloads as evidence.";
  } else if (role === "ledger" || role === "event_log") {
    kind = "state-management-evidence";
    symptom = `state record exists: ${basename}`;
    cause = "A run needed durable state to avoid forgetting what was assigned or accepted.";
    detection = "Status is unclear, actor ownership is lost, or a completed/blocked thread must be reconstructed.";
    recovery = "Promote event schema/checks, not ad-hoc status prose.";
  } else if (role === "b64_payload") {
    kind = "artifact-contract-evidence";
    symptom = `B64 payload exists: ${basename}`;
    cause = "Plain BEGIN_FILE or file chip output was not reliable enough for machine artifacts.";
    detection = "Output must be materialized with bytes and sha256 evidence.";
    recovery = "Use BEGIN_B64_FILE plus materialize gate before local merge.";
  } else {
    return null;
  }

  return {
    kind,
    symptom,
    cause,
    detection,
    recovery,
    applies_to: logicalUnit,
    evidence_paths: path_,
    status: "candidate",
    promoted_to: "",
  };
}

function extract(rows) {
  const records = [];
  const seen = new Set();
  for (const row of rows) {
    const record = classify(row);
    if (!record) continue;
    const key = JSON.stringify([record.kind, record.applies_to, record.evidence_paths]);
    if (seen.has(key)) continue;
    seen.add(key);
    const n = records.length + 1;
    const padded = String(n).padStart(4, "0");
    record.knowledge_id = `K${padded}-${safeSlug(record.kind)}`;
    records.push(record);
  }
  return records;
}

function writeTsv(filePath, records) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const parts = [FIELDNAMES.join("\t")];
  for (const record of records) {
    parts.push(FIELDNAMES.map((f) => record[f]).join("\t"));
  }
  // DictWriter with lineterminator="\n" and writeheader + writerows:
  // each row (including header) is followed by "\n".
  const text = parts.map((line) => line + "\n").join("");
  fs.writeFileSync(filePath, text, { encoding: "utf-8" });
}

function counter(values) {
  const counts = new Map();
  for (const v of values) {
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return counts;
}

function sortedObj(counts) {
  const obj = {};
  for (const k of [...counts.keys()].sort()) {
    obj[k] = counts.get(k);
  }
  return obj;
}

function summarize(records) {
  return {
    kind: "ops.knowledgeIntake.summary.v1",
    count: records.length,
    byKind: sortedObj(counter(records.map((r) => r.kind))),
    byAppliesTo: sortedObj(counter(records.map((r) => r.applies_to))),
  };
}

function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      items: { type: "string" },
      out: { type: "string" },
      "json-summary": { type: "string" },
    },
    strict: true,
  });

  if (values.items === undefined) {
    process.stderr.write("error: the following arguments are required: --items\n");
    return 2;
  }
  if (values.out === undefined) {
    process.stderr.write("error: the following arguments are required: --out\n");
    return 2;
  }

  const rows = loadRows(values.items);
  const records = extract(rows);
  writeTsv(values.out, records);
  const summary = summarize(records);
  // Python json.dumps(indent=2) — JSON.stringify with indent 2 matches for
  // ASCII keys/values used here.
  const summaryText = JSON.stringify(summary, null, 2);
  if (values["json-summary"]) {
    fs.writeFileSync(values["json-summary"], summaryText + "\n", { encoding: "utf-8" });
  }
  process.stdout.write(summaryText + "\n");
  return 0;
}

const code = main(process.argv.slice(2));
process.exit(code);
