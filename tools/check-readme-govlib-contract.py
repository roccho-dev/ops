#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
README = ROOT / "README.md"
MANIFEST = ROOT / "repo-convention.intent.v1.json"
CI_INTENT = ROOT / "ci.intent.v1.jsonl"

REQUIRED_TEXT = [
    "README.md is a checked artifact",
    "README.md is not an independent authority",
    "accepted decisions remain outside this README and outside GitHub provider workflows",
    "GitHub provider workflows are declared by `ci.intent.v1.jsonl`",
    "governance owns reusable convention check implementation, not this repo's policy acceptance",
]


def finding(code: str, message: str, **extra: object) -> dict[str, object]:
    row: dict[str, object] = {"code": code, "message": message}
    row.update(extra)
    return row


def main() -> int:
    findings: list[dict[str, object]] = []

    if not README.exists():
        findings.append(finding("readme-missing", "README.md is missing"))
        text = ""
    else:
        text = README.read_text(encoding="utf-8")

    for required in REQUIRED_TEXT:
        if required not in text:
            findings.append(finding("readme-govlib-contract-text-missing", "README gov-lib contract text is missing", text=required))

    if not MANIFEST.exists():
        findings.append(finding("repo-convention-manifest-missing", "repo-convention.intent.v1.json is missing"))
    else:
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        if manifest.get("repo") != "ops":
            findings.append(finding("repo-invalid", "manifest repo must be ops", value=manifest.get("repo")))
        if manifest.get("readme_mode") != "checked_handwritten":
            findings.append(finding("readme-mode-invalid", "ops README must stay checked_handwritten until artifact adoption", value=manifest.get("readme_mode")))
        if manifest.get("severity") != "blocking":
            findings.append(finding("severity-invalid", "ops repo convention severity must remain blocking", value=manifest.get("severity")))

    if not CI_INTENT.exists():
        findings.append(finding("ci-intent-missing", "ci.intent.v1.jsonl is missing"))

    report = {
        "kind": "ops.readmeGovlibContractCheck.v1",
        "status": "fail" if findings else "pass",
        "authority": False,
        "findings": findings,
    }
    print(json.dumps(report, indent=2, sort_keys=True))
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
