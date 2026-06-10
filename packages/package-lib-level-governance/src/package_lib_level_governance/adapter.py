from __future__ import annotations

import csv
import json
import pathlib
from typing import Any

from .core import classify_records, compare_with_baseline, read_jsonl_text, summarize


def read_jsonl(path: pathlib.Path) -> list[dict[str, Any]]:
    try:
        return read_jsonl_text(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise SystemExit(f"package-lib-level-governance:error:read-jsonl:{path}:{exc}") from exc


def write_json(path: pathlib.Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def write_jsonl(path: pathlib.Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n" for row in rows), encoding="utf-8")


def write_csv(path: pathlib.Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "packageId",
        "status",
        "expectedLevel",
        "classification",
        "disposition",
        "severity",
        "coreEvidence",
        "portEvidence",
        "adapterEvidence",
        "exampleUsecaseE2eEvidence",
        "governanceGateEvidence",
        "adapterAuthorityRisk",
        "reason",
        "requiredNext",
    ]
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, lineterminator="\n")
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key, "") for key in fieldnames})


def audit(root: pathlib.Path, baseline: pathlib.Path | None, out_dir: pathlib.Path | None, mode: str) -> dict[str, Any]:
    root = root.resolve()
    package_contracts = root / "governance-records-main" / "records" / "specs" / "package-contract.v1.jsonl"
    records = read_jsonl(package_contracts)
    classifications = classify_records(records)
    rows = [row.to_row() for row in sorted(classifications, key=lambda r: r.packageId)]
    summary = summarize(classifications)
    comparison = {"kind": "packageLibLevelGovernance.baselineComparison.v1", "mode": mode, "ok": True, "errors": []}
    if baseline:
        baseline_rows = read_jsonl(baseline)
        comparison = compare_with_baseline(classifications, baseline_rows, mode=mode)
    result = {
        "kind": "packageLibLevelGovernance.auditResult.v1",
        "ok": bool(comparison.get("ok")),
        "mode": mode,
        "summary": summary,
        "comparison": comparison,
    }
    if out_dir:
        write_json(out_dir / "package-lib-level-summary.json", result)
        write_jsonl(out_dir / "package-lib-level-baseline.generated.v1.jsonl", rows)
        write_jsonl(out_dir / "package-lib-level-findings.v1.jsonl", [row for row in rows if row["disposition"] == "accepted-baseline-debt"])
        write_csv(out_dir / "package-lib-level-report.csv", rows)
    return result
