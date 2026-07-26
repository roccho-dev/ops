from __future__ import annotations

import argparse
import hashlib
import shutil
import sqlite3
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from .sqlite_parity_cases import build_cases
from .sqlite_parity_contract import PROVIDER_GATE_IDS, canonical_json, sha256_bytes, write_json, write_jsonl
from .sqlite_parity_inventory import reviewed_inventory
from .sqlite_parity_proof import collect_engine, git_head, run_process, tree_hash
from .sqlite_parity_provider import build_provider_fixtures
from .sqlite_parity_sqlite import sqlite_candidate


@dataclass(frozen=True)
class CaseSpec:
    case_id: str
    mutate: Callable[[Path], None]
    duckdb_bin: str = "duckdb"
    compare_mode: str = "full"
    fixture_id: str = "base"
    duckdb_provider_expected: str | None = None


def no_change(_: Path) -> None:
    return


def cases_v2() -> list[CaseSpec]:
    legacy = [
        CaseSpec(
            case_id=case.case_id,
            mutate=case.mutate,
            duckdb_bin=case.duckdb_bin,
            compare_mode=case.compare_mode,
        )
        for case in build_cases()
    ]
    legacy.extend(
        [
            CaseSpec(
                "provider-workflow-incomplete",
                no_change,
                fixture_id="provider-workflow-incomplete",
                duckdb_provider_expected="blocked",
            ),
            CaseSpec(
                "provider-workflow-accepted-results",
                no_change,
                fixture_id="provider-workflow-accepted-results",
                duckdb_provider_expected="pass",
            ),
        ]
    )
    return legacy


def provider_fixture_valid(gates: list[dict[str, Any]], expected: str) -> bool:
    provider = [row for row in gates if row.get("gate_id") in PROVIDER_GATE_IDS]
    if len(provider) != len(PROVIDER_GATE_IDS):
        return False
    statuses = [row.get("status") for row in provider]
    if expected == "pass":
        return all(status == "pass" for status in statuses)
    if expected == "blocked":
        return any(status == "blocked" for status in statuses)
    return False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-fixture", type=Path, required=True)
    parser.add_argument("--candidate-fixture", type=Path, required=True)
    parser.add_argument("--repo-root", type=Path, required=True)
    parser.add_argument("--usage-review", type=Path, required=True)
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--evidence-dir", type=Path, required=True)
    parser.add_argument("--policy-rev", default="rev-good")
    parser.add_argument("--compiler", default="policy-semantic-compiler")
    args = parser.parse_args()

    base_fixture = args.base_fixture.resolve()
    candidate_fixture = args.candidate_fixture.resolve()
    repo_root = args.repo_root.resolve()
    usage_review = args.usage_review.resolve()
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
        proc = subprocess.run(
            [duckdb_path, "--version"],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )
        duckdb_version = proc.stdout.strip()

    repository_sha = git_head(repo_root)
    inventory = reviewed_inventory(repo_root, usage_review, evidence_dir, repository_sha)
    provider_fixtures = build_provider_fixtures(
        compiler_path,
        candidate_fixture,
        work_dir,
        args.policy_rev,
    )
    fixture_roots = {"base": base_fixture, **provider_fixtures}

    results: list[dict[str, Any]] = []
    mismatch_case_ids: list[str] = []
    fail_closed_regressions: list[str] = []
    strictness_increases: list[str] = []
    deterministic_failures: list[str] = []
    provider_fixture_failures: list[str] = []
    accepted_reference_hashes: dict[str, dict[str, str]] = {}

    all_cases = cases_v2()
    for case in all_cases:
        source_fixture = fixture_roots[case.fixture_id]
        case_dir = work_dir / "cases" / case.case_id
        shutil.copytree(source_fixture, case_dir)
        case.mutate(case_dir)
        input_hash = tree_hash(case_dir)
        duck_out = work_dir / "outputs" / case.case_id / "duckdb"
        sqlite_out = work_dir / "outputs" / case.case_id / "sqlite"
        duck_out.mkdir(parents=True)
        sqlite_out.mkdir(parents=True)

        duck_cmd = [
            compiler_path,
            "review-adrs-projection-duckdb",
            "--adrs-records-dir",
            str(case_dir),
            "--policy-rev",
            args.policy_rev,
            "--duckdb-bin",
            case.duckdb_bin,
            "--out-dir",
            str(duck_out),
        ]
        duck_exit, duck_stdout, duck_stderr, duck_ms = run_process(duck_cmd)
        sqlite_started = time.monotonic()
        sqlite_stdout = ""
        sqlite_stderr = ""
        try:
            sqlite_exit = sqlite_candidate(case_dir, sqlite_out, args.policy_rev)
        except Exception as exc:
            sqlite_exit = 70
            sqlite_stderr = repr(exc)
        sqlite_ms = round((time.monotonic() - sqlite_started) * 1000, 3)

        duck = collect_engine(duck_out, "duckdb", duck_exit, duck_ms, duck_stdout, duck_stderr)
        sqlite = collect_engine(
            sqlite_out,
            "sqlite",
            sqlite_exit,
            sqlite_ms,
            sqlite_stdout,
            sqlite_stderr,
        )
        duck_blocked = (
            duck_exit != 0
            and not duck["contract"]["ok"]
            and not duck["contract"]["cutoverReady"]
            and not duck["contract"]["policyDeletionApproved"]
        )
        sqlite_blocked = (
            sqlite_exit != 0
            and not sqlite["contract"]["ok"]
            and not sqlite["contract"]["cutoverReady"]
            and not sqlite["contract"]["policyDeletionApproved"]
        )
        mismatch_ids: list[str] = []

        if case.duckdb_provider_expected and not provider_fixture_valid(
            duck["contract"]["gates"], case.duckdb_provider_expected
        ):
            provider_fixture_failures.append(case.case_id)
            mismatch_ids.append("duckdb-provider-fixture-invalid")

        if case.compare_mode == "fail-closed":
            if not duck_blocked:
                mismatch_ids.append("duckdb-engine-unavailable-did-not-fail-closed")
            if sqlite["contract"]["cutoverReady"] or sqlite["contract"][
                "policyDeletionApproved"
            ]:
                mismatch_ids.append("sqlite-engine-unavailable-case-made-authority-claim")
        else:
            for key in (
                "status",
                "ok",
                "semanticCoverageReady",
                "cutoverReady",
                "policyDeletionApproved",
                "generatedIsAuthority",
            ):
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
        for engine, payload, exit_code in (
            ("duckdb", duck, duck_exit),
            ("sqlite", sqlite, sqlite_exit),
        ):
            results.append(
                {
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
                }
            )

    write_jsonl(evidence_dir / "sqlite-parity.results.jsonl", results)
    unknown_usage_count = (
        inventory["unknownPathCount"] + inventory["missingActiveReviewedPathCount"]
    )
    mismatch_ids = sorted(set(mismatch_case_ids))
    summary = {
        "kind": "ops.sqliteParitySummary.v1",
        "suiteVersion": "ops-90.v2",
        "baselineSha": repository_sha,
        "totalCases": len(all_cases),
        "providerCaseCount": 2,
        "providerCaseIds": [
            "provider-workflow-accepted-results",
            "provider-workflow-incomplete",
        ],
        "providerFixtureFailureCaseIds": sorted(set(provider_fixture_failures)),
        "matchingCases": len(all_cases) - len(mismatch_ids),
        "mismatchingCases": len(mismatch_ids),
        "unresolvedMismatches": len(mismatch_ids),
        "mismatchCaseIds": mismatch_ids,
        "outputParity": len(mismatch_ids) == 0,
        "failClosedParity": len(set(fail_closed_regressions)) == 0,
        "failClosedRegressionCount": len(set(fail_closed_regressions)),
        "failClosedRegressionCaseIds": sorted(set(fail_closed_regressions)),
        "strictnessIncreaseCount": len(set(strictness_increases)),
        "strictnessIncreaseCaseIds": sorted(set(strictness_increases)),
        "deterministicParity": len(set(deterministic_failures)) == 0,
        "deterministicFailureCaseIds": sorted(set(deterministic_failures)),
        "usageInventoryCounts": inventory["counts"],
        "usageReview": inventory,
        "unknownUsageReferenceCount": unknown_usage_count,
        "candidateStatus": "pass"
        if not mismatch_ids
        and not fail_closed_regressions
        and unknown_usage_count == 0
        and not provider_fixture_failures
        else "blocked",
        "migrationClaimAllowed": not mismatch_ids
        and not fail_closed_regressions
        and unknown_usage_count == 0
        and not provider_fixture_failures,
        "generatedIsAuthority": False,
        "databaseIsAuthority": False,
    }
    write_json(evidence_dir / "sqlite-parity.summary.json", summary)
    baseline = {
        "kind": "ops.sqliteParityBaseline.v1",
        "suiteVersion": "ops-90.v2",
        "repositorySha": repository_sha,
        "pythonExecutable": sys.executable,
        "pythonVersion": sys.version,
        "sqliteVersion": sqlite3.sqlite_version,
        "duckdbExecutable": duckdb_path,
        "duckdbVersion": duckdb_version,
        "baseFixtureHash": tree_hash(base_fixture),
        "candidateFixtureHash": tree_hash(candidate_fixture),
        "compilerPath": compiler_path,
        "compilerSourceHash": sha256_bytes(
            (
                repo_root
                / "packages/policy-semantic-compiler/src/policy_semantic_compiler/cli.py"
            ).read_bytes()
        ),
        "usageReviewHash": hashlib.sha256(usage_review.read_bytes()).hexdigest(),
        "generatedIsAuthority": False,
    }
    write_json(evidence_dir / "sqlite-parity.baseline.json", baseline)
    print(canonical_json(summary))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
