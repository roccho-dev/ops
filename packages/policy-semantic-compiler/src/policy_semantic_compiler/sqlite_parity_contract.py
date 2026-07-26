#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable

REQUIRED_FILES = {
    "source_files": "policy.sourceFile.v1.jsonl",
    "source_spans": "policy.sourceSpan.v1.jsonl",
    "semantic_nodes": "policy.semanticNode.v1.jsonl",
    "semantic_edges": "policy.semanticEdge.v1.jsonl",
    "span_dispositions": "policy.sourceSpanDisposition.v1.jsonl",
    "coverage_proofs": "policy.acceptedCoverageProof.v1.jsonl",
    "fresh_genx_reviews": "policy.freshGenXReconstructionReview.v1.jsonl",
}
OPTIONAL_FILES = {
    "dispositions": "policy.sourceFileDisposition.v1.jsonl",
    "review_batches": "policy.sourceSpanDispositionReviewBatch.v1.jsonl",
    "review_assignments": "policy.sourceSpanDispositionReviewAssignment.v1.jsonl",
    "review_packets": "policy.sourceSpanDispositionReviewPacket.v1.jsonl",
    "review_work_orders": "policy.sourceSpanDispositionReviewerWorkOrder.v1.jsonl",
    "review_result_templates": "policy.sourceSpanDispositionReviewResultTemplate.v1.jsonl",
    "required_discussions": "policy.sourceSpanDispositionDirectCrossDiscussionRequired.v1.jsonl",
    "direct_discussion_templates": "policy.sourceSpanDispositionDirectCrossDiscussionTemplate.v1.jsonl",
    "review_results": "policy.sourceSpanDispositionReviewResult.v1.jsonl",
    "discussion_results": "policy.sourceSpanDispositionDirectCrossDiscussion.v1.jsonl",
}

SCHEMAS: dict[str, dict[str, Any]] = {
    "source_files": {
        "kind": "policy.sourceFile.v1",
        "required": {"id": str, "kind": str, "path": str, "sourceTrace": dict, "status": str},
        "allowed": {"id", "kind", "path", "sourceTrace", "status"},
    },
    "source_spans": {
        "kind": "policy.sourceSpan.v1",
        "required": {"id": str, "kind": str, "sourceFileId": str, "sourceTrace": dict, "status": str},
        "allowed": {"id", "kind", "sourceFileId", "sourceTrace", "status"},
    },
    "semantic_nodes": {
        "kind": "policy.semanticNode.v1",
        "required": {"id": str, "kind": str, "nodeKind": str, "sourceSpanIds": list, "sourceTrace": dict, "status": str},
        "allowed": {"id", "kind", "nodeKind", "sourceSpanIds", "sourceTrace", "status"},
    },
    "semantic_edges": {
        "kind": "policy.semanticEdge.v1",
        "required": {"id": str, "kind": str, "edgeKind": str, "from": str, "to": str, "sourceSpanIds": list, "sourceTrace": dict, "status": str},
        "allowed": {"id", "kind", "edgeKind", "from", "to", "sourceSpanIds", "sourceTrace", "status"},
    },
    "span_dispositions": {
        "kind": "policy.sourceSpanDisposition.v1",
        "required": {
            "id": str,
            "kind": str,
            "accepted": bool,
            "status": str,
            "policyRev": str,
            "sourceSpanIds": list,
            "disposition": str,
            "fixtureOnly": bool,
            "generatedIsAuthority": bool,
            "policyDeletionApproved": bool,
        },
        "allowed": {"id", "kind", "accepted", "status", "policyRev", "sourceSpanIds", "disposition", "fixtureOnly", "generatedIsAuthority", "policyDeletionApproved"},
    },
    "coverage_proofs": {
        "kind": "policy.acceptedCoverageProof.v1",
        "required": {
            "id": str,
            "kind": str,
            "accepted": bool,
            "status": str,
            "policyRev": str,
            "coveredSourceSpanIds": list,
            "freshGenXEvidenceIds": list,
            "reviewerThreadRefs": list,
            "noRemainingObjections": bool,
            "fixtureOnly": bool,
            "generatedIsAuthority": bool,
            "policyDeletionApproved": bool,
        },
        "allowed": {"id", "kind", "accepted", "status", "policyRev", "coveredSourceSpanIds", "freshGenXEvidenceIds", "reviewerThreadRefs", "noRemainingObjections", "fixtureOnly", "generatedIsAuthority", "policyDeletionApproved"},
    },
    "fresh_genx_reviews": {
        "kind": "policy.freshGenXReconstructionReview.v1",
        "required": {
            "id": str,
            "kind": str,
            "status": str,
            "policyRev": str,
            "memoryUsed": bool,
            "policyBodyUsedAsSource": bool,
            "fixtureOnly": bool,
            "noRemainingObjections": bool,
            "reviewerIds": list,
            "inputs": list,
        },
        "allowed": {"id", "kind", "status", "policyRev", "memoryUsed", "policyBodyUsedAsSource", "fixtureOnly", "noRemainingObjections", "reviewerIds", "inputs"},
    },
    "dispositions": {
        "kind": "policy.sourceFileDisposition.v1",
        "required": {"id": str, "kind": str, "sourceFileId": str, "status": str, "requiresIndividualSemanticApproval": bool},
        "allowed": {"id", "kind", "sourceFileId", "status", "requiresIndividualSemanticApproval"},
    },
}

PROVIDER_GATE_IDS = [
    "review-batches-cover-missing-accepted-spans",
    "review-batches-have-two-reviewer-assignments",
    "review-batches-have-review-packets",
    "review-packets-match-batch-spans",
    "review-packets-have-projection-fields",
    "review-assignments-have-work-orders",
    "review-work-orders-match-assignments-and-packets",
    "review-work-orders-have-result-templates",
    "review-result-templates-match-work-orders",
    "review-batches-have-direct-cross-discussion-required",
    "review-batches-have-direct-cross-discussion-templates",
    "direct-cross-discussion-templates-match-required-discussions",
    "review-assignments-have-accepted-results",
    "review-results-match-assignments-and-packets",
    "review-batches-have-accepted-direct-cross-discussions",
    "direct-cross-discussions-match-review-results",
]

DETAIL_SPECS = {
    "missing-accepted-span-dispositions.jsonl": "policySemantic.missingAcceptedSpanDisposition.v1",
    "missing-accepted-coverage.jsonl": "policySemantic.missingAcceptedCoverage.v1",
    "candidate-only-span-dispositions.jsonl": "policySemantic.candidateOnlySpanDisposition.v1",
    "candidate-only-file-dispositions.jsonl": "policySemantic.candidateOnlyFileDisposition.v1",
}

class ProofError(Exception):
    pass

@dataclass(frozen=True)
class Case:
    case_id: str
    mutate: Callable[[Path], None]
    duckdb_bin: str = "duckdb"
    compare_mode: str = "full"


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_json(value: Any) -> str:
    return sha256_bytes(canonical_json(value).encode("utf-8"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(canonical_json(row) + "\n")


def read_jsonl_loose(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ProofError(f"{path}:{line_no}: malformed JSON: {exc.msg}") from exc
        if not isinstance(row, dict):
            raise ProofError(f"{path}:{line_no}: JSONL row must be an object")
        rows.append(row)
    return rows


def strict_rows(path: Path, schema_name: str) -> list[dict[str, Any]]:
    rows = read_jsonl_loose(path)
    if not rows:
        raise ProofError(f"{path}: required JSONL contains no records")
    schema = SCHEMAS[schema_name]
    seen: set[str] = set()
    for line_no, row in enumerate(rows, start=1):
        unknown = sorted(set(row) - schema["allowed"])
        if unknown:
            raise ProofError(f"{path}:{line_no}: unknown fields: {','.join(unknown)}")
        for field, expected_type in schema["required"].items():
            if field not in row:
                raise ProofError(f"{path}:{line_no}: missing required field: {field}")
            value = row[field]
            if expected_type is bool:
                ok = type(value) is bool
            else:
                ok = isinstance(value, expected_type)
            if not ok:
                raise ProofError(f"{path}:{line_no}: {field} must be {expected_type.__name__}")
        if row["kind"] != schema["kind"]:
            raise ProofError(f"{path}:{line_no}: unexpected kind: {row['kind']}")
        row_id = row["id"]
        if row_id in seen:
            raise ProofError(f"{path}:{line_no}: duplicate id: {row_id}")
        seen.add(row_id)
        for field in ("sourceSpanIds", "coveredSourceSpanIds", "freshGenXEvidenceIds", "reviewerThreadRefs", "reviewerIds", "inputs"):
            if field in row and any(not isinstance(item, str) for item in row[field]):
                raise ProofError(f"{path}:{line_no}: {field} must contain only strings")
        if "sourceTrace" in row:
            trace = row["sourceTrace"]
            for key in ("repo", "rev", "path"):
                if not isinstance(trace.get(key), str) or not trace[key]:
                    raise ProofError(f"{path}:{line_no}: sourceTrace.{key} must be a non-empty string")
            for key in ("startLine", "endLine"):
                if key in trace and (type(trace[key]) is not int or trace[key] < 1):
                    raise ProofError(f"{path}:{line_no}: sourceTrace.{key} must be a positive integer")
    return rows


def optional_rows(path: Path, schema_name: str) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows = read_jsonl_loose(path)
    if not rows:
        return []
    return strict_rows(path, schema_name)


def bool_int(value: bool) -> int:
    return 1 if value else 0


def trace(row: dict[str, Any]) -> dict[str, Any]:
    value = row.get("sourceTrace")
    return value if isinstance(value, dict) else {}

