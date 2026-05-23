#!/usr/bin/env python3
"""Static behavior tests for ops-src-runtime-pack."""

from __future__ import annotations

import json
import subprocess
import sys
import tarfile
from pathlib import Path


def run(cmd: list[str], *, cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    proc = subprocess.run(cmd, cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != 0:
        raise AssertionError(
            f"command failed {proc.returncode}: {' '.join(cmd)}\n"
            f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
        )
    return proc


def main(argv: list[str]) -> int:
    package_dir = Path(argv[0]).resolve()
    out_root = Path(argv[1]).resolve()
    bin_path = package_dir / "bin" / "ops-src-runtime-pack.py"
    repo = out_root / "fixture"
    pack = out_root / "pack"
    repo.mkdir(parents=True, exist_ok=True)

    run(["git", "init"], cwd=repo)
    run(["git", "config", "user.email", "ops-src-runtime-pack@example.invalid"], cwd=repo)
    run(["git", "config", "user.name", "ops-src-runtime-pack"], cwd=repo)
    (repo / "flake.lock").write_text(
        '{\n  "nodes": {\n    "root": {\n      "inputs": {}\n    }\n  },\n  "root": "root",\n  "version": 7\n}\n',
        encoding="utf-8",
    )
    (repo / "README.md").write_text("fixture source\n", encoding="utf-8")
    (repo / "UNTRACKED.txt").write_text("do not include by default\n", encoding="utf-8")
    run(["git", "add", "flake.lock", "README.md"], cwd=repo)
    run(["git", "commit", "-m", "fixture"], cwd=repo)

    create = run([
        sys.executable,
        str(bin_path),
        "create",
        "--repo-root",
        str(repo),
        "--package-name",
        "fixture",
        "--installable",
        ".#fixture",
        "--policy-file",
        str(repo / "README.md"),
        "--metadata-only",
        "--out-dir",
        str(pack),
        "--json",
    ])
    created = json.loads(create.stdout)
    assert created["status"] == "src-runtime-pack-created"

    validate = run([
        sys.executable,
        str(bin_path),
        "validate",
        "--pack-dir",
        str(pack),
        "--json",
    ])
    valid = json.loads(validate.stdout)
    assert valid["status"] == "src-runtime-pack-valid"

    manifest = json.loads((pack / "MANIFEST.json").read_text(encoding="utf-8"))
    assert manifest["kind"] == "ops.srcRuntimePack.v1"
    assert manifest["metadataOnly"] is True
    assert manifest["approvalBoundary"]["semanticApproval"] is False
    assert manifest["approvalBoundary"]["completionApproval"] is False
    assert manifest["approvalBoundary"]["routeDecision"] is False
    assert manifest["source"]["archive"]["sha256"]
    assert manifest["source"]["archive"]["includeUntracked"] is False
    with tarfile.open(pack / "SRC" / "source.tar.gz", "r:gz") as tar:
        archive_names = set(tar.getnames())
    assert "src/README.md" in archive_names
    assert "src/UNTRACKED.txt" not in archive_names
    assert (pack / "SRC" / "source.tar.gz").is_file()
    assert (pack / "NIX" / "flake.lock").is_file()
    assert (pack / "POLICY" / "policy-manifest.json").is_file()

    start_here = (pack / "START_HERE.txt").read_text(encoding="utf-8")
    assert manifest["packNonce"] in start_here
    assert "includeUntracked: False" in start_here
    assert "firstPolicySha256:" in start_here
    assert "requiredDependencyClasses count:" in start_here

    no_lock_repo = out_root / "no-lock-fixture"
    no_lock_pack = out_root / "no-lock-pack"
    no_lock_repo.mkdir(parents=True, exist_ok=True)
    run(["git", "init"], cwd=no_lock_repo)
    run(["git", "config", "user.email", "ops-src-runtime-pack@example.invalid"], cwd=no_lock_repo)
    run(["git", "config", "user.name", "ops-src-runtime-pack"], cwd=no_lock_repo)
    (no_lock_repo / "README.md").write_text("fixture without flake lock\n", encoding="utf-8")
    run(["git", "add", "README.md"], cwd=no_lock_repo)
    run(["git", "commit", "-m", "fixture-no-lock"], cwd=no_lock_repo)
    run([
        sys.executable,
        str(bin_path),
        "create",
        "--repo-root",
        str(no_lock_repo),
        "--package-name",
        "fixture-no-lock",
        "--installable",
        ".#fixture",
        "--metadata-only",
        "--out-dir",
        str(no_lock_pack),
        "--json",
    ])
    run([
        sys.executable,
        str(bin_path),
        "validate",
        "--pack-dir",
        str(no_lock_pack),
        "--json",
    ])
    no_lock_manifest = json.loads((no_lock_pack / "MANIFEST.json").read_text(encoding="utf-8"))
    assert no_lock_manifest["nix"]["flakeLock"]["present"] is False
    assert not (no_lock_pack / "NIX" / "flake.lock").exists()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
