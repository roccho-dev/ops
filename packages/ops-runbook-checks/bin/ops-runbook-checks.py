#!/usr/bin/env python3
"""Static ops runbook checks that cannot claim live success.

This guardrail intentionally proves only a minimum static gate. It does not
contact ChatGPT, GitHub, Tailscale, or a browser. A pass means the router,
schemas, package entrypoints, and "not-proven" boundaries are discoverable.
Live Project Source readback, artifact receipt, review, merge, push, and
complete-approved require separate evidence records.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
from datetime import datetime, timezone
from glob import glob
from typing import Any


REQUIRED_STATIC_PATHS = [
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
]

OPTIONAL_LEGACY_PATHS = [
    "cdp-ops-poc",
    "ops/packages/ops-artifact-materialize",
    "ops/packages/ops-knowledge-intake",
]

FORBIDDEN_AGENTS_MD_TOKENS = [
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
]

REQUIRED_FILE_TOKENS = [
    {
        "relPath": "AGENTS.md",
        "tokens": [
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
        "relPath": ".agents/transport.md",
        "tokens": [
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
        "relPath": ".agents/project-workspace.md",
        "tokens": [
            "Project Source-only input rule",
            "worker-readable proof",
            "REQUEST.md",
            "role.chatgpt.thread",
            "threadFunction",
        ],
    },
    {
        "relPath": ".agents/claim-stream.md",
        "tokens": [
            "claim.completion.v1",
            "policyReadSnapshot",
            "claim はどれだけ詳細でも command",
        ],
    },
    {
        "relPath": ".agents/specs-package-work.md",
        "tokens": [
            "spec.output.package = feat.input.package",
            "package/package.json",
            "implementation-ready",
            "specs-contract-completion",
        ],
    },
    {
        "relPath": ".agents/package-entrypoints.md",
        "tokens": [
            "ops-cdp-core",
            "ops-thread-fsm",
            "ops-tailnet-github-egress",
            "ops-refs-vault",
        ],
    },
    {
        "relPath": "ops/flake.nix",
        "tokens": [
            "ops-runbook-checks",
            "ops-cdp-core",
            "ops-thread-fsm",
            "ops-tailnet-github-egress",
            "ops-refs-vault",
            "checks =",
        ],
    },
]

LIVE_PROOF_STATUSES = [
    {
        "capability": "chatgpt.projectSource.uploadReadback",
        "status": "not-proven-by-static-check",
        "requiredEvidence": [
            "upload result",
            "Project Sources list/readback with expected filename",
            "new thread proof-token readback",
            "proof token absent from prompt body",
        ],
    },
    {
        "capability": "chatgpt.artifact.receipt",
        "status": "not-proven-by-static-check",
        "requiredEvidence": [
            "artifact file",
            "sha256",
            "materialization manifest",
            "readback or gate log",
        ],
    },
    {
        "capability": "review.impl.pass",
        "status": "not-proven-by-static-check",
        "requiredEvidence": [
            "review artifact",
            "target candidate hash",
            "explicit impl-review verdict",
            "review criteria satisfied",
        ],
    },
    {
        "capability": "review.merge.pass",
        "status": "not-proven-by-static-check",
        "requiredEvidence": [
            "merge-review artifact",
            "base and candidate hashes",
            "explicit merge-review verdict",
            "merge-review criteria satisfied",
        ],
    },
    {
        "capability": "tailnet.github.egressPush",
        "status": "not-proven-by-static-check",
        "requiredEvidence": [
            "route-gated push command",
            "selected github.com route evidence",
            "remote head readback",
        ],
    },
    {
        "capability": "authority.completeApproved",
        "status": "not-proven-by-static-check",
        "requiredEvidence": [
            "completion claim",
            "parent approval record",
            "accepted event with complete-approved",
            "evidence matching approved criteria",
        ],
    },
]

REQUIRED_ISSUE_RECORD_FIELDS = [
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

ISSUE_RECORD_TYPE_STATUSES = {
    "opened": {"open"},
    "updated": {"open", "ready-for-work", "in-progress"},
    "blocked": {"blocked"},
    "localized-handoff": {"localized-handoff"},
    "closed": {"closed"},
    "superseded": {"superseded"},
}

ISSUE_REQUIRED_BY_STATUS = {
    "blocked": {"blocker"},
    "localized-handoff": {"handoff"},
    "closed": {"closure"},
}

ISSUE_FORBIDDEN_BY_STATUS = {
    "open": {"blocker", "handoff", "closure", "replacementIssueId"},
    "ready-for-work": {"blocker", "handoff", "closure", "replacementIssueId"},
    "in-progress": {"blocker", "handoff", "closure", "replacementIssueId"},
    "blocked": {"handoff", "closure", "replacementIssueId"},
    "localized-handoff": {"blocker", "closure", "replacementIssueId"},
    "closed": {"blocker", "handoff", "replacementIssueId"},
    "superseded": {"blocker", "handoff", "closure"},
}

ISSUE_ACTIVE_STATUSES = {"open", "ready-for-work", "in-progress", "blocked", "localized-handoff"}


def check_path(root: pathlib.Path, rel: str, required: bool) -> dict[str, Any]:
    path = root / rel
    return {
        "relPath": rel,
        "exists": path.exists(),
        "required": required,
        "kind": "directory" if path.is_dir() else "file" if path.is_file() else "missing",
    }


def check_forbidden_agents(root: pathlib.Path) -> list[dict[str, Any]]:
    path = root / "AGENTS.md"
    text = path.read_text(encoding="utf-8") if path.exists() else ""
    return [
        {
            "token": token,
            "present": token in text,
            "requiredAbsent": True,
        }
        for token in FORBIDDEN_AGENTS_MD_TOKENS
    ]


def check_file_tokens(root: pathlib.Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for spec in REQUIRED_FILE_TOKENS:
        rel = spec["relPath"]
        path = root / rel
        text = path.read_text(encoding="utf-8") if path.exists() else ""
        for token in spec["tokens"]:
            rows.append(
                {
                    "relPath": rel,
                    "token": token,
                    "present": token in text,
                    "required": True,
                }
            )
    return rows


def run(root: pathlib.Path) -> dict[str, Any]:
    paths = [check_path(root, rel, True) for rel in REQUIRED_STATIC_PATHS]
    paths.extend(check_path(root, rel, False) for rel in OPTIONAL_LEGACY_PATHS)
    forbidden_agents = check_forbidden_agents(root)
    file_tokens = check_file_tokens(root)
    failures = [
        f"missing required path: {row['relPath']}"
        for row in paths
        if row["required"] and not row["exists"]
    ]
    failures.extend(
        f"{row['relPath']} missing required token: {row['token']}"
        for row in file_tokens
        if row["required"] and not row["present"]
    )
    failures.extend(
        f"AGENTS.md still contains legacy or raw-success token: {row['token']}"
        for row in forbidden_agents
        if row["present"]
    )
    ok = not failures
    return {
        "kind": "ops.runbookChecks.report.v2",
        "classification": "minimum-static-gate-pass" if ok else "minimum-static-gate-fail",
        "root": str(root),
        "ok": ok,
        "scope": "static-only",
        "doesNotProve": [
            "ChatGPT Project Source upload/readback",
            "ChatGPT artifact receipt",
            "review pass",
            "merge-review pass",
            "tailnet GitHub push",
            "complete-approved",
        ],
        "failures": failures,
        "paths": paths,
        "liveProofs": LIVE_PROOF_STATUSES,
        "forbiddenAgentsTokens": forbidden_agents,
        "fileTokens": file_tokens,
    }


def parse_issue_time(raw: str) -> datetime:
    parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("recordedAt must include timezone")
    return parsed.astimezone(timezone.utc)


def read_jsonl(path: pathlib.Path) -> tuple[list[dict[str, Any]], list[str]]:
    rows: list[dict[str, Any]] = []
    failures: list[str] = []
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            failures.append(f"{path}:{line_no}: invalid JSON: {exc}")
            continue
        if not isinstance(value, dict):
            failures.append(f"{path}:{line_no}: JSONL row must be an object")
            continue
        rows.append({"path": str(path), "lineNo": line_no, "record": value})
    return rows, failures


def legacy_report(paths: list[pathlib.Path], current_paths: set[pathlib.Path]) -> list[dict[str, Any]]:
    reports: list[dict[str, Any]] = []
    for path in paths:
        resolved = path.resolve()
        if resolved in current_paths:
            continue
        rows, failures = read_jsonl(path)
        v1_count = 0
        legacy_count = 0
        for row in rows:
            record = row["record"]
            if record.get("kind") == "issue.record.v1" and record.get("schemaVersion") == "v1":
                v1_count += 1
            else:
                legacy_count += 1
        reports.append(
            {
                "path": str(path),
                "records": len(rows),
                "v1Records": v1_count,
                "legacyOrNonV1Records": legacy_count,
                "parseFailures": failures,
                "classification": "current-v1" if v1_count and not legacy_count else "legacy-or-mixed",
                "validationAffectsCurrentV1": False,
            }
        )
    return reports


def validate_issue_ledger(paths: list[pathlib.Path]) -> dict[str, Any]:
    failures: list[str] = []
    entries: list[dict[str, Any]] = []
    record_ids: dict[str, dict[str, Any]] = {}
    issue_times: dict[tuple[str, str], dict[str, Any]] = {}

    for path in paths:
        if not path.exists():
            failures.append(f"missing issue ledger: {path}")
            continue
        rows, read_failures = read_jsonl(path)
        failures.extend(read_failures)
        for row in rows:
            record = row["record"]
            missing = [field for field in REQUIRED_ISSUE_RECORD_FIELDS if field not in record]
            if missing:
                failures.append(f"{row['path']}:{row['lineNo']}: missing required fields: {missing}")
                continue
            if record["kind"] != "issue.record.v1" or record["schemaVersion"] != "v1":
                failures.append(f"{row['path']}:{row['lineNo']}: current ledger row is not issue.record.v1")
                continue
            try:
                recorded_at = parse_issue_time(str(record["recordedAt"]))
            except ValueError as exc:
                failures.append(f"{row['path']}:{row['lineNo']}: invalid recordedAt: {exc}")
                continue

            record_id = str(record["recordId"])
            if record_id in record_ids:
                failures.append(f"duplicate recordId: {record_id}")
                continue
            issue_id = str(record["issueId"])
            time_key = (issue_id, recorded_at.isoformat())
            if time_key in issue_times:
                prior = issue_times[time_key]
                failures.append(
                    f"{row['path']}:{row['lineNo']}: duplicate recordedAt for {issue_id}; "
                    f"also {prior['path']}:{prior['lineNo']}"
                )
                continue

            entry = {
                **row,
                "recordId": record_id,
                "issueId": issue_id,
                "recordedAt": recorded_at,
            }
            record_ids[record_id] = entry
            issue_times[time_key] = row
            entries.append(entry)

    for entry in entries:
        record = entry["record"]
        prefix = f"{entry['path']}:{entry['lineNo']}"
        record_type = record["recordType"]
        status = record["status"]
        if record_type not in ISSUE_RECORD_TYPE_STATUSES:
            failures.append(f"{prefix}: unknown recordType {record_type}")
            continue
        if status not in ISSUE_RECORD_TYPE_STATUSES[record_type]:
            failures.append(f"{prefix}: recordType {record_type} cannot carry status {status}")
        for field in ISSUE_REQUIRED_BY_STATUS.get(status, set()):
            if field not in record:
                failures.append(f"{prefix}: status {status} requires {field}")
        for field in ISSUE_FORBIDDEN_BY_STATUS.get(status, set()):
            if field in record:
                failures.append(f"{prefix}: status {status} must not carry {field}")
        for field in ["dependsOn", "allowedPaths", "forbiddenActions", "closeCriteria", "requiredEvidence", "supersedes", "evidence"]:
            if not isinstance(record[field], list):
                failures.append(f"{prefix}: {field} must be an array")
        if status == "blocked":
            blocker = record.get("blocker", {})
            for field in ["requiredOwner", "requiredResolution", "forbiddenUntilResolved"]:
                if field not in blocker:
                    failures.append(f"{prefix}: blocked record missing blocker.{field}")
        if status == "closed":
            closure = record.get("closure", {})
            for field in ["closedAt", "satisfiedCloseCriteria", "evidence"]:
                if field not in closure:
                    failures.append(f"{prefix}: closed record missing closure.{field}")
            missing_criteria = set(record["closeCriteria"]) - set(closure.get("satisfiedCloseCriteria", []))
            if missing_criteria:
                failures.append(f"{prefix}: closure does not satisfy criteria: {sorted(missing_criteria)}")
        for superseded_id in record["supersedes"]:
            previous = record_ids.get(superseded_id)
            if not previous:
                failures.append(f"{prefix}: supersedes unknown recordId {superseded_id}")
                continue
            if previous["issueId"] != entry["issueId"]:
                failures.append(f"{prefix}: supersedes {superseded_id} from different issue {previous['issueId']}")
            if previous["recordedAt"] >= entry["recordedAt"]:
                failures.append(f"{prefix}: superseded record must be older than current record")

    latest: dict[str, dict[str, Any]] = {}
    for entry in sorted(entries, key=lambda row: (row["recordedAt"], row["recordId"])):
        prior = latest.get(entry["issueId"])
        if prior and prior["recordId"] not in entry["record"]["supersedes"]:
            failures.append(
                f"{entry['path']}:{entry['lineNo']}: temporal update for {entry['issueId']} "
                f"must supersede current latest {prior['recordId']}"
            )
        latest[entry["issueId"]] = entry

    branch_to_issue: dict[tuple[str, str], str] = {}
    for issue_id, entry in latest.items():
        record = entry["record"]
        status = record["status"]
        if status in ISSUE_ACTIVE_STATUSES:
            branch = (record["targetRepo"], record["suggestedBranch"])
            other = branch_to_issue.get(branch)
            if other and other != issue_id:
                failures.append(
                    f"active issues share suggestedBranch {branch[1]} in targetRepo {branch[0]}: {other}, {issue_id}"
                )
            branch_to_issue[branch] = issue_id

    return {
        "ok": not failures,
        "failures": failures,
        "recordCount": len(entries),
        "latestStates": {
            issue_id: {
                "recordId": entry["recordId"],
                "status": entry["record"]["status"],
                "recordedAt": entry["record"]["recordedAt"],
                "suggestedBranch": entry["record"]["suggestedBranch"],
            }
            for issue_id, entry in sorted(latest.items())
        },
        "checks": [
            "required v1 fields",
            "recordType/status consistency",
            "timezone-aware recordedAt",
            "recordId uniqueness",
            "issue recordedAt uniqueness",
            "supersedes existence and issue match",
            "latest state selected by recordedAt plus supersedes",
            "blocked records carry blocker fields",
            "closed records carry closure fields and all criteria",
            "active targetRepo/suggestedBranch uniqueness",
        ],
    }


def run_issue_ledger(issue_ledgers: list[str], legacy_globs: list[str]) -> dict[str, Any]:
    current_paths = [pathlib.Path(raw) for raw in issue_ledgers]
    current_resolved = {path.resolve() for path in current_paths}
    legacy_paths = sorted({pathlib.Path(found) for pattern in legacy_globs for found in glob(pattern)})
    validation = validate_issue_ledger(current_paths)
    legacy_reports = legacy_report(legacy_paths, current_resolved)
    return {
        "kind": "ops.issueLedgerFsck.report.v1",
        "classification": "issue-ledger-fsck-pass" if validation["ok"] else "issue-ledger-fsck-fail",
        "ok": validation["ok"],
        "currentLedgers": [str(path) for path in current_paths],
        "legacyScope": legacy_globs,
        "currentValidation": validation,
        "legacyReports": legacy_reports,
        "doesNotProve": [
            "semantic issue closure approval",
            "impl-review-pass",
            "merge-review-pass",
            "canonical merge",
            "remote push",
            "complete-approved",
        ],
    }


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="/home/nixos/repos", help="repo parent root to check")
    parser.add_argument("--issue-ledger", action="append", default=[], help="current v1 issue ledger JSONL to fsck")
    parser.add_argument("--legacy-glob", action="append", default=[], help="glob of legacy or mixed issue ledgers to report")
    parser.add_argument("--json", action="store_true", help="print JSON report")
    args = parser.parse_args(argv)

    report = run_issue_ledger(args.issue_ledger, args.legacy_glob) if args.issue_ledger else run(pathlib.Path(args.root))
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print("ops-runbook-checks:", report["classification"])
        failures = report.get("failures") or report.get("currentValidation", {}).get("failures", [])
        for failure in failures:
            print(f"- {failure}")
        if report["ok"] and not args.issue_ledger:
            print("- live proof remains not-proven by this static check")
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
