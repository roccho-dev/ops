from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

from .sqlite_parity_contract import write_jsonl


def _read_reviews(paths: list[Path]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for path in paths:
        rows = [
            json.loads(line)
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        for row in rows:
            key = str(row.get("path") or "")
            if not key or key in result:
                raise ValueError(
                    f"invalid or duplicate DuckDB usage review path: {key!r}"
                )
            if (
                row.get("kind") != "ops.duckdbUsagePathReview.v1"
                or row.get("reviewed") is not True
            ):
                raise ValueError(
                    f"DuckDB usage review is not accepted for path: {key}"
                )
            result[key] = row
    return result


def reviewed_inventory(
    repo_root: Path,
    review_paths: list[Path],
    evidence_dir: Path,
    repository_sha: str | None,
) -> dict[str, Any]:
    review = _read_reviews(review_paths)
    suffixes = {
        ".py",
        ".sh",
        ".sql",
        ".nix",
        ".json",
        ".jsonl",
        ".md",
        ".yml",
        ".yaml",
        ".toml",
        ".go",
        ".mjs",
        ".js",
    }
    skip = {".git", ".worktrees", "node_modules", "result", "__pycache__"}
    rows: list[dict[str, Any]] = []
    observed_paths: set[str] = set()
    for path in sorted(
        p
        for p in repo_root.rglob("*")
        if p.is_file()
        and p.suffix.lower() in suffixes
        and not any(part in skip for part in p.parts)
    ):
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        rel = path.relative_to(repo_root).as_posix()
        for line_no, line in enumerate(text.splitlines(), start=1):
            if "duckdb" not in line.lower():
                continue
            observed_paths.add(rel)
            owner_review = review.get(rel)
            rows.append(
                {
                    "repositorySha": repository_sha,
                    "path": rel,
                    "line": line_no,
                    "symbol": None,
                    "class": owner_review.get("class")
                    if owner_review
                    else "unknown",
                    "caller": line.strip()[:500],
                    "active": owner_review.get("active")
                    if owner_review
                    else None,
                    "reason": owner_review.get("reachabilityEvidence")
                    if owner_review
                    else "missing owner-reviewed path classification",
                    "evidence": f"{rel}:{line_no}",
                    "reviewed": owner_review is not None,
                    "reviewedBy": owner_review.get("reviewedBy")
                    if owner_review
                    else None,
                    "reviewedAt": owner_review.get("reviewedAt")
                    if owner_review
                    else None,
                }
            )
    rows.sort(key=lambda row: (row["path"], row["line"]))
    write_jsonl(evidence_dir / "duckdb-usage.inventory.jsonl", rows)
    unknown_paths = sorted(
        {str(row["path"]) for row in rows if row["class"] == "unknown"}
    )
    missing_reviewed_paths = sorted(
        path
        for path, row in review.items()
        if row.get("active") is True and path not in observed_paths
    )
    counts = Counter(str(row["class"]) for row in rows)
    return {
        "counts": dict(sorted(counts.items())),
        "unknownPathCount": len(unknown_paths),
        "unknownPaths": unknown_paths,
        "reviewedPathCount": len(review),
        "observedPathCount": len(observed_paths),
        "missingActiveReviewedPathCount": len(missing_reviewed_paths),
        "missingActiveReviewedPaths": missing_reviewed_paths,
        "reviewFiles": [
            path.relative_to(repo_root).as_posix() for path in review_paths
        ],
    }
