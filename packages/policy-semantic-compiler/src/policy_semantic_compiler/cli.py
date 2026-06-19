from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
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
    blocked = [gate for gate in gates if gate.get("status") != "pass"]
    print(json.dumps({"ok": not blocked, "blocked": blocked, "outDir": str(out_dir), "gateCount": len(gates)}, sort_keys=True))
    return 1 if blocked else 0


def command_check_fixtures(args: argparse.Namespace) -> int:
    path = Path(args.fixtures)
    bad = []
    total = 0
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        total += 1
        row = json.loads(line)
        if not row.get("expectedGate"):
            bad.append({"line": line_no, "error": "missing expectedGate"})
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
    blocked_parser = sub.add_parser("cutover-blocked")
    blocked_parser.add_argument("--out")
    blocked_parser.set_defaults(func=command_cutover_blocked)
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
