from __future__ import annotations

import argparse
import json

from .core import audit_workspace, check_ledgers, ledger_report


def emit(result: dict, as_json: bool) -> int:
    if as_json:
        print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    else:
        status = "PASS" if result.get("ok") else "FAIL"
        print(f"{status} {result.get('semanticsProfile')} ledgers={result.get('ledgerCount', 0)}")
        for ledger in result.get("ledgers", []):
            print(f"- {ledger.get('path')}: {'ok' if ledger.get('ok') else 'fail'} records={ledger.get('records')} diagnostics={len(ledger.get('diagnostics', []))}")
            for item in ledger.get("diagnostics", []):
                line = "" if item.get("line") is None else f":{item['line']}"
                print(f"  {item.get('path')}{line}: {item.get('code')}: {item.get('message')}")
        missing = result.get("reposWithoutIssueLedger") or []
        if missing:
            print(f"repos without issue ledger: {', '.join(missing)}")
    return 0 if result.get("ok") else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="issue-ledger")
    sub = parser.add_subparsers(dest="command", required=True)

    check = sub.add_parser("check", help="check explicit issue ledger JSONL files")
    check.add_argument("ledgers", nargs="*", help="issues/*.jsonl files")
    check.add_argument("--ledger", action="append", default=[], help="issues/*.jsonl file; repeatable compatibility option")
    check.add_argument("--json", action="store_true")

    repo = sub.add_parser("check-repo", help="check a repo's issues/*.jsonl ledgers")
    repo.add_argument("repo")
    repo.add_argument("--json", action="store_true")
    repo.add_argument("--require-ledger", action="store_true")

    audit = sub.add_parser("audit-workspace", help="discover and check repo issues/*.jsonl ledgers")
    audit.add_argument("workspace", nargs="?", default=None)
    audit.add_argument("--workspace", dest="workspace_opt")
    audit.add_argument("--require-ledger", action="store_true")
    audit.add_argument("--json", action="store_true")

    latest = sub.add_parser("latest", help="print latest issue states for explicit ledgers")
    latest.add_argument("ledgers", nargs="+")
    latest.add_argument("--json", action="store_true")

    args = parser.parse_args(argv)
    if args.command == "check":
        paths = [*args.ledger, *args.ledgers]
        if not paths:
            parser.error("check requires at least one ledger path")
        return emit(check_ledgers(paths), args.json)
    if args.command == "check-repo":
        from pathlib import Path
        paths = sorted((Path(args.repo) / "issues").glob("*.jsonl")) if (Path(args.repo) / "issues").exists() else []
        if args.require_ledger and not paths:
            result = audit_workspace(Path(args.repo).parent, require_ledger=True)
            return emit(result, args.json)
        return emit(check_ledgers(paths), args.json)
    if args.command == "audit-workspace":
        workspace = args.workspace_opt or args.workspace
        if not workspace:
            parser.error("audit-workspace requires workspace path")
        return emit(audit_workspace(workspace, require_ledger=args.require_ledger), args.json)
    if args.command == "latest":
        reports = [ledger_report(path) for path in args.ledgers]
        result = {
            "kind": "ops.issueLedgerUnifiedKernel.latest.v1",
            "ok": all(report["ok"] for report in reports),
            "semanticsProfile": "canonical-latest-state-v1",
            "ledgers": reports,
        }
        return emit(result, args.json)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
