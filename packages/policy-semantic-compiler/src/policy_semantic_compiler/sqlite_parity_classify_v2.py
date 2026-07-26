from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any


CLASSIFICATIONS: dict[str, tuple[str, str]] = {
    "array-null": (
        "blocked-failure-shape-difference",
        "process-is-fail-closed-but-gate-contract-differs",
    ),
    "boolean-string": (
        "sqlite-explicit-validation-stricter",
        "requires-parent-acceptance-or-duckdb-validation-tightening",
    ),
    "candidate-only-span-disposition": (
        "detail-projection-shape-difference",
        "requires-detail-row-normalization",
    ),
    "duplicate-id": (
        "sqlite-explicit-validation-stricter",
        "requires-parent-acceptance-or-duckdb-validation-tightening",
    ),
    "empty-jsonl": (
        "blocked-failure-shape-difference",
        "process-is-fail-closed-but-gate-contract-differs",
    ),
    "malformed-jsonl": (
        "blocked-failure-shape-difference",
        "process-is-fail-closed-but-gate-contract-differs",
    ),
    "missing-array-field": (
        "blocked-failure-shape-difference",
        "process-is-fail-closed-but-gate-contract-differs",
    ),
    "missing-nested-source-trace": (
        "blocked-failure-shape-difference",
        "process-is-fail-closed-but-gate-contract-differs",
    ),
    "provider-workflow-accepted-results": (
        "provider-workflow-unsupported",
        "sqlite-candidate-must-implement-current-python-post-gate-reducer",
    ),
    "provider-workflow-incomplete": (
        "provider-workflow-unsupported",
        "sqlite-candidate-must-implement-current-python-post-gate-reducer",
    ),
    "unknown-field": (
        "sqlite-explicit-validation-stricter",
        "requires-parent-acceptance-or-duckdb-validation-tightening",
    ),
    "unknown-required-kind": (
        "sqlite-explicit-validation-stricter",
        "requires-parent-acceptance-or-duckdb-validation-tightening",
    ),
}


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence-dir", type=Path, required=True)
    args = parser.parse_args()
    root = args.evidence_dir.resolve()

    inventory = [
        json.loads(line)
        for line in (root / "duckdb-usage.inventory.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
        if line.strip()
    ]
    unknown = sorted({str(row["path"]) for row in inventory if row.get("class") == "unknown"})
    result_rows = [
        json.loads(line)
        for line in (root / "sqlite-parity.results.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
        if line.strip()
    ]
    mismatch_by_case: dict[str, list[str]] = {}
    for row in result_rows:
        if row.get("mismatchIds"):
            mismatch_by_case[str(row["caseId"])] = list(row["mismatchIds"])

    differences: list[dict[str, Any]] = []
    unclassified: list[str] = []
    for case_id, mismatch_ids in sorted(mismatch_by_case.items()):
        classified = CLASSIFICATIONS.get(case_id)
        if classified is None:
            classification = "unclassified"
            disposition = "owner-classification-required"
            unclassified.append(case_id)
        else:
            classification, disposition = classified
        differences.append(
            {
                "kind": "ops.sqliteParityDifference.v1",
                "caseId": case_id,
                "classification": classification,
                "mismatchIds": sorted(set(mismatch_ids)),
                "accepted": False,
                "resolved": False,
                "disposition": disposition,
                "migrationClaimAllowed": False,
            }
        )
    (root / "sqlite-parity.differences.jsonl").write_text(
        "".join(canonical(row) + "\n" for row in differences), encoding="utf-8"
    )

    summary_path = root / "sqlite-parity.summary.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    counts = Counter(str(row["class"]) for row in inventory)
    summary["usageInventoryCounts"] = dict(sorted(counts.items()))
    summary["unknownUsageReferenceCount"] = len(unknown)
    summary["classifiedMismatchCount"] = len(differences) - len(unclassified)
    summary["unclassifiedMismatchCount"] = len(unclassified)
    summary["unclassifiedMismatchCaseIds"] = unclassified
    summary["differenceEvidence"] = "sqlite-parity.differences.jsonl"
    summary["inventoryClassificationVersion"] = "ops-90.v2-owner-reviewed"
    summary["candidateStatus"] = (
        "pass"
        if summary.get("unresolvedMismatches") == 0
        and summary.get("failClosedRegressionCount") == 0
        and not unknown
        and not unclassified
        else "blocked"
    )
    summary["migrationClaimAllowed"] = summary["candidateStatus"] == "pass"
    summary_path.write_text(
        json.dumps(summary, sort_keys=True, indent=2) + "\n", encoding="utf-8"
    )
    print(
        canonical(
            {
                "unknownPaths": unknown,
                "unclassifiedCases": unclassified,
                "candidateStatus": summary["candidateStatus"],
            }
        )
    )
    return 1 if unknown or unclassified else 0


if __name__ == "__main__":
    raise SystemExit(main())
