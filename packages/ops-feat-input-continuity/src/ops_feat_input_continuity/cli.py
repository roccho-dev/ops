from __future__ import annotations

import argparse
import difflib
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile


ROOT_REL_SPEC = pathlib.Path("records/specs")
LAYOUT_REL_SPEC = pathlib.Path("governance-records-main/records/specs")


def fail(message: str) -> None:
    raise SystemExit(message)


def read_json(path: pathlib.Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        fail(f"missing JSON file: {path}")
    except json.JSONDecodeError as exc:
        fail(f"{path}: invalid json: {exc}")


def read_jsonl(path: pathlib.Path):
    try:
        with path.open(encoding="utf-8") as f:
            for lineno, line in enumerate(f, 1):
                if not line.strip():
                    continue
                try:
                    yield json.loads(line)
                except json.JSONDecodeError as exc:
                    fail(f"{path}:{lineno}: invalid json: {exc}")
    except FileNotFoundError:
        fail(f"missing JSONL file: {path}")


def package_contracts(path: pathlib.Path) -> dict[str, dict]:
    rows: dict[str, dict] = {}
    for row in read_jsonl(path):
        package_id = row.get("packageId")
        if not package_id:
            fail(f"{path}: package-contract row without packageId")
        if package_id in rows:
            fail(f"{path}: duplicate packageId {package_id}")
        rows[package_id] = row
    return rows


def stage_tool_layout(governance_root: pathlib.Path) -> pathlib.Path:
    staged_root = pathlib.Path(tempfile.mkdtemp(prefix="ops-feat-input-continuity-"))
    dst = staged_root / LAYOUT_REL_SPEC
    dst.mkdir(parents=True)
    for name in ["package-contract.v1.jsonl", "dependency-edge.v1.jsonl"]:
        shutil.copy2(governance_root / ROOT_REL_SPEC / name, dst / name)
    return staged_root


def run_make_feat_input(governance_root: pathlib.Path, staged_root: pathlib.Path, package_id: str) -> str:
    out = staged_root / f"{package_id}.fresh.json"
    cmd = [
        sys.executable,
        str(governance_root / "tools/make-feat-input.py"),
        str(staged_root),
        package_id,
        "--out",
        str(out),
    ]
    completed = subprocess.run(cmd, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if completed.returncode != 0:
        fail(
            f"make-feat-input failed for {package_id}: rc={completed.returncode}\n"
            f"stdout:\n{completed.stdout}\nstderr:\n{completed.stderr}"
        )
    return out.read_text(encoding="utf-8")


def assert_same_text(label: str, expected: str, actual: str) -> None:
    if expected == actual:
        return
    diff = "".join(
        difflib.unified_diff(
            expected.splitlines(True),
            actual.splitlines(True),
            fromfile=f"{label}:committed",
            tofile=f"{label}:fresh",
        )
    )
    fail(f"{label}: stale feat-input projection\n{diff}")


def check_committed_projection(governance_root: pathlib.Path, staged_root: pathlib.Path) -> list[str]:
    generated = governance_root / "generated/feat-inputs"
    paths = sorted(generated.glob("*.json"))
    if not paths:
        fail("generated/feat-inputs contains no feat-input JSON files")
    checked: list[str] = []
    for path in paths:
        package_id = path.stem
        committed = path.read_text(encoding="utf-8")
        fresh = run_make_feat_input(governance_root, staged_root, package_id)
        assert_same_text(package_id, committed, fresh)
        checked.append(package_id)
    return checked


def check_projection_digest(governance_root: pathlib.Path, committed_packages: list[str]) -> None:
    ledger_path = governance_root / ROOT_REL_SPEC / "projection-digest.v1.jsonl"
    ledger = {row["packageId"]: row for row in read_jsonl(ledger_path)}
    missing = sorted(set(committed_packages) - set(ledger))
    if missing:
        fail(f"projection-digest ledger missing packageIds: {missing}")
    mismatched = []
    for package_id in committed_packages:
        feat = read_json(governance_root / "generated/feat-inputs" / f"{package_id}.json")
        if feat.get("projectionDigest") != ledger[package_id].get("projectionDigest"):
            mismatched.append(package_id)
    if mismatched:
        fail(f"projectionDigest mismatch against ledger: {mismatched}")


def pick_package(rows: dict[str, dict], status: str) -> str:
    matches = sorted(pid for pid, row in rows.items() if row.get("status") == status)
    if not matches:
        fail(f"no package-contract rows with status={status!r}")
    return matches[0]


def check_smoke(
    governance_root: pathlib.Path,
    staged_root: pathlib.Path,
    rows: dict[str, dict],
    status: str,
    expected: str,
) -> None:
    package_id = pick_package(rows, status)
    data = json.loads(run_make_feat_input(governance_root, staged_root, package_id))
    if data.get("kind") != "feat.input.v1":
        fail(f"{package_id}: kind mismatch: {data.get('kind')!r}")
    if data.get("status") != expected:
        fail(f"{package_id}: status mismatch: {data.get('status')!r}, expected {expected!r}")
    if not data.get("sourceAuthority"):
        fail(f"{package_id}: sourceAuthority missing")
    if not data.get("projectionDigest"):
        fail(f"{package_id}: projectionDigest missing")
    if data.get("rawAdrDirectAuthority") is not False:
        fail(f"{package_id}: rawAdrDirectAuthority must be false")


def check_accepted_set_non_decrease(
    governance_root: pathlib.Path,
    base_package_contract: pathlib.Path,
) -> tuple[int, int]:
    head_rows = package_contracts(governance_root / ROOT_REL_SPEC / "package-contract.v1.jsonl")
    base_rows = package_contracts(base_package_contract)
    base_accepted = {pid for pid, row in base_rows.items() if row.get("status") == "accepted"}
    head_accepted = {pid for pid, row in head_rows.items() if row.get("status") == "accepted"}
    lost = sorted(base_accepted - head_accepted)
    if lost:
        fail(f"accepted packageIds dropped compared with base: {lost}")
    return len(base_accepted), len(head_accepted)


def report_source_authority(governance_root: pathlib.Path, committed_packages: list[str]) -> None:
    values: dict[str | None, list[str]] = {}
    for package_id in committed_packages:
        feat = read_json(governance_root / "generated/feat-inputs" / f"{package_id}.json")
        values.setdefault(feat.get("sourceAuthority"), []).append(package_id)
    for source, packages in sorted(values.items(), key=lambda item: str(item[0])):
        print(
            "sourceAuthority-report: "
            f"{source!r} packages={len(packages)} status=INDETERMINATE until accepted non-governance owner exists"
        )


def check(args: argparse.Namespace) -> int:
    governance_root = pathlib.Path(args.governance_root).resolve()
    rows = package_contracts(governance_root / ROOT_REL_SPEC / "package-contract.v1.jsonl")
    if not rows:
        fail("package-contract ledger is empty")
    if args.require_base and not args.base_package_contract:
        fail("--require-base was set but --base-package-contract was not provided")

    staged_root = stage_tool_layout(governance_root)
    try:
        committed_packages = check_committed_projection(governance_root, staged_root)
        check_projection_digest(governance_root, committed_packages)
        check_smoke(governance_root, staged_root, rows, "accepted", "ready")
        check_smoke(governance_root, staged_root, rows, "planned", "planned-blocked")
        if args.base_package_contract:
            base_count, head_count = check_accepted_set_non_decrease(
                governance_root,
                pathlib.Path(args.base_package_contract).resolve(),
            )
            print(f"accepted-set-non-decrease: PASS base={base_count} head={head_count}")
        else:
            print("accepted-set-non-decrease: skipped (no --base-package-contract)")
        report_source_authority(governance_root, committed_packages)
        print(f"feat-input-continuity: PASS committed={len(committed_packages)} package-contracts={len(rows)}")
        return 0
    finally:
        shutil.rmtree(staged_root, ignore_errors=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="ops-feat-input-continuity",
        description="Read-only continuity gate for governance feat-input projection.",
    )
    parser.add_argument("--governance-root", required=True, help="read-only governance checkout or store path")
    parser.add_argument("--base-package-contract", help="merge-base records/specs/package-contract.v1.jsonl")
    parser.add_argument("--require-base", action="store_true", help="fail if --base-package-contract is omitted")
    args = parser.parse_args(argv)
    return check(args)
