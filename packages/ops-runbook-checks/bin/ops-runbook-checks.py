#!/usr/bin/env python3
"""Check that a local ops runbook has the minimum navigation anchors.

This is a guardrail, not a documentation generator. It verifies that a fresh
gen0 can start from AGENTS.md, find status, and discover the reusable ops/specs
packages instead of depending on memory.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
from typing import Any


REQUIRED_PATHS = [
    "AGENTS.md",
    "specs/packages/ops-agent-events/default.nix",
    "specs/packages/ops-cdp-core/default.nix",
    "specs/packages/ops-project-source-sync/default.nix",
    "ops/flake.nix",
    "cdp-ops-poc",
]

OPTIONAL_PACKAGE_PATHS = [
    "ops/packages/ops-artifact-materialize",
    "ops/packages/ops-knowledge-intake",
    "ops/packages/ops-runbook-checks",
]

REQUIRED_AGENTS_TOKENS = [
    "0/9",
    "CDP",
    "Project Source",
    "$HOME/.agents/status.md",
]


def check_path(root: pathlib.Path, rel: str, required: bool) -> dict[str, Any]:
    path = root / rel
    return {
        "relPath": rel,
        "exists": path.exists(),
        "required": required,
        "kind": "directory" if path.is_dir() else "file" if path.is_file() else "missing",
    }


def check_agents(root: pathlib.Path) -> list[dict[str, Any]]:
    path = root / "AGENTS.md"
    text = path.read_text(encoding="utf-8") if path.exists() else ""
    return [
        {
            "token": token,
            "present": token in text,
            "required": True,
        }
        for token in REQUIRED_AGENTS_TOKENS
    ]


def run(root: pathlib.Path) -> dict[str, Any]:
    paths = [check_path(root, rel, True) for rel in REQUIRED_PATHS]
    paths.extend(check_path(root, rel, False) for rel in OPTIONAL_PACKAGE_PATHS)
    agents = check_agents(root)
    failures = [
        f"missing required path: {row['relPath']}"
        for row in paths
        if row["required"] and not row["exists"]
    ]
    failures.extend(
        f"AGENTS.md missing required token: {row['token']}"
        for row in agents
        if row["required"] and not row["present"]
    )
    return {
        "kind": "ops.runbookChecks.report.v1",
        "root": str(root),
        "ok": not failures,
        "failures": failures,
        "paths": paths,
        "agentsTokens": agents,
    }


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="/home/nixos/repos", help="repo parent root to check")
    parser.add_argument("--json", action="store_true", help="print JSON report")
    args = parser.parse_args(argv)

    report = run(pathlib.Path(args.root))
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print("ops-runbook-checks:", "pass" if report["ok"] else "fail")
        for failure in report["failures"]:
            print(f"- {failure}")
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
