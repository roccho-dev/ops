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


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="/home/nixos/repos", help="repo parent root to check")
    parser.add_argument("--json", action="store_true", help="print JSON report")
    args = parser.parse_args(argv)

    report = run(pathlib.Path(args.root))
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print("ops-runbook-checks:", report["classification"])
        for failure in report["failures"]:
            print(f"- {failure}")
        if report["ok"]:
            print("- live proof remains not-proven by this static check")
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
