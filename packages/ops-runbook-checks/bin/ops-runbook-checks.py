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
    "specs/packages/ops-thread-fsm/default.nix",
    "ops/flake.nix",
    "ops/packages/ops-thread-fsm/default.nix",
    "ops/packages/ops-thread-fsm/bin/ops-thread-fsm",
    "ops/packages/ops-tailnet-github-egress",
    "specs/packages/ops-tailnet-github-egress/default.nix",
    "ops/packages/ops-refs-vault",
    "specs/packages/ops-refs-vault/default.nix",
    "ops/packages/ops-refs-vault/docs/knowledge-map.md",
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
    "$HOME/.agents/events.jsonl",
    "$HOME/.agents/status.md",
    "ops-agent-events",
    "ops-artifact-materialize",
    "ops-knowledge-intake",
    "ops-runbook-checks",
    "ops-thread-fsm",
    "delivery-verified",
    "impl-review",
    "merge-review",
    "merge-ready",
    "ops-tailnet-github-egress",
    "ops-refs-vault",
    "route-gated local push",
    "long-transfer",
    "github.com",
    "tag:github",
    "status.md は生成物",
]

FORBIDDEN_AGENTS_TOKENS = [
    "app-connector-push-test-20260507T191701Z",
    "app-connector-mtu-probing-push-20260507T221847Z",
    "single-remote-restore-proof-20260507T234133Z",
    "specs-local-layout-restore-proof-20260508T010136Z",
    "refs-vault-real-repo-shelter-20260508T042439Z",
    "refs-vault-ux-restore-proof-20260508T041421Z",
]

REQUIRED_FILE_TOKENS = [
    {
        "relPath": "ops/flake.nix",
        "tokens": [
            "ops-thread-fsm",
            "ops-thread-fsm-check",
            "writeShellApplication",
            "runCommand \"ops-thread-fsm-check\"",
            "self.packages.${pkgs.stdenv.hostPlatform.system}.ops-thread-fsm",
            "ops-tailnet-github-egress",
            "ops-tailnet-github-egress-check",
            "ops-refs-vault",
            "ops-refs-vault-check",
        ],
    },
]


def check_path(root: pathlib.Path, rel: str, required: bool) -> dict[str, Any]:
    path = root / rel
    return {
        "relPath": rel,
        "exists": path.exists(),
        "required": required,
        "kind": "directory" if path.is_dir() else "file" if path.is_file() else "missing",
    }


def check_agents(root: pathlib.Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    path = root / "AGENTS.md"
    text = path.read_text(encoding="utf-8") if path.exists() else ""
    required = [
        {
            "token": token,
            "present": token in text,
            "required": True,
        }
        for token in REQUIRED_AGENTS_TOKENS
    ]
    forbidden = [
        {
            "token": token,
            "present": token in text,
            "requiredAbsent": True,
        }
        for token in FORBIDDEN_AGENTS_TOKENS
    ]
    return required, forbidden


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
    paths = [check_path(root, rel, True) for rel in REQUIRED_PATHS]
    paths.extend(check_path(root, rel, False) for rel in OPTIONAL_PACKAGE_PATHS)
    agents, forbidden_agents = check_agents(root)
    file_tokens = check_file_tokens(root)
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
    failures.extend(
        f"{row['relPath']} missing required token: {row['token']}"
        for row in file_tokens
        if row["required"] and not row["present"]
    )
    failures.extend(
        f"AGENTS.md embeds raw proof token instead of remaining an entrypoint: {row['token']}"
        for row in forbidden_agents
        if row["present"]
    )
    return {
        "kind": "ops.runbookChecks.report.v1",
        "root": str(root),
        "ok": not failures,
        "failures": failures,
        "paths": paths,
        "agentsTokens": agents,
        "forbiddenAgentsTokens": forbidden_agents,
        "fileTokens": file_tokens,
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
