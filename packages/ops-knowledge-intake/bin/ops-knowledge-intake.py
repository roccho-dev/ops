#!/usr/bin/env python3
"""Extract reusable knowledge candidates from zip inventory TSV files.

The input TSV is an evidence inventory, not a rulebook. This command keeps the
raw evidence as paths and emits small records that can later be promoted to a
spec, check, or retry template.
"""

from __future__ import annotations

import argparse
import csv
import json
import pathlib
import sys
from collections import Counter
from typing import Any


FIELDNAMES = [
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
]


PROMOTABLE_ROLES = {
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
}


def load_rows(path: pathlib.Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t")
        if not reader.fieldnames:
            raise SystemExit(f"empty TSV: {path}")
        return [{k: (v or "") for k, v in row.items()} for row in reader]


def safe_slug(value: str) -> str:
    out = []
    for ch in value.lower():
        if ch.isalnum():
            out.append(ch)
        elif out and out[-1] != "-":
            out.append("-")
    return "".join(out).strip("-")[:80] or "unknown"


def classify(row: dict[str, str]) -> dict[str, str] | None:
    role = row.get("role_hint", "")
    if role not in PROMOTABLE_ROLES:
        return None

    logical_unit = row.get("logical_unit", "") or row.get("group", "") or "unknown"
    path = row.get("normalized_path", "") or row.get("member_path", "")
    basename = row.get("basename", "")

    if role == "thread_prompt":
        kind = "retry-template-candidate"
        symptom = f"thread prompt exists: {basename}"
        cause = "A previous operation needed a reusable prompt to recover or drive a thread."
        detection = "A future run hits the same failure kind or needs the same worker/review role."
        recovery = "Promote the prompt into a named retry template only after confirming it is not one-off prose."
    elif role in {"runtime_report", "run_report"}:
        kind = "run-evidence"
        symptom = f"run report exists in {logical_unit}"
        cause = "The run produced operational facts that may contain reusable decisions or blockers."
        detection = "Review the report for repeated failure kinds, accepted gates, and rejected paths."
        recovery = "Extract only repeated or safety-critical facts into a check/template; keep report as raw evidence."
    elif role == "receipt_or_source_read_proof":
        kind = "gate-candidate"
        symptom = f"source receipt proof exists: {basename}"
        cause = "A thread had to prove it read Project Source or local accepted base."
        detection = "A worker starts without declaring source files, snapshot id, or missing context."
        recovery = "Promote to a hard Source Receipt gate when the proof shape repeats."
    elif role == "thread_artifact":
        kind = "artifact-evidence"
        symptom = f"thread artifact exists: {basename}"
        cause = "A worker or review thread produced an output that may be recoverable or evaluable."
        detection = "Artifact is referenced by thread output, RUN_REPORT, or materialize manifest."
        recovery = "Keep as evidence unless it defines a reusable schema or successful output contract."
    elif role == "patch_payload":
        kind = "implementation-evidence"
        symptom = f"patch payload exists: {basename}"
        cause = "A thread produced a concrete change candidate."
        detection = "Patch can be applied, normalized, rejected, or compared against accepted worktree."
        recovery = "Promote only the validation rule or merge lesson, not the patch body itself."
    elif role == "project_source_input":
        kind = "source-seed-evidence"
        symptom = f"Project Source input exists: {basename}"
        cause = "A run used shared context to seed worker/merge/review threads."
        detection = "A later run needs the same seed, manifest, contract, or accepted cache structure."
        recovery = "Promote stable source files into a package contract; keep run-specific source payloads as evidence."
    elif role in {"ledger", "event_log"}:
        kind = "state-management-evidence"
        symptom = f"state record exists: {basename}"
        cause = "A run needed durable state to avoid forgetting what was assigned or accepted."
        detection = "Status is unclear, actor ownership is lost, or a completed/blocked thread must be reconstructed."
        recovery = "Promote event schema/checks, not ad-hoc status prose."
    elif role == "b64_payload":
        kind = "artifact-contract-evidence"
        symptom = f"B64 payload exists: {basename}"
        cause = "Plain BEGIN_FILE or file chip output was not reliable enough for machine artifacts."
        detection = "Output must be materialized with bytes and sha256 evidence."
        recovery = "Use BEGIN_B64_FILE plus materialize gate before local merge."
    else:
        return None

    return {
        "kind": kind,
        "symptom": symptom,
        "cause": cause,
        "detection": detection,
        "recovery": recovery,
        "applies_to": logical_unit,
        "evidence_paths": path,
        "status": "candidate",
        "promoted_to": "",
    }


def extract(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    seen: set[tuple[str, str, str]] = set()
    for row in rows:
        record = classify(row)
        if not record:
            continue
        key = (record["kind"], record["applies_to"], record["evidence_paths"])
        if key in seen:
            continue
        seen.add(key)
        record["knowledge_id"] = f"K{len(records) + 1:04d}-{safe_slug(record['kind'])}"
        records.append(record)
    return records


def write_tsv(path: pathlib.Path, records: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, delimiter="\t", fieldnames=FIELDNAMES, lineterminator="\n")
        writer.writeheader()
        writer.writerows(records)


def summarize(records: list[dict[str, str]]) -> dict[str, Any]:
    return {
        "kind": "ops.knowledgeIntake.summary.v1",
        "count": len(records),
        "byKind": dict(sorted(Counter(r["kind"] for r in records).items())),
        "byAppliesTo": dict(sorted(Counter(r["applies_to"] for r in records).items())),
    }


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--items", required=True, help="project_source_ops_knowledge_zip_items TSV")
    parser.add_argument("--out", required=True, help="output knowledge TSV")
    parser.add_argument("--json-summary", help="optional JSON summary output path")
    args = parser.parse_args(argv)

    rows = load_rows(pathlib.Path(args.items))
    records = extract(rows)
    write_tsv(pathlib.Path(args.out), records)
    summary = summarize(records)
    if args.json_summary:
        pathlib.Path(args.json_summary).write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
