#!/usr/bin/env python3
"""Static behavior tests for ops-handoff-core."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def run(cmd: list[str], *, expect: int = 0) -> subprocess.CompletedProcess[str]:
    proc = subprocess.run(cmd, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != expect:
        raise AssertionError(
            f"unexpected exit {proc.returncode}, expected {expect}: {' '.join(cmd)}\n"
            f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
        )
    return proc


def main(argv: list[str]) -> int:
    package_dir = Path(argv[0]).resolve()
    out_root = Path(argv[1]).resolve()
    bin_path = package_dir / "bin" / "ops-handoff-core.py"
    fixtures = package_dir / "tests" / "fixtures"
    handoff = out_root / "handoff"
    out_root.mkdir(parents=True, exist_ok=True)

    generate = run([
        sys.executable,
        str(bin_path),
        "generate",
        "--role-catalog",
        str(fixtures / "role-catalog.md"),
        "--topology",
        str(fixtures / "organization-topology.a2ui.jsonl"),
        "--command-board",
        str(fixtures / "command-board.a2ui.jsonl"),
        "--request",
        str(fixtures / "REQUEST.md"),
        "--source-manifest",
        str(fixtures / "source-manifest.json"),
        "--runtime-manifest",
        str(fixtures / "runtime-manifest.json"),
        "--merge-target",
        str(fixtures / "merge-target.json"),
        "--thread-roster",
        str(fixtures / "thread-roster.json"),
        "--out-dir",
        str(handoff),
        "--json",
    ])
    generated = json.loads(generate.stdout)
    assert generated["status"] == "handoff-generated"

    validate = run([
        sys.executable,
        str(bin_path),
        "validate",
        "--handoff-dir",
        str(handoff),
        "--no-role-body-sentinel",
        "FULL_ROLE_CATALOG_BODY_SENTINEL",
    ])
    valid = json.loads(validate.stdout)
    assert valid["status"] == "handoff-valid"

    manifest = json.loads((handoff / "HANDOFF_MANIFEST.json").read_text(encoding="utf-8"))
    assert manifest["handoffId"].startswith("handoff:")
    assert manifest["handoffId"] != "handoff:ops-handoff-core-proof"
    assert manifest["state"]["current"] == "handoff-created"
    assert manifest["state"]["terminal"] is False
    assert manifest["approvalBoundary"]["transportReadbackIsApproval"] is False
    assert manifest["approvalBoundary"]["semanticApproval"] is False
    assert manifest["approvalBoundary"]["completionApproval"] is False
    assert {row["threadFunction"] for row in manifest["threads"]} == {
        "impl-work",
        "impl-review",
        "merge-work",
        "merge-review",
    }

    thread_text = "\n".join(path.read_text(encoding="utf-8") for path in (handoff / "THREADS").glob("*/*.md"))
    assert "project-source-put" not in thread_text
    assert "project-thread-create" not in thread_text
    assert "project-artifact-fetch" not in thread_text
    assert "FULL_ROLE_CATALOG_BODY_SENTINEL" not in thread_text

    missing = run([
        sys.executable,
        str(bin_path),
        "generate",
        "--role-catalog",
        str(fixtures / "role-catalog.md"),
        "--topology",
        str(fixtures / "organization-topology.a2ui.jsonl"),
        "--command-board",
        str(fixtures / "command-board.a2ui.jsonl"),
        "--request",
        str(fixtures / "REQUEST.md"),
        "--source-manifest",
        str(fixtures / "source-manifest.json"),
        "--runtime-manifest",
        str(fixtures / "runtime-manifest.json"),
        "--merge-target",
        str(fixtures / "merge-target.json"),
        "--out-dir",
        str(out_root / "missing-roster"),
        "--json",
    ], expect=2)
    missing_result = json.loads(missing.stdout)
    assert missing_result["status"] == "missing-required-input"

    artifact = out_root / "artifact.txt"
    run_report = out_root / "RUN_REPORT.md"
    verdict = out_root / "verdict.txt"
    claim_path = out_root / "claim.jsonl"
    artifact.write_text("artifact\n", encoding="utf-8")
    run_report.write_text("# run report\nok\n", encoding="utf-8")
    verdict.write_text("merge-review-pass\nok\n", encoding="utf-8")
    imported = run([
        sys.executable,
        str(bin_path),
        "import-result",
        "--thread-function",
        "merge-review",
        "--artifact",
        str(artifact),
        "--run-report",
        str(run_report),
        "--verdict-file",
        str(verdict),
        "--claim-path",
        str(claim_path),
        "--json",
    ])
    imported_doc = json.loads(imported.stdout)
    assert imported_doc["status"] == "handoff-result-imported"
    assert imported_doc["localizerApproval"] is False
    assert claim_path.is_file()
    claim = json.loads(claim_path.read_text(encoding="utf-8").splitlines()[-1])
    assert claim["approvalBoundary"]["localizerApproval"] is False
    assert claim["artifacts"][0]["sha256"]
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
