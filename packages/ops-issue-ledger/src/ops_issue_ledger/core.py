from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import json
from typing import Any, Iterable

SEMANTICS_PROFILE = "canonical-latest-state-v1"
AUTHORITY_PATTERN = "issues/*.jsonl"
EXAMPLE_PATTERN = "example/poc/example"

REQUIRED_FIELDS = [
    "kind",
    "schemaVersion",
    "recordId",
    "issueId",
    "recordedAt",
    "recordType",
    "status",
    "title",
    "issueKind",
    "sourceRepo",
    "targetRepo",
    "priority",
    "suggestedBranch",
    "dependsOn",
    "allowedPaths",
    "forbiddenActions",
    "closeCriteria",
    "requiredEvidence",
    "supersedes",
    "evidence",
]

LIST_FIELDS = {
    "dependsOn",
    "allowedPaths",
    "forbiddenActions",
    "closeCriteria",
    "requiredEvidence",
    "supersedes",
    "evidence",
}

STATUS_VOCABULARY = {
    "open",
    "ready-for-work",
    "in-progress",
    "blocked",
    "localized-handoff",
    "closed",
    "superseded",
}

RECORD_TYPE_STATUSES = {
    "opened": {"open"},
    "updated": {"open", "ready-for-work", "in-progress"},
    "blocked": {"blocked"},
    "localized-handoff": {"localized-handoff"},
    "closed": {"closed"},
    "superseded": {"superseded"},
}

REQUIRED_BY_STATUS = {
    "blocked": {"blocker"},
    "localized-handoff": {"handoff"},
    "closed": {"closure"},
}

FORBIDDEN_BY_STATUS = {
    "open": {"blocker", "handoff", "closure", "replacementIssueId"},
    "ready-for-work": {"blocker", "handoff", "closure", "replacementIssueId"},
    "in-progress": {"blocker", "handoff", "closure", "replacementIssueId"},
    "blocked": {"handoff", "closure", "replacementIssueId"},
    "localized-handoff": {"blocker", "closure", "replacementIssueId"},
    "closed": {"blocker", "handoff", "replacementIssueId"},
    "superseded": {"blocker", "handoff", "closure"},
}

ACTIVE_STATUSES = {"open", "ready-for-work", "in-progress", "blocked", "localized-handoff"}


def diagnostic(path: Path | str, line: int | None, code: str, message: str) -> dict[str, Any]:
    return {"path": str(path), "line": line, "code": code, "message": message}


def parse_recorded_at(raw: Any, path: Path, line: int) -> tuple[datetime | None, dict[str, Any] | None]:
    if not isinstance(raw, str) or not raw:
        return None, diagnostic(path, line, "invalid-recorded-at", "recordedAt must be a non-empty string")
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as exc:
        return None, diagnostic(path, line, "invalid-recorded-at", str(exc))
    if parsed.tzinfo is None:
        return None, diagnostic(path, line, "invalid-recorded-at", "recordedAt must include timezone")
    return parsed.astimezone(timezone.utc), None


def read_jsonl(path: str | Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    ledger_path = Path(path)
    diagnostics: list[dict[str, Any]] = []
    rows: list[dict[str, Any]] = []
    if not ledger_path.exists():
        return rows, [diagnostic(ledger_path, None, "missing-ledger", "ledger file does not exist")]
    for line_no, line in enumerate(ledger_path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            diagnostics.append(diagnostic(ledger_path, line_no, "invalid-json", str(exc)))
            continue
        if not isinstance(value, dict):
            diagnostics.append(diagnostic(ledger_path, line_no, "non-object-record", "JSONL row must be an object"))
            continue
        rows.append({"path": str(ledger_path), "line": line_no, "record": value})
    return rows, diagnostics


def validate_record_shape(row: dict[str, Any]) -> list[dict[str, Any]]:
    path = Path(row["path"])
    line = int(row["line"])
    record = row["record"]
    diagnostics: list[dict[str, Any]] = []
    if record.get("kind") != "issue.record.v1":
        return [diagnostic(path, line, "non-v1-issue-record", "issues/*.jsonl authority accepts only kind=issue.record.v1")]
    if record.get("schemaVersion") != "v1":
        diagnostics.append(diagnostic(path, line, "invalid-schema-version", "schemaVersion must be v1"))
    for field_name in REQUIRED_FIELDS:
        if field_name not in record:
            diagnostics.append(diagnostic(path, line, "missing-required-field", f"missing field: {field_name}"))
    for field_name in LIST_FIELDS:
        if field_name in record and not isinstance(record[field_name], list):
            diagnostics.append(diagnostic(path, line, "invalid-list-field", f"{field_name} must be a list"))
    status = record.get("status")
    record_type = record.get("recordType")
    if status not in STATUS_VOCABULARY:
        diagnostics.append(diagnostic(path, line, "invalid-status", f"invalid status: {status!r}"))
    if record_type not in RECORD_TYPE_STATUSES:
        diagnostics.append(diagnostic(path, line, "invalid-record-type", f"invalid recordType: {record_type!r}"))
    elif status not in RECORD_TYPE_STATUSES[record_type]:
        diagnostics.append(diagnostic(path, line, "record-type-status-mismatch", f"recordType {record_type!r} does not allow status {status!r}"))
    for field_name in REQUIRED_BY_STATUS.get(status, set()):
        if field_name not in record:
            diagnostics.append(diagnostic(path, line, "missing-status-field", f"status {status!r} requires {field_name}"))
    for field_name in FORBIDDEN_BY_STATUS.get(status, set()):
        if field_name in record:
            diagnostics.append(diagnostic(path, line, "forbidden-status-field", f"status {status!r} forbids {field_name}"))
    return diagnostics


def prepare_records(rows: Iterable[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    diagnostics: list[dict[str, Any]] = []
    records: list[dict[str, Any]] = []
    seen_record_ids: dict[str, dict[str, Any]] = {}
    seen_issue_times: dict[tuple[str, str], dict[str, Any]] = {}
    for row in rows:
        diagnostics.extend(validate_record_shape(row))
        record = row["record"]
        if record.get("kind") != "issue.record.v1":
            continue
        parsed, time_diag = parse_recorded_at(record.get("recordedAt"), Path(row["path"]), int(row["line"]))
        if time_diag is not None:
            diagnostics.append(time_diag)
            continue
        assert parsed is not None
        issue_id = record.get("issueId")
        record_id = record.get("recordId")
        if not isinstance(issue_id, str) or not issue_id:
            diagnostics.append(diagnostic(row["path"], row["line"], "invalid-issue-id", "issueId must be a non-empty string"))
            continue
        if not isinstance(record_id, str) or not record_id:
            diagnostics.append(diagnostic(row["path"], row["line"], "invalid-record-id", "recordId must be a non-empty string"))
            continue
        if record_id in seen_record_ids:
            first = seen_record_ids[record_id]
            diagnostics.append(diagnostic(row["path"], row["line"], "duplicate-record-id", f"duplicate recordId first seen at {first['path']}:{first['line']}"))
        seen_record_ids[record_id] = row
        time_key = (issue_id, parsed.isoformat())
        if time_key in seen_issue_times:
            first = seen_issue_times[time_key]
            diagnostics.append(diagnostic(row["path"], row["line"], "duplicate-issue-recorded-at", f"duplicate recordedAt for {issue_id} first seen at {first['path']}:{first['line']}"))
        seen_issue_times[time_key] = row
        records.append({**row, "recordId": record_id, "issueId": issue_id, "recordedAtParsed": parsed})
    return records, diagnostics


def reduce_latest(records: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    latest: dict[str, dict[str, Any]] = {}
    for row in sorted(records, key=lambda item: (item["recordedAtParsed"], item["recordId"])):
        latest[row["issueId"]] = row
    return latest


def validate_chain(records: list[dict[str, Any]]) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Validate hard chain contradictions and surface inherited chain gaps as warnings.

    The semantics profile is latest-state-first. Missing historical supersedes targets in
    older canonical ledgers are not hidden: they are emitted as warnings so the proposal
    does not claim full historical closure, while hard contradictions still fail.
    """
    diagnostics: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    by_record_id = {row["recordId"]: row for row in records}
    for row in records:
        record = row["record"]
        for previous_id in record.get("supersedes", []):
            previous = by_record_id.get(previous_id)
            if previous is None:
                warnings.append(diagnostic(row["path"], row["line"], "legacy-external-supersedes", f"supersedes target is not present in discovered ledgers: {previous_id}"))
                continue
            if previous["issueId"] != row["issueId"]:
                diagnostics.append(diagnostic(row["path"], row["line"], "cross-issue-supersedes", f"supersedes {previous_id} from different issue {previous['issueId']}"))
            if previous["recordedAtParsed"] >= row["recordedAtParsed"]:
                diagnostics.append(diagnostic(row["path"], row["line"], "non-monotonic-supersedes", "superseded record must be older than current record"))
    latest: dict[str, dict[str, Any]] = {}
    for row in sorted(records, key=lambda item: (item["recordedAtParsed"], item["recordId"])):
        prior = latest.get(row["issueId"])
        if prior is not None and prior["recordId"] not in row["record"].get("supersedes", []):
            warnings.append(diagnostic(row["path"], row["line"], "legacy-missing-latest-supersedes", f"temporal update for {row['issueId']} does not supersede current latest {prior['recordId']}"))
        latest[row["issueId"]] = row
    return latest, diagnostics, warnings


def validate_latest_state(latest: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    diagnostics: list[dict[str, Any]] = []
    active_branches: dict[tuple[str, str], dict[str, Any]] = {}
    for issue_id, row in latest.items():
        record = row["record"]
        status = record.get("status")
        if status == "closed":
            closure = record.get("closure", {})
            missing = set(record.get("closeCriteria", [])) - set(closure.get("satisfiedCloseCriteria", []))
            if missing:
                diagnostics.append(diagnostic(row["path"], row["line"], "closure-criteria-missing", f"closure does not satisfy criteria: {sorted(missing)}"))
        if status == "superseded" and not (record.get("replacementIssueId") or record.get("supersedes")):
            diagnostics.append(diagnostic(row["path"], row["line"], "superseded-missing-replacement", "superseded latest state needs replacementIssueId or supersedes"))
        if status in ACTIVE_STATUSES:
            key = (str(record.get("targetRepo", "")), str(record.get("suggestedBranch", "")))
            existing = active_branches.get(key)
            if existing is not None and existing["issueId"] != issue_id:
                diagnostics.append(diagnostic(row["path"], row["line"], "duplicate-active-branch", f"active branch {key[1]!r} in targetRepo {key[0]!r} also used by {existing['issueId']}"))
            active_branches[key] = row
    return diagnostics


def _empty_ledger_report(path: str | Path) -> dict[str, Any]:
    return {
        "path": str(path),
        "ok": True,
        "records": 0,
        "issues": 0,
        "latestRecords": {},
        "diagnostics": [],
        "warnings": [],
    }


def _reports_from_global(paths: list[str | Path], records: list[dict[str, Any]], latest: dict[str, dict[str, Any]], diagnostics: list[dict[str, Any]], warnings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    reports_by_path = {str(Path(path)): _empty_ledger_report(path) for path in paths}
    issue_ids_by_path: dict[str, set[str]] = {str(Path(path)): set() for path in paths}
    for row in records:
        path_key = str(Path(row["path"]))
        report = reports_by_path.setdefault(path_key, _empty_ledger_report(path_key))
        report["records"] += 1
        issue_ids_by_path.setdefault(path_key, set()).add(row["issueId"])
    for issue_id, row in latest.items():
        path_key = str(Path(row["path"]))
        report = reports_by_path.setdefault(path_key, _empty_ledger_report(path_key))
        report["latestRecords"][issue_id] = {
            "recordId": row["recordId"],
            "status": row["record"].get("status"),
            "recordedAt": row["record"].get("recordedAt"),
            "suggestedBranch": row["record"].get("suggestedBranch"),
        }
    for item in diagnostics:
        path_key = str(Path(item.get("path", "")))
        reports_by_path.setdefault(path_key, _empty_ledger_report(path_key))["diagnostics"].append(item)
    for item in warnings:
        path_key = str(Path(item.get("path", "")))
        reports_by_path.setdefault(path_key, _empty_ledger_report(path_key))["warnings"].append(item)
    for path_key, report in reports_by_path.items():
        report["issues"] = len(issue_ids_by_path.get(path_key, set()))
        report["ok"] = not report["diagnostics"]
    return [reports_by_path[str(Path(path))] for path in paths if str(Path(path)) in reports_by_path]


def _read_prepare(paths: list[str | Path]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    diagnostics: list[dict[str, Any]] = []
    rows: list[dict[str, Any]] = []
    for path in paths:
        path_rows, path_diagnostics = read_jsonl(path)
        rows.extend(path_rows)
        diagnostics.extend(path_diagnostics)
    records, record_diagnostics = prepare_records(rows)
    diagnostics.extend(record_diagnostics)
    return rows, records, diagnostics


def check_ledgers(paths: Iterable[str | Path]) -> dict[str, Any]:
    path_list = [Path(path) for path in paths]
    _, records, diagnostics = _read_prepare(path_list)
    latest, chain_diagnostics, warnings = validate_chain(records)
    diagnostics.extend(chain_diagnostics)
    diagnostics.extend(validate_latest_state(latest))
    reports = _reports_from_global(path_list, records, latest, diagnostics, warnings)
    ok = not diagnostics
    return {
        "kind": "ops.issueLedgerUnifiedKernel.report.v1",
        "ok": ok,
        "classification": "issue-ledger-unified-kernel-pass" if ok else "issue-ledger-unified-kernel-fail",
        "semanticsProfile": SEMANTICS_PROFILE,
        "checkedAuthorityPattern": AUTHORITY_PATTERN,
        "examplePocExampleIsAuthority": False,
        "ledgerCount": len(reports),
        "recordCount": len(records),
        "diagnosticCount": len(diagnostics),
        "warningCount": len(warnings),
        "legacyChainCompleteness": "warnings-present" if warnings else "complete-or-not-referenced",
        "reposWithoutIssueLedger": [],
        "ledgers": reports,
    }


def ledger_report(path: str | Path) -> dict[str, Any]:
    result = check_ledgers([path])
    if result["ledgers"]:
        return result["ledgers"][0]
    report = _empty_ledger_report(path)
    report["ok"] = result["ok"]
    return report


def is_repo_dir(path: Path) -> bool:
    return path.is_dir() and any((path / marker).exists() for marker in ["README.md", "flake.nix", "spec", "records", "packages"])


def discover_repo_dirs(workspace: str | Path) -> list[Path]:
    root = Path(workspace)
    if (root / "issues").exists():
        return [root]
    return sorted([child for child in root.iterdir() if is_repo_dir(child)], key=lambda p: p.name)


def discover_ledgers(workspace: str | Path) -> tuple[list[Path], list[str]]:
    ledgers: list[Path] = []
    missing: list[str] = []
    for repo in discover_repo_dirs(workspace):
        repo_ledgers = sorted((repo / "issues").glob("*.jsonl")) if (repo / "issues").exists() else []
        if repo_ledgers:
            ledgers.extend(repo_ledgers)
        else:
            missing.append(repo.name)
    return ledgers, missing


def audit_workspace(workspace: str | Path, require_ledger: bool = False) -> dict[str, Any]:
    ledgers, missing = discover_ledgers(workspace)
    result = check_ledgers(ledgers)
    result["workspace"] = str(workspace)
    result["reposWithoutIssueLedger"] = missing
    if require_ledger and missing:
        result["ok"] = False
        result["classification"] = "issue-ledger-unified-kernel-fail"
        missing_diags = [diagnostic(Path(workspace) / repo, None, "missing-repo-ledger", "strict workspace audit requires issues/*.jsonl") for repo in missing]
        result["diagnosticCount"] += len(missing_diags)
        for repo, item in zip(missing, missing_diags):
            result["ledgers"].append({
                "path": str(Path(workspace) / repo / AUTHORITY_PATTERN),
                "ok": False,
                "records": 0,
                "issues": 0,
                "latestRecords": {},
                "diagnostics": [item],
                "warnings": [],
            })
    return result
