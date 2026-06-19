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
]);

// Faithful reader compatible with Python csv.DictReader(f, delimiter="\t").
// csv dialect defaults: quotechar='"', doublequote=True ("" -> literal "),
// QUOTE_MINIMAL. Handles quoted fields, embedded tabs and embedded newlines
// inside quotes. Records are split on row boundaries (newlines NOT inside a
// quoted field). Python's reader treats \r\n / \r / \n as row terminators.
//
// DictReader semantics: header row -> fieldnames; per data row, zip names with
// cells; missing cells -> restval (None -> ""); extra cells -> restkey (None).
// The Python wrapper does {k: (v or "") for k,v in row.items()}, so we coerce
// all values (incl. the restkey list) to "" when falsy is irrelevant here —
// classify() only reads named string keys. We keep named keys as strings.
function parseCsvRecords(text, delimiter) {
  const records = [];
  let field = "";
  let record = [];
  let inQuotes = false;
  let fieldStarted = false; // whether the current field has begun (for leading quote detection)
  let i = 0;
  const n = text.length;
  const pushField = () => {
    record.push(field);
    field = "";
    fieldStarted = false;
  };
  const pushRecord = () => {
    pushField();
    records.push(record);
    record = [];
  };
  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && !fieldStarted) {
      // quote at start of field opens a quoted field
      inQuotes = true;
      fieldStarted = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      pushField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      // \r or \r\n terminates a record
      pushRecord();
      i += text[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    if (ch === "\n") {
      pushRecord();
      i += 1;
      continue;
    }
    field += ch;
    fieldStarted = true;
    i += 1;
  }
  // flush trailing field/record if any content was accumulated.
  // Python csv ignores a final empty line (no trailing empty record).
  if (field !== "" || record.length > 0) {
    pushRecord();
  }
  return records;
}

function loadRows(filePath) {
  const text = fs.readFileSync(filePath, { encoding: "utf-8" });
  const records = parseCsvRecords(text, "\t");
  if (records.length === 0 || records[0].length === 0 || (records[0].length === 1 && records[0][0] === "")) {
    throw new Error(`empty TSV: ${filePath}`);
  }
  const header = records[0];
  const rows = [];
  for (let r = 1; r < records.length; r++) {
    const cells = records[r];
    const row = {};
    for (let j = 0; j < header.length; j++) {
      // DictReader restval None -> Python wrapper coerces to "".
      const v = j < cells.length ? cells[j] : "";
      row[header[j]] = v;
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

// Encode one field the way Python csv.writer (QUOTE_MINIMAL, doublequote=True)
// does: quote the field iff it contains the delimiter, the quotechar, CR or LF;
// internal quotechar is doubled. A field's symptom can carry an embedded tab or
// newline (it embeds basename), so faithful quoting is required for byte parity.
function csvField(value, delimiter) {
  const s = value === null || value === undefined ? "" : String(value);
  const needsQuote = s.includes(delimiter) || s.includes('"') || s.includes("\n") || s.includes("\r");
  if (!needsQuote) return s;
  return '"' + s.replace(/"/g, '""') + '"';
}

function writeTsv(filePath, records) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const enc = (line) => line.map((c) => csvField(c, "\t")).join("\t");
  const parts = [enc(FIELDNAMES)];
  for (const record of records) {
    parts.push(enc(FIELDNAMES.map((f) => record[f])));
  }
  // DictWriter with lineterminator="\n" and writeheader + writerows:
  // each row (including header) is followed by "\n".
  const text = parts.map((line) => line + "\n").join("");
  fs.writeFileSync(filePath, text, { encoding: "utf-8" });
}

// --- Python json.dumps(indent=2) serializer (ensure_ascii=True, NO sort_keys) ---
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
  return (
    "{\n" +
    keys.map((k) => pad + jsonString(k) + ": " + ser(value[k], indent, depth + 1)).join(",\n") +
    "\n" +
    closePad +
    "}"
  );
}

// Python json.dumps(value, indent=2) — ensure_ascii=True, no sort_keys.
// byKind/byAppliesTo are pre-sorted (see sortedObj) so insertion order == python.
function dumps2(value) {
  return ser(value, 2, 0);
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
  // Python json.dumps(indent=2), ensure_ascii=True, no sort_keys (byKind/
  // byAppliesTo are already sorted). Non-ASCII applies_to -> \uXXXX like python.
  const summaryText = dumps2(summary);
  if (values["json-summary"]) {
    fs.writeFileSync(values["json-summary"], summaryText + "\n", { encoding: "utf-8" });
  }
  process.stdout.write(summaryText + "\n");
  return 0;
}

const code = main(process.argv.slice(2));
process.exit(code);
