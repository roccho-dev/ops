from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


DEFAULT_POLICY_ROOT = Path("/home/nixos/repos/policy")
PACKAGE_ROOT = Path(__file__).resolve().parents[2]
SQL_DIR = PACKAGE_ROOT / "sql"

NORMATIVE_RE = re.compile(
    r"\b(MUST(?:\s+NOT)?|SHALL(?:\s+NOT)?|REQUIRED|REQUIRES|FORBIDDEN|"
    r"DENY|DENIED|ALLOW|ALLOWED|REVIEW|APPROVAL|AUTHORITY|CANONICAL|"
    r"MIGRATED|WILDCARD)\b",
    re.IGNORECASE,
)

TEXT_SUFFIXES = {".md"}
SKIP_DIRS = {".git", ".worktrees", "result", "node_modules", "__pycache__"}
CUTOVER_BLOCKED_GATE = "semantic-cutover-blocked"
IMPLEMENTED_GATES = {
    "duckdb-executed",
    "consumer-migrated-has-diff",
    "graph-records-present",
    "mandatory-signals-have-activation-edge",
    "native-rows-have-projection-edge",
    "no-stale-policy-git-migration-claim",
    "no-wildcard-role-scope",
    "review-signals-have-review-edge",
    "reproducible-two-run-output",
    "semantic-diff-deny-to-allow",
    "semantic-diff-must-weakened",
    "signals-present",
    "source-spans-present",
    "sources-present",
    CUTOVER_BLOCKED_GATE,
}
FORBIDDEN_CLAIMS = {
    "cutover-ready",
    "policy.git may be deleted",
    "policy logic deleted",
    "semantic approval granted",
}


@dataclass(frozen=True)
class Signal:
    signal_id: str
    source_id: str
    path: str
    line: int
    column: int
    token: str
    modal: str
    polarity: str
    text: str


def jsonl_write(path: Path, rows: Iterable[dict]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def repo_metadata(policy_root: Path) -> dict:
    meta = {"path": str(policy_root)}
    try:
        meta["gitHead"] = subprocess.check_output(
            ["git", "-C", str(policy_root), "rev-parse", "HEAD"],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except Exception:
        meta["gitHead"] = None
    try:
        status = subprocess.check_output(
            ["git", "-C", str(policy_root), "status", "--porcelain"],
            text=True,
            stderr=subprocess.DEVNULL,
        )
        meta["gitDirty"] = bool(status.strip())
    except Exception:
        meta["gitDirty"] = None
    return meta


def iter_policy_files(policy_root: Path) -> Iterable[Path]:
    for root, dirs, files in os.walk(policy_root):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
        for name in sorted(files):
            path = Path(root) / name
            if path.suffix.lower() in TEXT_SUFFIXES:
                yield path


def classify_signal(token: str, text: str) -> tuple[str, str]:
    lower = f"{token} {text}".lower()
    if "must not" in lower or "shall not" in lower or "forbidden" in lower or "deny" in lower:
        polarity = "deny"
    elif "allow" in lower or "allowed" in lower:
        polarity = "allow"
    else:
        polarity = "require"

    if "must" in lower or "shall" in lower or "required" in lower or "requires" in lower:
        modal = "mandatory"
    elif "review" in lower or "approval" in lower:
        modal = "review"
    else:
        modal = "candidate"
    return modal, polarity


def inventory(policy_root: Path) -> tuple[list[dict], list[Signal]]:
    sources: list[dict] = []
    signals: list[Signal] = []
    for path in iter_policy_files(policy_root):
        rel = path.relative_to(policy_root).as_posix()
        try:
            data = path.read_bytes()
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            continue
        source_id = "source:" + sha256_bytes(rel.encode("utf-8"))[:16]
        sources.append(
            {
                "kind": "policySemantic.source.v1",
                "sourceId": source_id,
                "path": rel,
                "sha256": sha256_bytes(data),
                "bytes": len(data),
            }
        )
        for line_no, line in enumerate(text.splitlines(), start=1):
            match = NORMATIVE_RE.search(line)
            if not match:
                continue
            token = match.group(1)
            modal, polarity = classify_signal(token, line)
            signal_id = "signal:" + sha256_bytes(f"{rel}:{line_no}:{line}".encode("utf-8"))[:20]
            signals.append(
                Signal(
                    signal_id=signal_id,
                    source_id=source_id,
                    path=rel,
                    line=line_no,
                    column=match.start(1) + 1,
                    token=token.upper(),
                    modal=modal,
                    polarity=polarity,
                    text=line.strip(),
                )
            )
    return sources, signals


def signal_rows(signals: Iterable[Signal]) -> list[dict]:
    return [
        {
            "kind": "policySemantic.signal.v1",
            "signalId": sig.signal_id,
            "sourceId": sig.source_id,
            "path": sig.path,
            "lineStart": sig.line,
            "lineEnd": sig.line,
            "columnStart": sig.column,
            "token": sig.token,
            "modal": sig.modal,
            "polarity": sig.polarity,
            "baselineModal": None,
            "baselinePolarity": None,
            "text": sig.text,
        }
        for sig in signals
    ]


def edge_rows(signals: Iterable[Signal]) -> list[dict]:
    rows: list[dict] = []
    for sig in signals:
        native_id = f"native:{sig.signal_id.removeprefix('signal:')}"
        rows.append(
            {
                "kind": "policySemantic.edge.v1",
                "edgeId": f"edge:source:{sig.signal_id}",
                "from": sig.source_id,
                "to": sig.signal_id,
                "edgeType": "source-span",
                "evidence": f"{sig.path}:{sig.line}",
                "migrationStatus": None,
                "consumerDiff": False,
            }
        )
        rows.append(
            {
                "kind": "policySemantic.edge.v1",
                "edgeId": f"edge:projection:{sig.signal_id}",
                "from": sig.signal_id,
                "to": native_id,
                "edgeType": "projection",
                "evidence": f"{sig.path}:{sig.line}",
                "migrationStatus": None,
                "consumerDiff": False,
            }
        )
        if sig.modal in {"mandatory", "review"}:
            rows.append(
                {
                    "kind": "policySemantic.edge.v1",
                    "edgeId": f"edge:activation:{sig.signal_id}",
                    "from": sig.signal_id,
                    "to": "gate:semantic-authority-closure",
                    "edgeType": "activation",
                    "evidence": f"{sig.path}:{sig.line}",
                    "migrationStatus": None,
                    "consumerDiff": False,
                }
            )
        if sig.modal == "review":
            rows.append(
                {
                    "kind": "policySemantic.edge.v1",
                    "edgeId": f"edge:review:{sig.signal_id}",
                    "from": sig.signal_id,
                    "to": "review:required",
                    "edgeType": "required-review",
                    "evidence": f"{sig.path}:{sig.line}",
                    "migrationStatus": None,
                    "consumerDiff": False,
                }
            )
    return rows


def native_rows(signals: Iterable[Signal]) -> list[dict]:
    return [
        {
            "kind": "policySemantic.nativeRow.v1",
            "nativeId": f"native:{sig.signal_id.removeprefix('signal:')}",
            "signalId": sig.signal_id,
            "modal": sig.modal,
            "polarity": sig.polarity,
            "scope": sig.path,
            "text": sig.text,
        }
        for sig in signals
    ]


def run_duckdb(out_dir: Path, duckdb_bin: str) -> tuple[bool, str | None]:
    duckdb = shutil.which(duckdb_bin) if "/" not in duckdb_bin else duckdb_bin
    if not duckdb:
        return False, f"DuckDB executable not found: {duckdb_bin}"

    gates_path = out_dir / "duckdb-gates.jsonl"
    runner = out_dir / "duckdb-runner.sql"
    runner.write_text(
        "\n".join(
            [
                f"CREATE OR REPLACE VIEW sources AS SELECT * FROM read_json_auto('{out_dir / 'sources.jsonl'}', format='newline_delimited');",
                f"CREATE OR REPLACE VIEW signals AS SELECT * FROM read_json_auto('{out_dir / 'signals.jsonl'}', format='newline_delimited');",
                f"CREATE OR REPLACE VIEW edges AS SELECT * FROM read_json_auto('{out_dir / 'edges.jsonl'}', format='newline_delimited');",
                f"CREATE OR REPLACE VIEW native_rows AS SELECT * FROM read_json_auto('{out_dir / 'native_rows.jsonl'}', format='newline_delimited');",
                (SQL_DIR / "integrity.sql").read_text(encoding="utf-8"),
                (SQL_DIR / "compile.sql").read_text(encoding="utf-8"),
                (SQL_DIR / "gates.sql").read_text(encoding="utf-8"),
                f"COPY (SELECT * FROM gate_results ORDER BY gate_id) TO '{gates_path}' (FORMAT JSON);",
            ]
        ),
        encoding="utf-8",
    )
    proc = subprocess.run([duckdb, str(out_dir / "semantic.duckdb"), "-c", f".read {runner}"], text=True)
    if proc.returncode != 0:
        return False, f"DuckDB gate execution failed with exit code {proc.returncode}"
    return True, None


def command_compile(args: argparse.Namespace) -> int:
    policy_root = Path(args.policy_root)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if not policy_root.exists():
        print(json.dumps({"ok": False, "blocker": f"policy root does not exist: {policy_root}"}), file=sys.stderr)
        return 2

    sources, signals = inventory(policy_root)
    jsonl_write(out_dir / "sources.jsonl", sources)
    jsonl_write(out_dir / "signals.jsonl", signal_rows(signals))
    jsonl_write(out_dir / "edges.jsonl", edge_rows(signals))
    jsonl_write(out_dir / "native_rows.jsonl", native_rows(signals))

    manifest = {
        "kind": "policySemantic.compilerRun.v1",
        "claim": "semantic-authority-closure-ready-for-review",
        "cutoverReady": False,
        "policyDeletionApproved": False,
        "source": repo_metadata(policy_root),
        "outputs": {
            "sources": "sources.jsonl",
            "signals": "signals.jsonl",
            "edges": "edges.jsonl",
            "nativeRows": "native_rows.jsonl",
            "duckdbGates": "duckdb-gates.jsonl",
        },
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n", encoding="utf-8")

    if args.python_only:
        blocker = "DuckDB gate not executed: python-only mode is blocked by policy."
        jsonl_write(out_dir / "duckdb-gates.jsonl", [{"gate_id": "duckdb-executed", "status": "blocked", "blocker": blocker}])
        print(json.dumps({"ok": False, "blocker": blocker, "outDir": str(out_dir)}, sort_keys=True))
        return 1

    duckdb_ok, blocker = run_duckdb(out_dir, args.duckdb_bin)
    if not duckdb_ok:
        jsonl_write(out_dir / "duckdb-gates.jsonl", [{"gate_id": "duckdb-executed", "status": "blocked", "blocker": blocker}])
        print(json.dumps({"ok": False, "blocker": blocker, "outDir": str(out_dir)}, sort_keys=True), file=sys.stderr)
        return 1

    gates = [json.loads(line) for line in (out_dir / "duckdb-gates.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    artifact_blocked = [
        gate
        for gate in gates
        if gate.get("status") != "pass" and gate.get("gate_id") != CUTOVER_BLOCKED_GATE
    ]
    cutover_blocked = [gate for gate in gates if gate.get("gate_id") == CUTOVER_BLOCKED_GATE]
    report = {
        "ok": not artifact_blocked,
        "candidateArtifactValid": not artifact_blocked,
        "cutoverReady": False,
        "policyDeletionApproved": False,
        "status": "candidate-artifact-valid" if not artifact_blocked else "candidate-artifact-blocked",
        "blocked": artifact_blocked,
        "cutoverBlocked": cutover_blocked,
        "outDir": str(out_dir),
        "gateCount": len(gates),
    }
    print(json.dumps(report, sort_keys=True))
    return 1 if artifact_blocked else 0


def command_check_fixtures(args: argparse.Namespace) -> int:
    path = Path(args.fixtures)
    bad = []
    total = 0
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        total += 1
        row = json.loads(line)
        expected_gate = row.get("expectedGate")
        if not expected_gate:
            bad.append({"line": line_no, "error": "missing expectedGate"})
        elif expected_gate not in IMPLEMENTED_GATES:
            planned = row.get("plannedOnly") is True or row.get("notImplemented") is True
            if not planned:
                bad.append(
                    {
                        "line": line_no,
                        "id": row.get("id"),
                        "expectedGate": expected_gate,
                        "error": "expectedGate is not implemented and is not marked plannedOnly/notImplemented",
                    }
                )
            elif not row.get("blocker"):
                bad.append(
                    {
                        "line": line_no,
                        "id": row.get("id"),
                        "expectedGate": expected_gate,
                        "error": "plannedOnly/notImplemented fixture must include blocker",
                    }
                )
    print(json.dumps({"ok": not bad, "fixtureCount": total, "errors": bad}))
    return 1 if bad else 0


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def write_counterexample_dataset(out_dir: Path, dataset: dict) -> None:
    table_defaults = {
        "sources": [],
        "signals": [],
        "edges": [],
        "native_rows": [],
    }
    for table_name, default_rows in table_defaults.items():
        jsonl_write(out_dir / f"{table_name}.jsonl", dataset.get(table_name, default_rows))


def command_check_counterexamples(args: argparse.Namespace) -> int:
    fixtures = read_jsonl(Path(args.fixtures))
    datasets = {row["id"]: row for row in read_jsonl(Path(args.datasets))}
    fixture_by_id = {row["id"]: row for row in fixtures}
    bad = []
    total = 0
    for fixture in fixtures:
        total += 1
        fixture_id = fixture.get("id")
        expected_gate = fixture.get("expectedGate")
        dataset = datasets.get(fixture_id)
        if dataset is None:
            bad.append({"id": fixture_id, "error": "missing executable counterexample dataset"})
            continue
        if expected_gate not in IMPLEMENTED_GATES:
            bad.append({"id": fixture_id, "expectedGate": expected_gate, "error": "expected gate is not implemented"})
            continue
        if dataset.get("expectedGate") != expected_gate:
            bad.append({"id": fixture_id, "error": "dataset expectedGate does not match fixture expectedGate"})
            continue
        if expected_gate == "duckdb-executed":
            if dataset.get("mode") != "python-only":
                bad.append({"id": fixture_id, "expectedGate": expected_gate, "error": "duckdb-executed counterexample must use python-only mode"})
            continue
        if expected_gate == "reproducible-two-run-output":
            if dataset.get("mode") != "input-reorder-changes-bytes":
                bad.append({"id": fixture_id, "expectedGate": expected_gate, "error": "reproducibility counterexample must use input-reorder-changes-bytes mode"})
            continue
        with tempfile.TemporaryDirectory(prefix=f"policy-semantic-counterexample-{fixture_id}-") as tmp:
            out_dir = Path(tmp)
            write_counterexample_dataset(out_dir, dataset)
            duckdb_ok, blocker = run_duckdb(out_dir, args.duckdb_bin)
            if not duckdb_ok:
                bad.append({"id": fixture_id, "expectedGate": expected_gate, "error": blocker})
                continue
            gates = read_jsonl(out_dir / "duckdb-gates.jsonl")
            matching = [gate for gate in gates if gate.get("gate_id") == expected_gate]
            if not matching:
                bad.append({"id": fixture_id, "expectedGate": expected_gate, "error": "expected gate missing from DuckDB output"})
            elif not any(gate.get("status") == "blocked" for gate in matching):
                bad.append({"id": fixture_id, "expectedGate": expected_gate, "error": "expected gate did not block"})
    missing_fixture = sorted(set(datasets) - set(fixture_by_id))
    for fixture_id in missing_fixture:
        bad.append({"id": fixture_id, "error": "dataset has no matching fixture"})
    print(json.dumps({"ok": not bad, "counterexampleCount": total, "errors": bad}, sort_keys=True))
    return 1 if bad else 0


def command_check_fresh_agent_cases(args: argparse.Namespace) -> int:
    path = Path(args.fixtures)
    bad = []
    total = 0
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        total += 1
        row = json.loads(line)
        text = row.get("input", "")
        expected = row.get("expectedDecision")
        if text in FORBIDDEN_CLAIMS and expected != "reject-forbidden-claim":
            bad.append({"line": line_no, "id": row.get("id"), "error": "forbidden claim is not rejected"})
        if text == "semantic-authority-closure-ready-for-review" and expected != "review-candidate-not-cutover":
            bad.append({"line": line_no, "id": row.get("id"), "error": "candidate claim must stay non-cutover"})
    seen_forbidden = {
        row
        for row in (
            json.loads(line).get("input")
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        )
        if row in {"cutover-ready", "policy.git may be deleted"}
    }
    for required in ["cutover-ready", "policy.git may be deleted"]:
        if required not in seen_forbidden:
            bad.append({"claim": required, "error": "required forbidden-claim regression case missing"})
    print(json.dumps({"ok": not bad, "fixtureCount": total, "errors": bad}))
    return 1 if bad else 0


def command_cutover_blocked(args: argparse.Namespace) -> int:
    report = {
        "ok": True,
        "status": "cutover-blocked",
        "claim": "semantic-authority-closure-ready-for-review",
        "cutoverReady": False,
        "policyDeletionApproved": False,
        "blockers": [
            "candidate graph inventory is a skeleton",
            "fresh-agent semantic equivalence is not proven",
            "policy.git boundary retirement is not approved",
        ],
    }
    if args.out:
        Path(args.out).write_text(json.dumps(report, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, sort_keys=True))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="policy-semantic-compiler")
    sub = parser.add_subparsers(dest="command", required=True)
    compile_parser = sub.add_parser("compile")
    compile_parser.add_argument("--policy-root", default=str(DEFAULT_POLICY_ROOT))
    compile_parser.add_argument("--out-dir", required=True)
    compile_parser.add_argument("--duckdb-bin", default="duckdb")
    compile_parser.add_argument("--python-only", action="store_true")
    compile_parser.set_defaults(func=command_compile)
    fixture_parser = sub.add_parser("check-fixtures")
    fixture_parser.add_argument("--fixtures", required=True)
    fixture_parser.set_defaults(func=command_check_fixtures)
    counterexample_parser = sub.add_parser("check-counterexamples")
    counterexample_parser.add_argument("--fixtures", required=True)
    counterexample_parser.add_argument("--datasets", required=True)
    counterexample_parser.add_argument("--duckdb-bin", default="duckdb")
    counterexample_parser.set_defaults(func=command_check_counterexamples)
    fresh_parser = sub.add_parser("check-fresh-agent-cases")
    fresh_parser.add_argument("--fixtures", required=True)
    fresh_parser.set_defaults(func=command_check_fresh_agent_cases)
    blocked_parser = sub.add_parser("cutover-blocked")
    blocked_parser.add_argument("--out")
    blocked_parser.set_defaults(func=command_cutover_blocked)
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
