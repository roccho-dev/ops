#!/usr/bin/env python3
"""Validate the small ops runbook navigation surface.

This checker is deliberately narrow.  It reports whether a fresh gen0 can find
the reusable packages, FSM gates, and flake wiring.  It does not implement CDP,
artifact materialization, push, merge, refs-vault, or thread-FSM behavior.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys
from typing import Any

PACKAGE_ANCHORS = [
    "ops-thread-fsm",
    "ops-runbook-checks",
    "ops-artifact-materialize",
    "ops-tailnet-github-egress",
    "ops-refs-vault",
]
FSM_TOKENS = [
    "delivery-verified",
    "impl-review",
    "impl-review-pass",
    "merge executor",
    "merge-candidate-ready",
    "ready-for-merge-review",
    "localizer",
    "localized-local-gate-pass",
    "remote-backup-verified",
    "role-override",
    "post-hoc-merge-review-required",
    "merge-review",
    "merge-review-pass",
    "merge-ready",
    "plan-accepted",
    "false-blocker",
    "insufficient-plan",
    "escalation-needed",
]
ENTRYPOINT_TOKENS = ["AGENTS.md", "packages", "status.md", "events.jsonl"]
FORBIDDEN_MECHANICS = ["BEGIN_B64_FILE", "MATERIALIZE_MANIFEST", "diff --git"]

def read(root: pathlib.Path, rel: str) -> str:
    path = root / rel
    return path.read_text(encoding="utf-8") if path.exists() else ""

def token_rows(where: str, text: str, tokens: list[str]) -> list[dict[str, Any]]:
    return [{"where": where, "token": token, "present": token in text, "required": True} for token in tokens]

def path_rows(root: pathlib.Path) -> list[dict[str, Any]]:
    rows = []
    for rel in ["AGENTS.md", "ops/flake.nix"]:
        path = root / rel
        rows.append({"relPath": rel, "exists": path.exists(), "required": True})
    return rows

def agents_is_small_entrypoint(text: str) -> tuple[bool, list[str]]:
    failures: list[str] = []
    lines = [line for line in text.splitlines() if line.strip()]
    if len(lines) > 80:
        failures.append("AGENTS.md is too long for a small entrypoint")
    for marker in FORBIDDEN_MECHANICS:
        if marker in text:
            failures.append(f"AGENTS.md appears to contain raw evidence/artifact marker: {marker}")
    for token in ENTRYPOINT_TOKENS:
        if token not in text:
            failures.append(f"AGENTS.md missing entrypoint token: {token}")
    return not failures, failures

def flake_rows(text: str) -> list[dict[str, Any]]:
    tokens = [
        "ops-thread-fsm",
        "ops-runbook-checks",
        "ops-thread-fsm-check",
        "ops-runbook-checks-check",
        "writeShellApplication",
        "runCommand",
    ]
    return token_rows("ops/flake.nix", text, tokens)

def run(root: pathlib.Path) -> dict[str, Any]:
    agents = read(root, "AGENTS.md")
    flake = read(root, "ops/flake.nix")

    rows = path_rows(root)
    agent_tokens = token_rows("AGENTS.md", agents, PACKAGE_ANCHORS + FSM_TOKENS)
    flake_tokens = flake_rows(flake)
    small_ok, small_failures = agents_is_small_entrypoint(agents)

    failures = [f"missing required path: {r['relPath']}" for r in rows if r["required"] and not r["exists"]]
    failures.extend(f"{r['where']} missing required token: {r['token']}" for r in agent_tokens + flake_tokens if r["required"] and not r["present"])
    failures.extend(small_failures)

    explicit_review_ok = all(token in agents for token in ["impl-review-pass", "merge-review-pass"])
    if "review-pass" in agents and not explicit_review_ok:
        failures.append("generic review-pass is present without explicit gate pass tokens")

    return {
        "kind": "ops.runbookChecks.report.v2",
        "root": str(root),
        "ok": not failures,
        "failures": failures,
        "paths": rows,
        "agentsSmallEntrypoint": small_ok,
        "agentsTokens": agent_tokens,
        "fileTokens": flake_tokens,
        "forbiddenResponsibility": "navigation checks only; no CDP/materializer/push/merge/refs-vault/FSM implementation",
    }

def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="/home/nixos/repos")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    report = run(pathlib.Path(args.root))
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print("ops-runbook-checks:", "pass" if report["ok"] else "fail")
        for failure in report["failures"]:
            print(f"- {failure}")
    return 0 if report["ok"] else 1

if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
