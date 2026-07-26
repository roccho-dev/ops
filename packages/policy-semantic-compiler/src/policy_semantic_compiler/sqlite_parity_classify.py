from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def classify_reference(path: str) -> tuple[str, str, bool] | None:
    lower = path.lower()
    if lower.startswith(".github/workflows/"):
        return "test-required", "executable parity or package workflow", True
    if lower.startswith("packages/cue-append-contract-core/"):
        return "boundary-marker", "core contract vocabulary or boundary regression fixture", True
    if lower.startswith("packages/functional-core-governance-gate/"):
        return "boundary-marker", "functional-core database boundary detector", True
    if lower.startswith("packages/policy-semantic-compiler/bin/"):
        return "runtime-required", "active policy-semantic compiler wrapper path", True
    return None


def classify_difference(case_id: str, mismatch_ids: list[str]) -> dict[str, Any]:
    if "strictness-increase" in mismatch_ids:
        classification = "sqlite-explicit-validation-stricter"
        disposition = "requires-parent-acceptance-or-duckdb-validation-tightening"
    elif "detail-hash" in mismatch_ids and "gate-hash" not in mismatch_ids:
        classification = "detail-projection-shape-difference"
        disposition = "requires-detail-row-normalization"
    else:
        classification = "blocked-failure-shape-difference"
        disposition = "process-is-fail-closed-but-gate-contract-differs"
    return {
        "kind": "ops.sqliteParityDifference.v1",
        "caseId": case_id,
        "classification": classification,
        "mismatchIds": sorted(mismatch_ids),
        "accepted": False,
        "resolved": False,
        "disposition": disposition,
        "migrationClaimAllowed": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence-dir", type=Path, required=True)
    args = parser.parse_args()
    root = args.evidence_dir.resolve()

    inventory_path = root / "duckdb-usage.inventory.jsonl"
    inventory = [json.loads(line) for line in inventory_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    for row in inventory:
        if row.get("class") != "unknown":
            continue
        result = classify_reference(str(row.get("path", "")))
        if result:
            row["class"], row["reason"], row["active"] = result
    unknown = [row for row in inventory if row.get("class") == "unknown"]
    inventory_path.write_text("".join(canonical(row) + "\n" for row in inventory), encoding="utf-8")

    result_rows = [json.loads(line) for line in (root / "sqlite-parity.results.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    mismatch_by_case: dict[str, list[str]] = {}
    for row in result_rows:
        if row.get("mismatchIds"):
            mismatch_by_case[str(row["caseId"])] = list(row["mismatchIds"])
    differences = [classify_difference(case_id, mismatch_ids) for case_id, mismatch_ids in sorted(mismatch_by_case.items())]
    (root / "sqlite-parity.differences.jsonl").write_text("".join(canonical(row) + "\n" for row in differences), encoding="utf-8")

    summary_path = root / "sqlite-parity.summary.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    counts = Counter(str(row["class"]) for row in inventory)
    summary["usageInventoryCounts"] = dict(sorted(counts.items()))
    summary["unknownUsageReferenceCount"] = len(unknown)
    summary["classifiedMismatchCount"] = len(differences)
    summary["unclassifiedMismatchCount"] = 0
    summary["differenceEvidence"] = "sqlite-parity.differences.jsonl"
    summary["inventoryClassificationVersion"] = "ops-90.v1"
    summary["candidateStatus"] = "pass" if summary.get("unresolvedMismatches") == 0 and summary.get("failClosedRegressionCount") == 0 and not unknown else "blocked"
    summary["migrationClaimAllowed"] = summary["candidateStatus"] == "pass"
    summary_path.write_text(json.dumps(summary, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    if unknown:
        for row in unknown:
            print(f"unclassified: {row.get('path')}:{row.get('line')}")
        return 1
    print(canonical({"unknownReferences": 0, "classifiedMismatches": len(differences), "candidateStatus": summary["candidateStatus"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
