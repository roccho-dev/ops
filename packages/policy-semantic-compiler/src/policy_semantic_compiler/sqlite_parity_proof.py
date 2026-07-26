from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sqlite3
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from .sqlite_parity_cases import build_cases
from .sqlite_parity_contract import (
    DETAIL_SPECS,
    ProofError,
    canonical_json,
    read_jsonl_loose,
    sha256_bytes,
    sha256_json,
    write_json,
    write_jsonl,
)
from .sqlite_parity_sqlite import sqlite_candidate

def run_process(command: list[str], cwd: Path | None = None) -> tuple[int, str, str, float]:
    started = time.monotonic()
    proc = subprocess.run(command, cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return proc.returncode, proc.stdout, proc.stderr, round((time.monotonic() - started) * 1000, 3)


def read_json_if_exists(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def read_jsonl_if_exists(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        return read_jsonl_loose(path)
    except ProofError:
        return []


def normalize_gate(row: dict[str, Any]) -> dict[str, Any]:
    result = {"gate_id": row.get("gate_id"), "status": row.get("status"), "blocker": row.get("blocker") or None}
    if "count" in row:
        try:
            result["count"] = int(row["count"])
        except (TypeError, ValueError):
            result["count"] = row["count"]
    if result["gate_id"] in {"adrs-projection-duckdb-executed", "adrs-projection-sqlite-executed"}:
        result["gate_id"] = "projection-engine-executed"
    return result


def normalize_scalar(value: Any) -> Any:
    if isinstance(value, str):
        lower = value.lower()
        if lower == "true":
            return True
        if lower == "false":
            return False
        if re.fullmatch(r"-?[0-9]+", value):
            return int(value)
    return value


def normalize_detail(row: dict[str, Any]) -> dict[str, Any]:
    result = {key: normalize_scalar(value) for key, value in row.items() if key != "rowNumber"}
    value = result.get("sourceSpanIds")
    if isinstance(value, str):
        quoted = re.findall(r'"([^\"]+)"', value)
        if quoted:
            result["sourceSpanIds"] = sorted(quoted)
        else:
            stripped = value.strip("[] ")
            result["sourceSpanIds"] = sorted(item.strip() for item in stripped.split(",") if item.strip())
    elif isinstance(value, list):
        result["sourceSpanIds"] = sorted(str(item) for item in value)
    return result


def collect_engine(out_dir: Path, engine: str, exit_code: int, elapsed_ms: float, stdout: str, stderr: str) -> dict[str, Any]:
    gate_file = out_dir / f"adrs-projection-{engine}-gates.jsonl"
    gates = sorted((normalize_gate(row) for row in read_jsonl_if_exists(gate_file)), key=lambda row: str(row.get("gate_id")))
    details: dict[str, list[dict[str, Any]]] = {}
    for filename in DETAIL_SPECS:
        details[filename] = sorted((normalize_detail(row) for row in read_jsonl_if_exists(out_dir / filename)), key=canonical_json)
    manifest = read_json_if_exists(out_dir / "manifest.json") or {}
    contract = {
        "exitCode": exit_code,
        "status": manifest.get("status") or ("accepted" if exit_code == 0 else "blocked"),
        "ok": manifest.get("ok") is True,
        "semanticCoverageReady": manifest.get("semanticCoverageReady") is True,
        "cutoverReady": manifest.get("cutoverReady") is True,
        "policyDeletionApproved": manifest.get("policyDeletionApproved") is True,
        "generatedIsAuthority": manifest.get("generatedIsAuthority") is True,
        "gates": gates,
        "details": details,
    }
    return {
        "contract": contract,
        "gateHash": sha256_json(gates),
        "detailHash": sha256_json(details),
        "outputHash": sha256_json(contract),
        "elapsedMs": elapsed_ms,
        "stdout": stdout[-4000:],
        "stderr": stderr[-4000:],
    }


def tree_hash(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(p for p in root.rglob("*") if p.is_file()):
        rel = path.relative_to(root).as_posix()
        digest.update(rel.encode())
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def git_head(repo_root: Path) -> str | None:
    try:
        return subprocess.check_output(["git", "-C", str(repo_root), "rev-parse", "HEAD"], text=True, stderr=subprocess.DEVNULL).strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def inventory_duckdb(repo_root: Path, evidence_dir: Path) -> dict[str, int]:
    suffixes = {".py", ".sh", ".sql", ".nix", ".json", ".jsonl", ".md", ".yml", ".yaml", ".toml", ".go", ".mjs", ".js"}
    rows: list[dict[str, Any]] = []
    skip = {".git", ".worktrees", "node_modules", "result", "__pycache__"}
    for path in sorted(p for p in repo_root.rglob("*") if p.is_file() and p.suffix.lower() in suffixes and not any(part in skip for part in p.parts)):
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        rel = path.relative_to(repo_root).as_posix()
        for line_no, line in enumerate(text.splitlines(), start=1):
            if "duckdb" not in line.lower():
                continue
            lower_rel = rel.lower()
            active = True
            if "/tests/" in lower_rel or lower_rel.startswith("tests/"):
                cls, reason = "test-required", "executable fixture or test reference"
            elif "policy-semantic-compiler/src/" in lower_rel or rel == "build/packages.jsonl":
                cls, reason = "runtime-required", "active policy-semantic compiler runtime path"
            elif "policy-semantic-compiler/sql/" in lower_rel or "find-packages/sql/" in lower_rel:
                cls, reason = "projection-template", "active SQL projection template"
            elif "cue-append-contract-core/internal/adapters/duckdb" in lower_rel or "architecture" in lower_rel:
                cls, reason = "boundary-marker", "database adapter or core-boundary marker"
            elif lower_rel.endswith((".md", "readme")) or "/docs/" in lower_rel or "/skill/" in lower_rel:
                cls, reason, active = "documentation-only", "documentation reference", False
            elif "/evidence/" in lower_rel or "/proof/" in lower_rel or "/generated/" in lower_rel or "/tmp/" in lower_rel:
                cls, reason, active = "evidence-only", "historical or generated evidence", False
            elif rel in {"flake.nix", "flake.base.nix"}:
                cls, reason = "build-required", "package/check dependency or artifact publication"
            else:
                cls, reason = "unknown", "caller and reachability require owner classification"
            rows.append({
                "repositorySha": git_head(repo_root),
                "path": rel,
                "line": line_no,
                "symbol": None,
                "class": cls,
                "caller": line.strip()[:500],
                "active": active,
                "reason": reason,
                "evidence": f"{rel}:{line_no}",
            })
    write_jsonl(evidence_dir / "duckdb-usage.inventory.jsonl", rows)
    counts: dict[str, int] = {}
    for row in rows:
        counts[row["class"]] = counts.get(row["class"], 0) + 1
    return counts


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-fixture", type=Path, required=True)
    parser.add_argument("--repo-root", type=Path, required=True)
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--evidence-dir", type=Path, required=True)
    parser.add_argument("--policy-rev", default="rev-good")
    parser.add_argument("--compiler", default="policy-semantic-compiler")
    args = parser.parse_args()

    base_fixture = args.base_fixture.resolve()
    repo_root = args.repo_root.resolve()
    work_dir = args.work_dir.resolve()
    evidence_dir = args.evidence_dir.resolve()
    shutil.rmtree(work_dir, ignore_errors=True)
    shutil.rmtree(evidence_dir, ignore_errors=True)
    work_dir.mkdir(parents=True)
    evidence_dir.mkdir(parents=True)

    compiler_path = shutil.which(args.compiler)
    if not compiler_path:
        raise SystemExit(f"compiler not found: {args.compiler}")
    duckdb_path = shutil.which("duckdb")
    duckdb_version = None
    if duckdb_path:
        proc = subprocess.run([duckdb_path, "--version"], text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        duckdb_version = proc.stdout.strip()

    inventory_counts = inventory_duckdb(repo_root, evidence_dir)
    results: list[dict[str, Any]] = []
    mismatch_case_ids: list[str] = []
    fail_closed_regressions: list[str] = []
    strictness_increases: list[str] = []
    deterministic_failures: list[str] = []

    accepted_reference_hashes: dict[str, dict[str, str]] = {}
    for case in build_cases():
        case_dir = work_dir / "cases" / case.case_id
        shutil.copytree(base_fixture, case_dir)
        case.mutate(case_dir)
        input_hash = tree_hash(case_dir)
        duck_out = work_dir / "outputs" / case.case_id / "duckdb"
        sqlite_out = work_dir / "outputs" / case.case_id / "sqlite"
        duck_out.mkdir(parents=True)
        sqlite_out.mkdir(parents=True)

        duck_cmd = [compiler_path, "review-adrs-projection-duckdb", "--adrs-records-dir", str(case_dir), "--policy-rev", args.policy_rev, "--duckdb-bin", case.duckdb_bin, "--out-dir", str(duck_out)]
        duck_exit, duck_stdout, duck_stderr, duck_ms = run_process(duck_cmd)
        sqlite_started = time.monotonic()
        sqlite_stdout_buffer = ""
        sqlite_stderr_buffer = ""
        try:
            sqlite_exit = sqlite_candidate(case_dir, sqlite_out, args.policy_rev)
        except Exception as exc:
            sqlite_exit = 70
            sqlite_stderr_buffer = repr(exc)
        sqlite_ms = round((time.monotonic() - sqlite_started) * 1000, 3)

        duck = collect_engine(duck_out, "duckdb", duck_exit, duck_ms, duck_stdout, duck_stderr)
        sqlite = collect_engine(sqlite_out, "sqlite", sqlite_exit, sqlite_ms, sqlite_stdout_buffer, sqlite_stderr_buffer)
        duck_blocked = duck_exit != 0 and not duck["contract"]["ok"] and not duck["contract"]["cutoverReady"] and not duck["contract"]["policyDeletionApproved"]
        sqlite_blocked = sqlite_exit != 0 and not sqlite["contract"]["ok"] and not sqlite["contract"]["cutoverReady"] and not sqlite["contract"]["policyDeletionApproved"]
        mismatch_ids: list[str] = []
        if case.compare_mode == "fail-closed":
            if not duck_blocked:
                mismatch_ids.append("duckdb-engine-unavailable-did-not-fail-closed")
            if sqlite["contract"]["cutoverReady"] or sqlite["contract"]["policyDeletionApproved"]:
                mismatch_ids.append("sqlite-engine-unavailable-case-made-authority-claim")
        else:
            for key in ("status", "ok", "semanticCoverageReady", "cutoverReady", "policyDeletionApproved", "generatedIsAuthority"):
                if duck["contract"].get(key) != sqlite["contract"].get(key):
                    mismatch_ids.append(f"process:{key}")
            if duck["gateHash"] != sqlite["gateHash"]:
                mismatch_ids.append("gate-hash")
            if duck["detailHash"] != sqlite["detailHash"]:
                mismatch_ids.append("detail-hash")
        if case.compare_mode != "fail-closed":
            if duck_blocked and not sqlite_blocked:
                fail_closed_regressions.append(case.case_id)
                mismatch_ids.append("fail-closed-regression")
            if not duck_blocked and sqlite_blocked:
                strictness_increases.append(case.case_id)
                mismatch_ids.append("strictness-increase")

        if case.compare_mode == "determinism":
            rerun_out = work_dir / "outputs" / case.case_id / "sqlite-rerun"
            rerun_out.mkdir(parents=True)
            rerun_exit = sqlite_candidate(case_dir, rerun_out, args.policy_rev)
            rerun = collect_engine(rerun_out, "sqlite", rerun_exit, 0.0, "", "")
            if rerun["outputHash"] != sqlite["outputHash"]:
                deterministic_failures.append(case.case_id)
                mismatch_ids.append("sqlite-nondeterministic")
        if case.compare_mode == "reorder":
            reference = accepted_reference_hashes.get("sqlite")
            if reference and reference["outputHash"] != sqlite["outputHash"]:
                mismatch_ids.append("sqlite-row-order-sensitive")
            reference = accepted_reference_hashes.get("duckdb")
            if reference and reference["outputHash"] != duck["outputHash"]:
                mismatch_ids.append("duckdb-row-order-sensitive")
        if case.case_id == "accepted-fixture":
            accepted_reference_hashes["duckdb"] = {"outputHash": duck["outputHash"]}
            accepted_reference_hashes["sqlite"] = {"outputHash": sqlite["outputHash"]}

        if mismatch_ids:
            mismatch_case_ids.append(case.case_id)
        for engine, payload, exit_code in (("duckdb", duck, duck_exit), ("sqlite", sqlite, sqlite_exit)):
            results.append({
                "caseId": case.case_id,
                "engine": engine,
                "inputHash": input_hash,
                "exitCode": exit_code,
                "status": payload["contract"]["status"],
                "gateHash": payload["gateHash"],
                "detailHash": payload["detailHash"],
                "outputHash": payload["outputHash"],
                "elapsedMs": payload["elapsedMs"],
                "mismatchIds": sorted(set(mismatch_ids)),
                "stdoutTail": payload["stdout"],
                "stderrTail": payload["stderr"],
            })

    write_jsonl(evidence_dir / "sqlite-parity.results.jsonl", results)
    unknown_usage_count = inventory_counts.get("unknown", 0)
    summary = {
        "kind": "ops.sqliteParitySummary.v1",
        "baselineSha": git_head(repo_root),
        "totalCases": len(build_cases()),
        "matchingCases": len(build_cases()) - len(set(mismatch_case_ids)),
        "mismatchingCases": len(set(mismatch_case_ids)),
        "unresolvedMismatches": len(set(mismatch_case_ids)),
        "mismatchCaseIds": sorted(set(mismatch_case_ids)),
        "outputParity": len(set(mismatch_case_ids)) == 0,
        "failClosedParity": len(set(fail_closed_regressions)) == 0,
        "failClosedRegressionCount": len(set(fail_closed_regressions)),
        "failClosedRegressionCaseIds": sorted(set(fail_closed_regressions)),
        "strictnessIncreaseCount": len(set(strictness_increases)),
        "strictnessIncreaseCaseIds": sorted(set(strictness_increases)),
        "deterministicParity": len(set(deterministic_failures)) == 0,
        "deterministicFailureCaseIds": sorted(set(deterministic_failures)),
        "usageInventoryCounts": inventory_counts,
        "unknownUsageReferenceCount": unknown_usage_count,
        "candidateStatus": "pass" if not mismatch_case_ids and not fail_closed_regressions and unknown_usage_count == 0 else "blocked",
        "migrationClaimAllowed": not mismatch_case_ids and not fail_closed_regressions and unknown_usage_count == 0,
        "generatedIsAuthority": False,
        "databaseIsAuthority": False,
    }
    write_json(evidence_dir / "sqlite-parity.summary.json", summary)
    baseline = {
        "kind": "ops.sqliteParityBaseline.v1",
        "repositorySha": git_head(repo_root),
        "pythonExecutable": sys.executable,
        "pythonVersion": sys.version,
        "sqliteVersion": sqlite3.sqlite_version,
        "duckdbExecutable": duckdb_path,
        "duckdbVersion": duckdb_version,
        "baseFixtureHash": tree_hash(base_fixture),
        "compilerPath": compiler_path,
        "compilerSourceHash": sha256_bytes((repo_root / "packages/policy-semantic-compiler/src/policy_semantic_compiler/cli.py").read_bytes()),
        "generatedIsAuthority": False,
    }
    write_json(evidence_dir / "sqlite-parity.baseline.json", baseline)
    print(canonical_json(summary))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
