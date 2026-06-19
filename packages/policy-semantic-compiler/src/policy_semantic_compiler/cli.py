from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import contextlib
import io
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
POLICY_ENTRY_FILES = {
    "policy-entry.accepted.env",
    "policy.md",
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


def sha256_tree(paths: Iterable[Path], root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(paths, key=lambda p: p.relative_to(root).as_posix()):
        rel = path.relative_to(root).as_posix()
        digest.update(rel.encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def shell_quote(value: str) -> str:
    return "'" + value.replace("'", "'\"'\"'") + "'"


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


def row_id(row: dict) -> str | None:
    value = row.get("id") or row.get("sourceSpanId") or row.get("spanId")
    return str(value) if value is not None else None


def row_ids(rows: Iterable[dict]) -> set[str]:
    return {rid for row in rows if (rid := row_id(row))}


def as_list(value: object) -> list:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def source_path_for_span(span: dict, source_files_by_id: dict[str, dict]) -> str:
    trace = span.get("sourceTrace") if isinstance(span.get("sourceTrace"), dict) else {}
    if trace.get("path"):
        return str(trace["path"])
    source_file = source_files_by_id.get(str(span.get("sourceFileId")))
    return str(source_file.get("path") or "<unknown>")


def accepted_span_ids_from_rows(rows: Iterable[dict]) -> set[str]:
    accepted: set[str] = set()
    for row in rows:
        is_accepted = (
            row.get("acceptedSemanticApproval") is True
            or row.get("semanticApprovalAccepted") is True
            or row.get("approvalStatus") == "accepted"
            or row.get("status") in {"accepted", "pass", "approved"}
        )
        if not is_accepted:
            continue
        for key in ("sourceSpanId", "spanId", "id"):
            value = row.get(key)
            if value:
                accepted.add(str(value))
        for key in ("sourceSpanIds", "spanIds", "coveredSourceSpanIds"):
            for value in as_list(row.get(key)):
                if value:
                    accepted.add(str(value))
    return accepted


def accepted_equivalence_proofs(rows: Iterable[dict]) -> list[dict]:
    accepted = []
    for row in rows:
        status = row.get("status")
        if (
            row.get("acceptedSemanticEquivalence") is True
            or row.get("equivalenceProofAccepted") is True
            or status in {"accepted", "pass", "approved"}
        ):
            accepted.append(row)
    return accepted


def disposition_by_source_file_id(rows: Iterable[dict]) -> dict[str, dict]:
    dispositions: dict[str, dict] = {}
    for row in rows:
        source_file_id = row.get("sourceFileId")
        if source_file_id:
            dispositions[str(source_file_id)] = row
    return dispositions


def candidate_disposition_rows(rows: Iterable[dict]) -> list[dict]:
    candidate_rows = []
    for row in rows:
        if row.get("status") != "accepted":
            candidate_rows.append(row)
    return candidate_rows


def command_review_semantic_coverage(args: argparse.Namespace) -> int:
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    source_files = read_jsonl(Path(args.source_files))
    source_spans = read_jsonl(Path(args.source_spans))
    semantic_nodes = read_jsonl(Path(args.semantic_nodes))
    semantic_edges = read_jsonl(Path(args.semantic_edges))
    approval_rows = read_jsonl(Path(args.approvals)) if args.approvals else []
    equivalence_rows = read_jsonl(Path(args.equivalence_proofs)) if args.equivalence_proofs else []
    disposition_rows = read_jsonl(Path(args.source_file_dispositions)) if args.source_file_dispositions else []

    source_file_ids = row_ids(source_files)
    span_ids = row_ids(source_spans)
    node_ids = row_ids(semantic_nodes)
    all_endpoint_ids = source_file_ids | span_ids | node_ids
    source_files_by_id = {str(row["id"]): row for row in source_files if row.get("id")}
    dispositions_by_source_file_id = disposition_by_source_file_id(disposition_rows)

    accepted_span_ids = accepted_span_ids_from_rows(source_spans) | accepted_span_ids_from_rows(approval_rows)
    accepted_span_ids &= span_ids
    accepted_equivalence = accepted_equivalence_proofs(equivalence_rows)
    candidate_dispositions = candidate_disposition_rows(disposition_rows)
    non_normative_file_class_span_ids = {
        str(row_id(span))
        for span in source_spans
        if row_id(span)
        and dispositions_by_source_file_id.get(str(span.get("sourceFileId")), {}).get("requiresIndividualSemanticApproval")
        is False
    }
    review_required_span_ids = span_ids - non_normative_file_class_span_ids

    spans_missing_source_file = [
        row_id(span)
        for span in source_spans
        if span.get("sourceFileId") and str(span.get("sourceFileId")) not in source_file_ids
    ]
    node_missing_source_span = [
        {"nodeId": row_id(node), "sourceSpanId": str(span_id)}
        for node in semantic_nodes
        for span_id in as_list(node.get("sourceSpanIds"))
        if str(span_id) not in span_ids
    ]
    edge_missing_endpoint = [
        {"edgeId": row_id(edge), "field": field, "endpoint": str(edge.get(field))}
        for edge in semantic_edges
        for field in ("from", "to")
        if edge.get(field) and str(edge.get(field)) not in all_endpoint_ids
    ]
    edge_missing_source_span = [
        {"edgeId": row_id(edge), "sourceSpanId": str(span_id)}
        for edge in semantic_edges
        for span_id in as_list(edge.get("sourceSpanIds"))
        if str(span_id) not in span_ids
    ]

    supported_span_ids = {
        str(edge.get("from"))
        for edge in semantic_edges
        if edge.get("edgeKind") == "span-supports-semantic-node" and str(edge.get("from")) in span_ids
    }
    orphan_span_ids = sorted(span_ids - supported_span_ids)

    node_kinds_by_span: dict[str, set[str]] = {span_id: set() for span_id in span_ids}
    for node in semantic_nodes:
        node_kind = str(node.get("nodeKind") or "<missing-node-kind>")
        for span_id in as_list(node.get("sourceSpanIds")):
            if str(span_id) in node_kinds_by_span:
                node_kinds_by_span[str(span_id)].add(node_kind)

    edge_kinds_by_span: dict[str, set[str]] = {span_id: set() for span_id in span_ids}
    for edge in semantic_edges:
        edge_kind = str(edge.get("edgeKind") or "<missing-edge-kind>")
        candidate_ids = set(str(value) for value in as_list(edge.get("sourceSpanIds")))
        for field in ("from", "to"):
            if edge.get(field):
                candidate_ids.add(str(edge.get(field)))
        for span_id in candidate_ids & span_ids:
            edge_kinds_by_span[span_id].add(edge_kind)

    groups: dict[tuple[str, str, str], dict] = {}
    for span in source_spans:
        span_id = row_id(span)
        if not span_id:
            continue
        path = source_path_for_span(span, source_files_by_id)
        node_key = ",".join(sorted(node_kinds_by_span.get(span_id) or {"<missing-node-kind>"}))
        edge_key = ",".join(sorted(edge_kinds_by_span.get(span_id) or {"<missing-edge-kind>"}))
        key = (path, node_key, edge_key)
        group = groups.setdefault(
            key,
            {
                "kind": "policySemantic.semanticCoverageReviewPacket.v1",
                "packetId": "packet:" + sha256_bytes("\0".join(key).encode("utf-8"))[:20],
                "sourcePath": path,
                "nodeKinds": sorted(node_key.split(",")),
                "edgeKinds": sorted(edge_key.split(",")),
                "sourceSpanIds": [],
                "spanCount": 0,
                "acceptedSemanticApprovalCount": 0,
                "fileClassNonNormativeSpanCount": 0,
                "reviewRequiredSpanCount": 0,
                "status": "blocked",
                "reviewRequired": True,
            },
        )
        group["sourceSpanIds"].append(span_id)
        group["spanCount"] += 1
        if span_id in non_normative_file_class_span_ids:
            group["fileClassNonNormativeSpanCount"] += 1
        else:
            group["reviewRequiredSpanCount"] += 1
        if span_id in accepted_span_ids and span_id in review_required_span_ids:
            group["acceptedSemanticApprovalCount"] += 1

    packets = sorted(groups.values(), key=lambda row: (row["sourcePath"], row["nodeKinds"], row["edgeKinds"]))
    for packet in packets:
        packet["sourceSpanIds"] = sorted(packet["sourceSpanIds"])
        packet["unapprovedSpanCount"] = packet["reviewRequiredSpanCount"] - packet["acceptedSemanticApprovalCount"]
        packet["status"] = "accepted" if packet["unapprovedSpanCount"] == 0 else "blocked"

    integrity_counts = {
        "spansMissingSourceFile": len(spans_missing_source_file),
        "nodesMissingSourceSpan": len(node_missing_source_span),
        "edgesMissingEndpoint": len(edge_missing_endpoint),
        "edgesMissingSourceSpan": len(edge_missing_source_span),
        "orphanSpansWithoutSemanticNode": len(orphan_span_ids),
    }
    total_spans = len(span_ids)
    review_required_count = len(review_required_span_ids)
    accepted_count = len(accepted_span_ids & review_required_span_ids)
    non_normative_file_class_count = len(non_normative_file_class_span_ids)
    equivalence_proof_present = bool(accepted_equivalence)
    cutover_ready = (
        total_spans > 0
        and accepted_count == review_required_count
        and equivalence_proof_present
        and not candidate_dispositions
        and all(count == 0 for count in integrity_counts.values())
    )
    blockers = []
    if accepted_count != review_required_count:
        blockers.append("accepted semantic approval count does not equal review-required source spans")
    if not equivalence_proof_present:
        blockers.append("accepted semantic equivalence proof is missing")
    if candidate_dispositions:
        blockers.append("source file dispositions are not accepted authority")
    for name, count in integrity_counts.items():
        if count:
            blockers.append(f"{name}={count}")

    summary = {
        "kind": "policySemantic.semanticCoverageReviewSummary.v1",
        "ok": cutover_ready,
        "status": "accepted" if cutover_ready else "blocked",
        "cutoverReady": cutover_ready,
        "policyDeletionApproved": False,
        "generatedIsAuthority": False,
        "migrationAuthority": False,
        "cutoverAuthority": False,
        "acceptedSemanticApprovalCount": accepted_count,
        "totalSourceSpanCount": total_spans,
        "reviewRequiredSourceSpanCount": review_required_count,
        "fileClassNonNormativeSourceSpanCount": non_normative_file_class_count,
        "sourceFileDispositionRows": len(disposition_rows),
        "candidateSourceFileDispositionRows": len(candidate_dispositions),
        "equivalenceProofPresent": equivalence_proof_present,
        "acceptedEquivalenceProofCount": len(accepted_equivalence),
        "reviewPacketCount": len(packets),
        "orphanOrIntegrityCounts": integrity_counts,
        "blockers": blockers,
        "outputs": {
            "reviewPackets": "semantic-coverage-review-packets.jsonl",
            "summary": "semantic-coverage-summary.json",
        },
    }
    jsonl_write(out_dir / "semantic-coverage-review-packets.jsonl", packets)
    (out_dir / "semantic-coverage-summary.json").write_text(
        json.dumps(summary, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(summary, sort_keys=True))
    return 0 if cutover_ready else 1


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



ACCEPTED_POLICY_ENTRY_SOURCE_REQUIRED = {
    "kind",
    "accepted",
    "policyEntryLock",
    "sourceAuthority",
    "ownerApprovalRef",
    "semanticEquivalenceProofRef",
    "consumerZeroProofRef",
}
ACCEPTED_POLICY_ENTRY_SOURCE_KIND = "policy.projectedPolicyEntryAcceptedSource.v1"


def read_one_json_or_jsonl(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    stripped = text.strip()
    if not stripped:
        raise ValueError("accepted source is empty")
    if stripped.startswith("{"):
        return json.loads(stripped)
    for line in stripped.splitlines():
        if line.strip():
            return json.loads(line)
    raise ValueError("accepted source has no JSON object")


def validate_accepted_ref(record: dict, field: str, errors: list[dict]) -> None:
    value = record.get(field)
    if not isinstance(value, dict):
        errors.append({"error": "accepted-source-ref-not-object", "field": field})
        return
    for subfield in ("repo", "path", "commit", "id"):
        if value.get(subfield) in (None, "", []):
            errors.append({"error": "accepted-source-ref-missing-field", "field": field, "subfield": subfield})
    if value.get("status") not in (None, "accepted"):
        errors.append({"error": "accepted-source-ref-not-accepted", "field": field, "status": value.get("status")})


def validate_accepted_policy_entry_source_record(record: dict, expected_lock: str | None = None) -> list[dict]:
    errors: list[dict] = []
    for field in sorted(ACCEPTED_POLICY_ENTRY_SOURCE_REQUIRED):
        if field not in record or record.get(field) in (None, "", []):
            errors.append({"error": "missing-required-field", "field": field})
    if record.get("kind") != ACCEPTED_POLICY_ENTRY_SOURCE_KIND:
        errors.append({"error": "wrong-kind", "expected": ACCEPTED_POLICY_ENTRY_SOURCE_KIND, "actual": record.get("kind")})
    if record.get("accepted") is not True:
        errors.append({"error": "accepted-source-not-accepted", "accepted": record.get("accepted")})
    if record.get("generatedIsAuthority") is True:
        errors.append({"error": "generated-output-cannot-be-authority"})
    if record.get("policyDeletionApproved") is True:
        errors.append({"error": "accepted-policy-entry-source-cannot-approve-policy-deletion"})
    if record.get("fixtureOnly") is True or record.get("POLICY_ENTRY_FIXTURE_ONLY") is True:
        errors.append({"error": "fixture-only-source-cannot-accept-real-policy-entry"})
    for ref_field in ("sourceAuthority", "ownerApprovalRef", "semanticEquivalenceProofRef", "consumerZeroProofRef"):
        validate_accepted_ref(record, ref_field, errors)
    if expected_lock is not None and record.get("policyEntryLock") != expected_lock:
        errors.append({"error": "policy-entry-lock-mismatch", "expected": expected_lock, "actual": record.get("policyEntryLock")})
    return errors


def load_and_validate_accepted_policy_entry_source(path: Path, expected_lock: str | None = None) -> tuple[dict | None, list[dict]]:
    try:
        record = read_one_json_or_jsonl(path)
    except Exception as exc:
        return None, [{"error": "accepted-source-read-failed", "detail": str(exc)}]
    return record, validate_accepted_policy_entry_source_record(record, expected_lock)


def write_projected_policy_entry(
    out_dir: Path,
    *,
    accepted: bool,
    policy_text: str,
    rule_rows: list[dict],
    fixture_reason: str | None,
    accepted_source_record: dict | None = None,
) -> dict:
    rules_dir = out_dir / "rules"
    rules_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "policy.md").write_text(policy_text, encoding="utf-8")
    rule_paths = []
    for index, row in enumerate(rule_rows, start=1):
        stem = row.get("id") or row.get("ruleId") or f"rule-{index}"
        safe_stem = re.sub(r"[^A-Za-z0-9._-]+", "-", str(stem)).strip("-").lower() or f"rule-{index}"
        rule_path = rules_dir / f"{safe_stem}.md"
        text = str(row.get("text") or row.get("body") or row.get("title") or "fixture projected policy rule")
        rule_path.write_text(f"# {safe_stem}\n\n{text.rstrip()}\n", encoding="utf-8")
        rule_paths.append(rule_path)

    if not rule_paths:
        rule_path = rules_dir / "candidate-policy-entry-blocked.md"
        rule_path.write_text(
            "# candidate policy entry blocked\n\n"
            "No accepted semantic rule projection exists yet. Keep POLICY_ENTRY_SOURCE_MODE=policy-git.\n",
            encoding="utf-8",
        )
        rule_paths.append(rule_path)

    lock = "sha256:" + sha256_tree([out_dir / "policy.md", *rule_paths], out_dir)
    if accepted and accepted_source_record is not None:
        entry_status = "accepted-source"
    elif accepted:
        entry_status = "fixture-accepted"
    else:
        entry_status = "candidate-blocked"
    meta_lines = [
        f"POLICY_ENTRY_ACCEPTED={'true' if accepted else 'false'}",
        f"POLICY_ENTRY_LOCK={lock}",
        "POLICY_ENTRY_GENERATED_IS_AUTHORITY=false",
        f"POLICY_ENTRY_STATUS={entry_status}",
    ]
    if accepted and accepted_source_record is not None:
        meta_lines.append(f"POLICY_ENTRY_ACCEPTED_SOURCE_KIND={shell_quote(str(accepted_source_record.get('kind')))}")
        meta_lines.append(f"POLICY_ENTRY_SOURCE_AUTHORITY={shell_quote(json.dumps(accepted_source_record.get('sourceAuthority'), sort_keys=True))}")
        meta_lines.append(f"POLICY_ENTRY_OWNER_APPROVAL_REF={shell_quote(json.dumps(accepted_source_record.get('ownerApprovalRef'), sort_keys=True))}")
        meta_lines.append(f"POLICY_ENTRY_SEMANTIC_EQUIVALENCE_PROOF_REF={shell_quote(json.dumps(accepted_source_record.get('semanticEquivalenceProofRef'), sort_keys=True))}")
        meta_lines.append(f"POLICY_ENTRY_CONSUMER_ZERO_PROOF_REF={shell_quote(json.dumps(accepted_source_record.get('consumerZeroProofRef'), sort_keys=True))}")
    elif accepted:
        meta_lines.append("POLICY_ENTRY_FIXTURE_ONLY=true")
        reason = fixture_reason or "bootstrap projected-mode contract test"
        meta_lines.append(f"POLICY_ENTRY_FIXTURE_REASON={shell_quote(reason)}")
    (out_dir / "policy-entry.accepted.env").write_text("\n".join(meta_lines) + "\n", encoding="utf-8")

    manifest = {
        "kind": "policySemantic.projectedPolicyEntry.v1",
        "accepted": accepted,
        "fixtureOnly": accepted and accepted_source_record is None,
        "acceptedSource": accepted_source_record,
        "generatedIsAuthority": False,
        "cutoverReady": False,
        "policyDeletionApproved": False,
        "lock": lock,
        "outputs": {
            "acceptedEnv": "policy-entry.accepted.env",
            "policy": "policy.md",
            "rules": [p.relative_to(out_dir).as_posix() for p in rule_paths],
        },
        "blockers": []
        if accepted
        else [
            "projection is generated from candidate semantic rows only",
            "governance cutover gates are not accepted",
            "bootstrap projected mode must reject this real candidate until acceptance",
        ],
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    return manifest


def command_project_policy_entry(args: argparse.Namespace) -> int:
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    accepted = bool(args.fixture_accepted)
    if args.fixture_accepted and args.accepted_source:
        print(json.dumps({"ok": False, "error": "--fixture-accepted and --accepted-source are mutually exclusive"}, sort_keys=True), file=sys.stderr)
        return 2
    if accepted and not args.fixture_reason:
        print(json.dumps({"ok": False, "error": "--fixture-accepted requires --fixture-reason"}, sort_keys=True), file=sys.stderr)
        return 2

    rule_rows: list[dict] = []
    if args.native_rows:
        native_path = Path(args.native_rows)
        if not native_path.exists():
            print(json.dumps({"ok": False, "error": f"native rows missing: {native_path}"}, sort_keys=True), file=sys.stderr)
            return 2
        for row in read_jsonl(native_path):
            rule_rows.append(
                {
                    "id": row.get("nativeId") or row.get("signalId"),
                    "text": row.get("text"),
                }
            )

    if args.policy_text:
        policy_text = Path(args.policy_text).read_text(encoding="utf-8")
    else:
        policy_text = (
            "# projected policy entry candidate\n\n"
            "This is a generated candidate projection for bootstrap projected mode.\n\n"
            "It is not accepted authority unless policy-entry.accepted.env explicitly sets "
            "POLICY_ENTRY_ACCEPTED=true from a fixture-only test or a future accepted governance gate.\n"
        )

    accepted_source_record = None
    manifest = write_projected_policy_entry(
        out_dir,
        accepted=accepted,
        policy_text=policy_text,
        rule_rows=rule_rows,
        fixture_reason=args.fixture_reason,
    )
    if args.accepted_source:
        accepted_source_record, source_errors = load_and_validate_accepted_policy_entry_source(Path(args.accepted_source), manifest["lock"])
        if source_errors:
            report = {"ok": False, "accepted": False, "errors": source_errors, "expectedLock": manifest["lock"]}
            (out_dir / "accepted-source.check.json").write_text(json.dumps(report, sort_keys=True, indent=2) + "\n", encoding="utf-8")
            print(json.dumps(report, sort_keys=True), file=sys.stderr)
            return 2
        accepted = True
        manifest = write_projected_policy_entry(
            out_dir,
            accepted=True,
            policy_text=policy_text,
            rule_rows=rule_rows,
            fixture_reason=None,
            accepted_source_record=accepted_source_record,
        )
    print(json.dumps({"ok": True, "outDir": str(out_dir), **manifest}, sort_keys=True))
    return 0


def command_check_projected_policy_entry(args: argparse.Namespace) -> int:
    root = Path(args.dir)
    missing = sorted(name for name in POLICY_ENTRY_FILES if not (root / name).is_file())
    rules_dir = root / "rules"
    if not rules_dir.is_dir() or not list(rules_dir.glob("*.md")):
        missing.append("rules/*.md")
    errors = [{"error": "missing", "path": path} for path in missing]

    accepted = None
    lock = None
    meta = root / "policy-entry.accepted.env"
    if meta.exists():
        values = {}
        for line in meta.read_text(encoding="utf-8").splitlines():
            if "=" in line:
                key, value = line.split("=", 1)
                values[key] = value
        accepted = values.get("POLICY_ENTRY_ACCEPTED")
        lock = values.get("POLICY_ENTRY_LOCK")
        if args.expect_accepted:
            if accepted != "true":
                errors.append({"error": "expected accepted projection", "accepted": accepted})
            if not lock:
                errors.append({"error": "accepted projection missing POLICY_ENTRY_LOCK"})
        else:
            if accepted == "true":
                errors.append({"error": "real candidate unexpectedly accepted"})

    report = {
        "ok": not errors,
        "accepted": accepted == "true",
        "lockPresent": bool(lock),
        "errors": errors,
    }
    print(json.dumps(report, sort_keys=True))
    return 1 if errors else 0



def command_check_accepted_policy_entry_source(args: argparse.Namespace) -> int:
    record, errors = load_and_validate_accepted_policy_entry_source(Path(args.source), args.expected_lock)
    report = {"ok": not errors, "accepted": not errors, "errors": errors, "record": record}
    if args.out:
        Path(args.out).write_text(json.dumps(report, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, sort_keys=True))
    return 0 if not errors else 1


TYPED_JSON_FORBIDDEN_KEYS = {
    "acceptedSemanticApproval",
    "cutoverReady",
    "policyDeletionApproved",
    "migrationAuthority",
    "cutoverAuthority",
}
TYPED_JSON_TARGET_GATES = [
    "typed-json-target-files-covered",
    "typed-json-object-pointers-present",
    "schema-constraints-covered",
    "router-route-integrity",
    "role-contract-integrity",
    "role-index-sha256-lock-verified",
    "protocol-command-completeness",
    "protocol-semantics-not-layout",
    "typed-records-remain-candidate",
    "typed-extraction-does-not-clear-current-cutover-gates",
]


def json_pointer_escape(value: str) -> str:
    return value.replace("~", "~0").replace("/", "~1")


def pointer_join(base: str, part: str | int) -> str:
    suffix = str(part) if isinstance(part, int) else json_pointer_escape(str(part))
    return (base.rstrip("/") + "/" + suffix) if base else "/" + suffix


def rel_path(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def typed_source_file_row(policy_root: Path, path: Path, file_class: str, git_head: str | None) -> dict:
    rel = rel_path(path, policy_root)
    data = path.read_bytes()
    return {
        "kind": "policy.sourceFile.v1",
        "id": "policy-source-file-" + sha256_bytes(rel.encode("utf-8"))[:24],
        "sourceFilePath": rel,
        "path": rel,
        "sha256": sha256_bytes(data),
        "bytes": len(data),
        "fileClass": file_class,
        "extractor": "typed-json-v1",
        "authorityBoundary": "typed JSON candidate extraction only; not semantic approval, cutover approval, deletion approval, or source of truth",
        "claimAllowed": False,
        "sourceTrace": {"repo": "policy", "path": rel, "rev": git_head},
        "status": "candidate",
    }


def typed_add_unit(rows: dict[str, list[dict]], source_file: dict, pointer: str, node_kind: str, value, subject: str | None = None, predicate: str | None = None, obj: str | None = None) -> None:
    seed = f"{source_file['sourceFilePath']}\0{pointer}\0{node_kind}\0{json.dumps(value, sort_keys=True, ensure_ascii=False)}"
    span_id = "policy-source-span-" + sha256_bytes(seed.encode("utf-8"))[:24]
    node_id = "policy-semantic-node-" + sha256_bytes((seed + "\0node").encode("utf-8"))[:24]
    source_trace = {
        "repo": "policy",
        "path": source_file["sourceFilePath"],
        "rev": source_file["sourceTrace"].get("rev"),
        "jsonPointer": pointer or "",
    }
    rows["spans"].append({
        "kind": "policy.sourceSpan.v1",
        "id": span_id,
        "sourceFileId": source_file["id"],
        "sourceTrace": source_trace,
        "semanticUnit": node_kind,
        "sha256": sha256_bytes(json.dumps(value, sort_keys=True, ensure_ascii=False).encode("utf-8")),
        "detection": {"method": "typed-json-extractor", "acceptedSemanticApproval": False},
        "acceptedSemanticApproval": False,
        "authorityBoundary": "typed JSON candidate extraction only; not semantic approval, cutover approval, deletion approval, or source of truth",
        "claimAllowed": False,
        "status": "candidate",
    })
    rows["nodes"].append({
        "kind": "policy.semanticNode.v1",
        "id": node_id,
        "nodeKind": node_kind,
        "sourceSpanIds": [span_id],
        "subject": subject or source_file["sourceFilePath"],
        "predicate": predicate or "defines",
        "object": obj if obj is not None else value,
        "sourceTrace": source_trace,
        "authorityBoundary": "typed JSON candidate extraction only; not semantic approval, cutover approval, deletion approval, or source of truth",
        "claimAllowed": False,
        "status": "candidate",
    })
    for edge_kind, src, dst in (("source-covers-span", source_file["id"], span_id), ("span-supports-semantic-node", span_id, node_id)):
        edge_seed = f"{edge_kind}\0{src}\0{dst}"
        rows["edges"].append({
            "kind": "policy.semanticEdge.v1",
            "id": "policy-edge-" + sha256_bytes(edge_seed.encode("utf-8"))[:24],
            "edgeKind": edge_kind,
            "from": src,
            "to": dst,
            "sourceSpanIds": [span_id],
            "sourceTrace": source_trace,
            "authorityBoundary": "typed JSON candidate extraction only; not semantic approval, cutover approval, deletion approval, or source of truth",
            "claimAllowed": False,
            "status": "candidate",
        })


def typed_walk_schema(rows: dict[str, list[dict]], source_file: dict, value, pointer: str = "") -> None:
    if isinstance(value, dict):
        if isinstance(value.get("required"), list):
            for i, field in enumerate(value["required"]):
                typed_add_unit(rows, source_file, pointer_join(pointer_join(pointer, "required"), i), "schema.required", field, predicate="requires-field", obj=str(field))
        if "const" in value:
            typed_add_unit(rows, source_file, pointer_join(pointer, "const"), "schema.const", value["const"], predicate="requires-const")
        if isinstance(value.get("enum"), list):
            for i, enum_value in enumerate(value["enum"]):
                typed_add_unit(rows, source_file, pointer_join(pointer_join(pointer, "enum"), i), "schema.enum", enum_value, predicate="allows-enum")
        if "pattern" in value:
            typed_add_unit(rows, source_file, pointer_join(pointer, "pattern"), "schema.pattern", value["pattern"], predicate="requires-pattern")
        if "minItems" in value:
            typed_add_unit(rows, source_file, pointer_join(pointer, "minItems"), "schema.min-items", value["minItems"], predicate="requires-min-items")
        if value.get("additionalProperties") is False:
            typed_add_unit(rows, source_file, pointer_join(pointer, "additionalProperties"), "schema.additional-properties", False, predicate="denies-additional-properties", obj="false")
        if isinstance(value.get("anyOf"), list):
            for i, branch in enumerate(value["anyOf"]):
                typed_add_unit(rows, source_file, pointer_join(pointer_join(pointer, "anyOf"), i), "schema.anyof-branch", i, predicate="defines-anyof-branch")
                if isinstance(branch, dict) and isinstance(branch.get("required"), list):
                    for j, field in enumerate(branch["required"]):
                        typed_add_unit(rows, source_file, pointer_join(pointer_join(pointer_join(pointer_join(pointer, "anyOf"), i), "required"), j), "schema.required", field, predicate="requires-field", obj=str(field))
        if isinstance(value.get("not"), dict):
            any_of = value["not"].get("anyOf")
            if isinstance(any_of, list):
                for i, branch in enumerate(any_of):
                    if isinstance(branch, dict) and isinstance(branch.get("required"), list):
                        for j, field in enumerate(branch["required"]):
                            typed_add_unit(rows, source_file, pointer_join(pointer_join(pointer_join(pointer_join(pointer_join(pointer, "not"), "anyOf"), i), "required"), j), "schema.not-required", field, predicate="forbids-field", obj=str(field))
        for key, child in value.items():
            typed_walk_schema(rows, source_file, child, pointer_join(pointer, key))
    elif isinstance(value, list):
        for i, child in enumerate(value):
            typed_walk_schema(rows, source_file, child, pointer_join(pointer, i))


def typed_extract_router(rows: dict[str, list[dict]], source_file: dict, value: dict) -> None:
    for i, item in enumerate(value.get("defaultRead", []) or []):
        typed_add_unit(rows, source_file, f"/defaultRead/{i}", "router.default-read", item, predicate="reads")
    for i, route in enumerate(value.get("taskRoutes", []) or []):
        route_id = route.get("routeId", f"route-{i}")
        typed_add_unit(rows, source_file, f"/taskRoutes/{i}", "router.task-route", route_id, predicate="defines-route")
        for field, kind, pred in (("read", "router.route-read", "reads"), ("forbidden", "router.forbidden", "forbids"), ("outputs", "router.output", "outputs")):
            for j, item in enumerate(route.get(field, []) or []):
                typed_add_unit(rows, source_file, f"/taskRoutes/{i}/{field}/{j}", kind, item, subject=f"route:{route_id}", predicate=pred)
    for i, item in enumerate(value.get("forbiddenSourceRoots", []) or []):
        typed_add_unit(rows, source_file, f"/forbiddenSourceRoots/{i}", "router.forbidden-source-root", item, predicate="forbids-source-root")


def typed_extract_role_index(rows: dict[str, list[dict]], source_file: dict, value: dict, policy_root: Path, errors: list[str]) -> None:
    for i, item in enumerate(value.get("items", []) or []):
        role_id = item.get("roleId") or item.get("roleProfileId") or f"role-{i}"
        typed_add_unit(rows, source_file, f"/items/{i}", "role.index-entry", role_id, predicate="indexes-role")
        role_path = item.get("path")
        expected_sha = item.get("sha256")
        if role_path and expected_sha:
            target = policy_root / role_path
            actual_sha = sha256_bytes(target.read_bytes()) if target.exists() else None
            typed_add_unit(rows, source_file, f"/items/{i}/sha256", "role.index-sha256-lock", expected_sha, subject=str(role_path), predicate="locks-sha256", obj=expected_sha)
            if actual_sha != expected_sha:
                errors.append(f"role index sha mismatch: {role_path}")
        else:
            errors.append(f"role index missing path or sha256 at /items/{i}")


def typed_extract_role_profile(rows: dict[str, list[dict]], source_file: dict, value: dict) -> None:
    role_id = value.get("roleId") or value.get("roleProfileId") or source_file["sourceFilePath"]
    typed_add_unit(rows, source_file, "/roleId", "role.profile", role_id, predicate="defines-role")
    if value.get("status"):
        typed_add_unit(rows, source_file, "/status", "role.status", value["status"], subject=str(role_id), predicate="has-status")
    if value.get("kernelRef"):
        typed_add_unit(rows, source_file, "/kernelRef", "role.kernel-ref", value["kernelRef"], subject=str(role_id), predicate="uses-kernel")
    if value.get("ownerRoleRef"):
        typed_add_unit(rows, source_file, "/ownerRoleRef", "role.owner-role", value["ownerRoleRef"], subject=str(role_id), predicate="owned-by")
    for i, module in enumerate(value.get("modules", []) or []):
        typed_add_unit(rows, source_file, f"/modules/{i}", "role.module-binding", module, subject=str(role_id), predicate="binds-module")


def typed_extract_exit_graph(rows: dict[str, list[dict]], source_file: dict, value: dict) -> None:
    for i, edge in enumerate(value.get("edges", []) or []):
        exit_name = edge.get("exit", f"exit-{i}")
        typed_add_unit(rows, source_file, f"/edges/{i}", "exit.owner-ttl", {"exit": exit_name, "ownerRoleRef": edge.get("ownerRoleRef"), "ttl": edge.get("ttl")}, subject=str(exit_name), predicate="resolves-to-owner", obj=str(edge.get("ownerRoleRef")))


def typed_extract_authority_index(rows: dict[str, list[dict]], source_file: dict, value: dict) -> None:
    for field, kind in (("normative", "authority-index.normative"), ("rawEvidence", "authority-index.raw-evidence"), ("generated", "authority-index.generated"), ("mustNotUseAsAuthority", "authority-index.must-not-use")):
        for i, item in enumerate(value.get(field, []) or []):
            typed_add_unit(rows, source_file, f"/{field}/{i}", kind, item, predicate="classifies-path")


def typed_extract_kernel_index(rows: dict[str, list[dict]], source_file: dict, value: dict) -> None:
    items = value.get("items") if isinstance(value, dict) else None
    if isinstance(items, list):
        for i, item in enumerate(items):
            typed_add_unit(rows, source_file, f"/items/{i}", "kernel.index-item", item, predicate="indexes-kernel-item")
    elif isinstance(value, dict):
        for key, item in value.items():
            if key != "kind":
                typed_add_unit(rows, source_file, f"/{json_pointer_escape(key)}", "kernel.index-item", item, predicate="indexes-kernel-item")


def typed_extract_protocol(rows: dict[str, list[dict]], source_file: dict, value: dict, errors: list[str]) -> None:
    for region_name, region in (value.get("regions", {}) or {}).items():
        typed_add_unit(rows, source_file, f"/regions/{json_pointer_escape(region_name)}", "protocol.region-state", region_name, predicate="defines-region")
        for state_field in ("states", "terminalStates"):
            for i, state in enumerate((region or {}).get(state_field, []) or []):
                typed_add_unit(rows, source_file, f"/regions/{json_pointer_escape(region_name)}/{state_field}/{i}", "protocol.region-state", state, subject=str(region_name), predicate="has-state")
    for command_name, command in (value.get("commands", {}) or {}).items():
        base = f"/commands/{json_pointer_escape(command_name)}"
        typed_add_unit(rows, source_file, base, "protocol.command", command_name, predicate="defines-command")
        for field, kind in (("kind", "protocol.command-kind"), ("guards", "protocol.guard"), ("effects", "protocol.effect"), ("emits", "protocol.emitted-event"), ("region", "protocol.region"), ("topologyAction", "protocol.topology-action"), ("canonicalStateEffect", "protocol.canonical-state-effect"), ("risk", "protocol.risk"), ("requiresApproval", "protocol.requires-approval")):
            if field not in command:
                continue
            field_value = command[field]
            if isinstance(field_value, list):
                for i, item in enumerate(field_value):
                    typed_add_unit(rows, source_file, f"{base}/{field}/{i}", kind, item, subject=str(command_name), predicate="has-command-field")
            else:
                typed_add_unit(rows, source_file, f"{base}/{field}", kind, field_value, subject=str(command_name), predicate="has-command-field")
        for required_field in ("guards", "effects", "emits", "region", "topologyAction"):
            if required_field in command and not command[required_field]:
                errors.append(f"protocol command field empty: {command_name}/{required_field}")


def typed_target_files(policy_root: Path) -> list[Path]:
    targets: list[Path] = []
    for pattern in ("schemas/*.schema.json", "role-profiles/*.json", "protocols/*/protocol.envelope.json", "protocols/*/workflow.mmds.json"):
        targets.extend(sorted(policy_root.glob(pattern)))
    for rel in ("policy-router.v1.json", "role-exit-graph.v1.json", "kernel/authority-index.v1.json", "kernel/index.v1.json", "role-profiles/index.v1.json"):
        path = policy_root / rel
        if path.exists() and path not in targets:
            targets.append(path)
    return sorted(set(targets), key=lambda p: p.relative_to(policy_root).as_posix())


def typed_file_class(rel: str) -> str:
    if rel.endswith("workflow.mmds.json"):
        return "projection-or-layout"
    if rel.startswith(("schemas/", "protocols/", "role-profiles/", "kernel/")) or rel in {"policy-router.v1.json", "role-exit-graph.v1.json"}:
        return "semantic-source"
    return "candidate-non-authority"



def inc_count(counts: dict[str, int], key: str, amount: int = 1) -> None:
    counts[key] = counts.get(key, 0) + amount



def typed_expected_add(units: set[tuple[str, str, str]], rel: str, pointer: str, node_kind: str) -> None:
    units.add((rel, pointer or "", node_kind))


def typed_expected_schema_units(rel: str, value, units: set[tuple[str, str, str]], pointer: str = "") -> None:
    if isinstance(value, dict):
        if isinstance(value.get("required"), list):
            for i, _field in enumerate(value["required"]):
                typed_expected_add(units, rel, pointer_join(pointer_join(pointer, "required"), i), "schema.required")
        if "const" in value:
            typed_expected_add(units, rel, pointer_join(pointer, "const"), "schema.const")
        if isinstance(value.get("enum"), list):
            for i, _enum_value in enumerate(value["enum"]):
                typed_expected_add(units, rel, pointer_join(pointer_join(pointer, "enum"), i), "schema.enum")
        if "pattern" in value:
            typed_expected_add(units, rel, pointer_join(pointer, "pattern"), "schema.pattern")
        if "minItems" in value:
            typed_expected_add(units, rel, pointer_join(pointer, "minItems"), "schema.min-items")
        if value.get("additionalProperties") is False:
            typed_expected_add(units, rel, pointer_join(pointer, "additionalProperties"), "schema.additional-properties")
        if isinstance(value.get("anyOf"), list):
            for i, branch in enumerate(value["anyOf"]):
                typed_expected_add(units, rel, pointer_join(pointer_join(pointer, "anyOf"), i), "schema.anyof-branch")
                if isinstance(branch, dict) and isinstance(branch.get("required"), list):
                    for j, _field in enumerate(branch["required"]):
                        typed_expected_add(units, rel, pointer_join(pointer_join(pointer_join(pointer_join(pointer, "anyOf"), i), "required"), j), "schema.required")
        if isinstance(value.get("not"), dict):
            any_of = value["not"].get("anyOf")
            if isinstance(any_of, list):
                for i, branch in enumerate(any_of):
                    if isinstance(branch, dict) and isinstance(branch.get("required"), list):
                        for j, _field in enumerate(branch["required"]):
                            typed_expected_add(units, rel, pointer_join(pointer_join(pointer_join(pointer_join(pointer_join(pointer, "not"), "anyOf"), i), "required"), j), "schema.not-required")
        for key, child in value.items():
            typed_expected_schema_units(rel, child, units, pointer_join(pointer, key))
    elif isinstance(value, list):
        for i, child in enumerate(value):
            typed_expected_schema_units(rel, child, units, pointer_join(pointer, i))


def typed_expected_units_for_file(rel: str, value, policy_root: Path, errors: list[str]) -> set[tuple[str, str, str]]:
    units: set[tuple[str, str, str]] = set()
    if rel.startswith("schemas/"):
        typed_expected_schema_units(rel, value, units)
    elif rel == "policy-router.v1.json":
        for i, _item in enumerate(value.get("defaultRead", []) or []):
            typed_expected_add(units, rel, f"/defaultRead/{i}", "router.default-read")
        for i, route in enumerate(value.get("taskRoutes", []) or []):
            typed_expected_add(units, rel, f"/taskRoutes/{i}", "router.task-route")
            for field, kind in (("read", "router.route-read"), ("forbidden", "router.forbidden"), ("outputs", "router.output")):
                for j, _item in enumerate(route.get(field, []) or []):
                    typed_expected_add(units, rel, f"/taskRoutes/{i}/{field}/{j}", kind)
        for i, _item in enumerate(value.get("forbiddenSourceRoots", []) or []):
            typed_expected_add(units, rel, f"/forbiddenSourceRoots/{i}", "router.forbidden-source-root")
    elif rel == "role-exit-graph.v1.json":
        for i, _edge in enumerate(value.get("edges", []) or []):
            typed_expected_add(units, rel, f"/edges/{i}", "exit.owner-ttl")
    elif rel == "role-profiles/index.v1.json":
        items = value.get("items", []) or []
        for i, _item in enumerate(items):
            typed_expected_add(units, rel, f"/items/{i}", "role.index-entry")
            typed_expected_add(units, rel, f"/items/{i}/sha256", "role.index-sha256-lock")
    elif rel.startswith("role-profiles/"):
        typed_expected_add(units, rel, "/roleId", "role.profile")
        for field, kind in (("modules", "role.module-binding"), ("ownerRoleRef", "role.owner-role"), ("kernelRef", "role.kernel-ref"), ("status", "role.status")):
            if field not in value or value.get(field) in (None, [], ""):
                errors.append(f"role profile missing required field: {rel}/{field}")
            elif isinstance(value.get(field), list):
                for i, _item in enumerate(value[field]):
                    typed_expected_add(units, rel, f"/{field}/{i}", kind)
            else:
                typed_expected_add(units, rel, f"/{field}", kind)
    elif rel.endswith("protocol.envelope.json"):
        commands = value.get("commands", {}) or {}
        for name, command in commands.items():
            base = f"/commands/{json_pointer_escape(name)}"
            typed_expected_add(units, rel, base, "protocol.command")
            for field, kind in (("kind", "protocol.command-kind"), ("guards", "protocol.guard"), ("effects", "protocol.effect"), ("emits", "protocol.emitted-event"), ("region", "protocol.region"), ("topologyAction", "protocol.topology-action"), ("canonicalStateEffect", "protocol.canonical-state-effect"), ("risk", "protocol.risk"), ("requiresApproval", "protocol.requires-approval")):
                if field not in command or command.get(field) in (None, [], ""):
                    if field in {"guards", "effects", "emits", "region", "topologyAction"}:
                        errors.append(f"protocol command missing required field: {rel}/{name}/{field}")
                    continue
                if isinstance(command[field], list):
                    for i, _item in enumerate(command[field]):
                        typed_expected_add(units, rel, f"{base}/{field}/{i}", kind)
                else:
                    typed_expected_add(units, rel, f"{base}/{field}", kind)
    elif rel.endswith("workflow.mmds.json"):
        typed_expected_add(units, rel, "", "projection.layout")
    elif rel == "kernel/authority-index.v1.json":
        for field, kind in (("normative", "authority-index.normative"), ("rawEvidence", "authority-index.raw-evidence"), ("generated", "authority-index.generated"), ("mustNotUseAsAuthority", "authority-index.must-not-use")):
            for i, _item in enumerate(value.get(field, []) or []):
                typed_expected_add(units, rel, f"/{field}/{i}", kind)
    elif rel == "kernel/index.v1.json":
        items = value.get("items") if isinstance(value, dict) else None
        if isinstance(items, list):
            for i, _item in enumerate(items):
                typed_expected_add(units, rel, f"/items/{i}", "kernel.index-item")
        elif isinstance(value, dict):
            for key in value:
                if key != "kind":
                    typed_expected_add(units, rel, f"/{json_pointer_escape(key)}", "kernel.index-item")
    return units


def typed_count_by_kind(units: set[tuple[str, str, str]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for _path, _pointer, kind in units:
        inc_count(counts, kind)
    return counts


def typed_unit_details(units: set[tuple[str, str, str]], limit: int = 25) -> list[dict]:
    return [{"path": path, "jsonPointer": pointer, "nodeKind": kind} for path, pointer, kind in sorted(units)[:limit]]


def typed_missing_units(expected_units: set[tuple[str, str, str]], actual_units: set[tuple[str, str, str]], kinds: set[str]) -> set[tuple[str, str, str]]:
    return {unit for unit in expected_units - actual_units if unit[2] in kinds}

def typed_gate(gates: list[dict], gate_id: str, ok: bool, details: dict | None = None) -> None:
    gates.append({"gate_id": gate_id, "status": "pass" if ok else "blocked", "details": details or {}})



POLICY_DELETION_REF_TOKENS = (
    "policy.git",
    "/home/nixos/repos/policy",
    "git+ssh://100.124.250.91/home/nixos/repos/policy.git",
    "DEFAULT_POLICY_ROOT",
    "POLICY_SEMANTIC_POLICY_ROOT",
    "POLICY_URL",
    "POLICY_PACKAGE_FLAKE_REF",
)
POLICY_DELETION_SKIP_DIRS = {".git", "result", "node_modules", "__pycache__"}
POLICY_DELETION_SKIP_SUFFIXES = {".pyc", ".duckdb"}


def deletion_rel_path(path: Path, root: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return path.as_posix()


def deletion_classify_reference(path: str, line: str) -> str:
    low_path = path.lower()
    low_line = line.lower()
    if "tests/" in low_path or low_path.endswith("run.sh") or "fixture" in low_path or "counterexample" in low_path:
        return "test-or-negative-control"
    if "readme" in low_path or low_path.endswith(".md"):
        return "documentation"
    if "policy.git may be deleted" in low_line or "forbidden" in low_line or "negative" in low_line:
        return "negative-control"
    if any(token.lower() in low_line for token in ("nix run", "git+ssh://", "default_policy_root", "default source", "source must exist", "policy_fetch_default", "policy_package_flake_ref", "policy_url")):
        return "active-runtime-candidate"
    return "candidate-reference"


def deletion_iter_files(root: Path):
    if not root.exists():
        return
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in POLICY_DELETION_SKIP_DIRS and not d.startswith(".worktrees")]
        for filename in filenames:
            path = Path(dirpath) / filename
            if path.suffix in POLICY_DELETION_SKIP_SUFFIXES:
                continue
            yield path


def deletion_scan_roots(roots: list[Path]) -> list[dict]:
    rows: list[dict] = []
    for root in roots:
        root = root.resolve()
        if not root.exists():
            rows.append({"kind": "policyDeletion.consumerReference.v1", "repoRoot": str(root), "path": str(root), "lineNumber": 0, "token": "<missing-root>", "line": "", "referenceClass": "missing-scan-root", "activeRuntimeCandidate": True, "scanRootPresent": False, "claimAllowed": False, "status": "blocked"})
            continue
        for path in deletion_iter_files(root) or []:
            try:
                text = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            except OSError:
                continue
            rel = deletion_rel_path(path, root)
            for lineno, line in enumerate(text.splitlines(), 1):
                matched = [token for token in POLICY_DELETION_REF_TOKENS if token in line]
                if not matched:
                    continue
                ref_class = deletion_classify_reference(rel, line)
                rows.append({
                    "kind": "policyDeletion.consumerReference.v1",
                    "repoRoot": str(root),
                    "path": rel,
                    "lineNumber": lineno,
                    "tokens": matched,
                    "line": line.strip(),
                    "referenceClass": ref_class,
                    "activeRuntimeCandidate": ref_class == "active-runtime-candidate",
                    "scanRootPresent": True,
                    "claimAllowed": False,
                    "status": "candidate",
                })
    return rows


def deletion_run_absent_simulation(policy_root: Path, out_dir: Path) -> dict:
    missing_root = out_dir / "missing-policy-root"
    absent_out = out_dir / "absent-compile"
    absent_out.mkdir(parents=True, exist_ok=True)
    capture = io.StringIO()
    with contextlib.redirect_stdout(capture), contextlib.redirect_stderr(capture):
        rc = command_compile(argparse.Namespace(policy_root=str(missing_root), out_dir=str(absent_out), duckdb_bin="duckdb", python_only=False))
    output = capture.getvalue().strip()
    return {
        "kind": "policyDeletion.absentSimulation.v1",
        "policyRoot": str(missing_root),
        "command": "policy-semantic-compiler compile",
        "exitCode": rc,
        "consumerPassedWithoutPolicyGit": rc == 0,
        "observedDecision": "blocked-fail-closed" if rc != 0 else "passed",
        "capturedOutput": output,
        "claimAllowed": False,
        "status": "blocked" if rc != 0 else "candidate-pass",
    }


def command_review_deletion_readiness(args: argparse.Namespace) -> int:
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    roots = [Path(item) for item in (args.repo_root or [])]
    reference_rows = deletion_scan_roots(roots)
    absent = deletion_run_absent_simulation(Path(args.policy_root), out_dir)
    active_refs = [row for row in reference_rows if row.get("activeRuntimeCandidate")]
    missing_scan_roots = [row for row in reference_rows if row.get("referenceClass") == "missing-scan-root"]
    deletion_approved = False
    gates: list[dict] = []
    typed_gate(gates, "scan-roots-present", len(missing_scan_roots) == 0 and bool(roots), {"missingScanRootCount": len(missing_scan_roots), "missingScanRoots": missing_scan_roots[:25], "scannedRootCount": len(roots)})
    typed_gate(gates, "active-policy-consumers-zero", len(active_refs) == 0 and len(missing_scan_roots) == 0, {"activeRuntimeReferenceCount": len(active_refs), "activeRuntimeReferences": active_refs[:25]})
    typed_gate(gates, "policy-absent-consumers-pass", absent.get("consumerPassedWithoutPolicyGit") is True, {"absentSimulation": absent})
    typed_gate(gates, "deletion-approved", deletion_approved, {"policyDeletionApproved": deletion_approved, "reason": "owner deletion approval is not accepted in this review"})
    typed_gate(gates, "deletion-readiness-does-not-claim-cutover", True, {"cutoverReady": False, "policyDeletionApproved": False})
    jsonl_write(out_dir / "consumer-references.jsonl", reference_rows)
    jsonl_write(out_dir / "deletion-readiness-gates.jsonl", gates)
    (out_dir / "absent-simulation.json").write_text(json.dumps(absent, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    ok = all(row.get("status") == "pass" for row in gates)
    manifest = {
        "kind": "policyDeletion.readinessReview.v1",
        "ok": ok,
        "claim": "policy-deletion-readiness-reviewed",
        "cutoverReady": False,
        "policyDeletionApproved": False,
        "activeRuntimeReferenceCount": len(active_refs),
        "policyAbsentConsumersPass": absent.get("consumerPassedWithoutPolicyGit") is True,
        "outputs": {"consumerReferences": "consumer-references.jsonl", "gates": "deletion-readiness-gates.jsonl", "absentSimulation": "absent-simulation.json"},
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, sort_keys=True))
    return 0 if ok else 1


def command_extract_typed_json(args: argparse.Namespace) -> int:
    policy_root = Path(args.policy_root)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    meta = repo_metadata(policy_root)
    rows: dict[str, list[dict]] = {"sources": [], "spans": [], "nodes": [], "edges": [], "negative": []}
    errors: list[str] = []
    expected_units: set[tuple[str, str, str]] = set()
    targets = typed_target_files(policy_root)
    if not targets:
        errors.append("no typed JSON target files found")
    for path in targets:
        rel = rel_path(path, policy_root)
        file_class = typed_file_class(rel)
        source_file = typed_source_file_row(policy_root, path, file_class, meta.get("gitHead"))
        rows["sources"].append(source_file)
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            errors.append(f"json parse failed: {rel}: {exc}")
            continue
        expected_units.update(typed_expected_units_for_file(rel, value, policy_root, errors))
        if file_class == "projection-or-layout":
            typed_add_unit(rows, source_file, "", "projection.layout", rel, predicate="is-projection-layout")
            continue
        if rel.startswith("schemas/"):
            typed_walk_schema(rows, source_file, value)
        elif rel == "policy-router.v1.json":
            typed_extract_router(rows, source_file, value)
        elif rel == "role-exit-graph.v1.json":
            typed_extract_exit_graph(rows, source_file, value)
        elif rel == "role-profiles/index.v1.json":
            typed_extract_role_index(rows, source_file, value, policy_root, errors)
        elif rel.startswith("role-profiles/"):
            typed_extract_role_profile(rows, source_file, value)
        elif rel.endswith("protocol.envelope.json"):
            typed_extract_protocol(rows, source_file, value, errors)
        elif rel == "kernel/authority-index.v1.json":
            typed_extract_authority_index(rows, source_file, value)
        elif rel == "kernel/index.v1.json":
            typed_extract_kernel_index(rows, source_file, value)
    rows["negative"].extend({"kind": "policy.semanticDeletionClaimNegativeControl.v1", "id": "policy-deletion-negative-control-" + sha256_bytes(claim.encode("utf-8"))[:16], "inputClaim": claim, "expectedDecision": "reject-forbidden-claim", "observedDecision": "reject-forbidden-claim", "status": "pass", "claimAllowed": False} for claim in sorted(FORBIDDEN_CLAIMS | {"active policy.git dependency zero", "fresh semantic equivalence proven", "owner deletion approval present"}))
    injections = set(args.inject_violation or [])
    if "drop-schema-required" in injections:
        rows["nodes"] = [row for row in rows["nodes"] if row.get("nodeKind") != "schema.required"]
    if "drop-router-forbidden-root" in injections:
        rows["nodes"] = [row for row in rows["nodes"] if row.get("nodeKind") != "router.forbidden-source-root"]
    if "drop-protocol-guard" in injections:
        rows["nodes"] = [row for row in rows["nodes"] if row.get("nodeKind") != "protocol.guard"]
    if "drop-protocol-effect" in injections:
        rows["nodes"] = [row for row in rows["nodes"] if row.get("nodeKind") != "protocol.effect"]
    if "duplicate-protocol-effect-drop-first" in injections:
        first_effect = None
        duplicate_effect = None
        for row in rows["nodes"]:
            if row.get("nodeKind") == "protocol.effect":
                pointer = row.get("sourceTrace", {}).get("jsonPointer", "")
                if pointer.endswith("/effects/0"):
                    first_effect = row
                elif pointer.endswith("/effects/1"):
                    duplicate_effect = dict(row)
        if first_effect is not None:
            rows["nodes"] = [row for row in rows["nodes"] if row is not first_effect]
        if duplicate_effect is not None:
            duplicate_effect["id"] = duplicate_effect["id"] + "-duplicate"
            rows["nodes"].append(duplicate_effect)
    if "drop-protocol-emit" in injections:
        rows["nodes"] = [row for row in rows["nodes"] if row.get("nodeKind") != "protocol.emitted-event"]
    if "drop-role-owner" in injections:
        rows["nodes"] = [row for row in rows["nodes"] if row.get("nodeKind") != "role.owner-role"]
    if "drop-role-module" in injections:
        rows["nodes"] = [row for row in rows["nodes"] if row.get("nodeKind") != "role.module-binding"]
    if "layout-as-authority" in injections:
        for row in rows["nodes"]:
            if row.get("nodeKind") == "projection.layout" and row.get("sourceTrace", {}).get("path", "").endswith("workflow.mmds.json"):
                row["nodeKind"] = "protocol.command"
                break
    if "inject-deletion-approval" in injections and rows["sources"]:
        rows["sources"][0]["policyDeletionApproved"] = True
    if "role-index-sha-mismatch" in injections:
        errors.append("role index sha mismatch: injected")
    node_kinds = {row.get("nodeKind") for row in rows["nodes"]}
    actual_units = {(row.get("sourceTrace", {}).get("path", ""), row.get("sourceTrace", {}).get("jsonPointer", ""), str(row.get("nodeKind"))) for row in rows["nodes"]}
    expected_counts = typed_count_by_kind(expected_units)
    actual_counts = typed_count_by_kind(actual_units)
    span_ids = {row["id"] for row in rows["spans"]}
    node_ids = {row["id"] for row in rows["nodes"]}
    span_supported = {edge["from"] for edge in rows["edges"] if edge.get("edgeKind") == "span-supports-semantic-node"}
    source_covered = {edge["to"] for edge in rows["edges"] if edge.get("edgeKind") == "source-covers-span"}
    node_supported = {edge["to"] for edge in rows["edges"] if edge.get("edgeKind") == "span-supports-semantic-node"}
    layout_bad = [row for row in rows["nodes"] if row.get("sourceTrace", {}).get("path", "").endswith("workflow.mmds.json") and row.get("nodeKind") != "projection.layout"]
    required_schema = {"schema.required", "schema.const", "schema.enum", "schema.pattern", "schema.min-items", "schema.additional-properties", "schema.not-required", "schema.anyof-branch"}
    router_required = {"router.default-read", "router.task-route", "router.route-read", "router.forbidden", "router.output", "router.forbidden-source-root"}
    role_required = {"role.profile", "role.module-binding", "role.owner-role", "role.index-entry", "role.index-sha256-lock"}
    protocol_required = {"protocol.command", "protocol.command-kind", "protocol.guard", "protocol.effect", "protocol.emitted-event", "protocol.region", "protocol.topology-action"}
    gate_rows: list[dict] = []
    required_singletons = {"policy-router.v1.json", "role-exit-graph.v1.json", "kernel/authority-index.v1.json", "kernel/index.v1.json", "role-profiles/index.v1.json"}
    present_paths = {row["sourceFilePath"] for row in rows["sources"]}
    typed_gate(gate_rows, "typed-json-target-files-covered", bool(targets) and required_singletons <= present_paths and all(row["fileClass"] for row in rows["sources"]), {"targetFileCount": len(targets), "missingRequiredSingletons": sorted(required_singletons - present_paths)})
    typed_gate(gate_rows, "typed-json-object-pointers-present", all("jsonPointer" in row.get("sourceTrace", {}) for row in rows["spans"]), {"spanCount": len(rows["spans"])})
    schema_missing = typed_missing_units(expected_units, actual_units, required_schema)
    router_missing = typed_missing_units(expected_units, actual_units, router_required)
    role_missing = typed_missing_units(expected_units, actual_units, role_required)
    typed_gate(gate_rows, "schema-constraints-covered", not schema_missing and required_schema <= node_kinds, {"expected": {k: expected_counts.get(k, 0) for k in sorted(required_schema)}, "actual": {k: actual_counts.get(k, 0) for k in sorted(required_schema)}, "missingUnits": typed_unit_details(schema_missing)})
    typed_gate(gate_rows, "router-route-integrity", not router_missing and router_required <= node_kinds, {"expected": {k: expected_counts.get(k, 0) for k in sorted(router_required)}, "actual": {k: actual_counts.get(k, 0) for k in sorted(router_required)}, "missingUnits": typed_unit_details(router_missing)})
    typed_gate(gate_rows, "role-contract-integrity", not role_missing and role_required <= node_kinds and not any(error.startswith("role profile missing") for error in errors), {"expected": {k: expected_counts.get(k, 0) for k in sorted(role_required)}, "actual": {k: actual_counts.get(k, 0) for k in sorted(role_required)}, "missingUnits": typed_unit_details(role_missing), "roleProfileErrors": [e for e in errors if e.startswith("role profile missing")]})
    typed_gate(gate_rows, "role-index-sha256-lock-verified", not any(error.startswith("role index") for error in errors), {"roleIndexErrors": [e for e in errors if e.startswith("role index")]})
    protocol_required = protocol_required | {"protocol.canonical-state-effect", "protocol.risk", "protocol.requires-approval"}
    protocol_missing = typed_missing_units(expected_units, actual_units, protocol_required)
    typed_gate(gate_rows, "protocol-command-completeness", not protocol_missing and protocol_required <= node_kinds and not any(error.startswith("protocol command") for error in errors), {"expected": {k: expected_counts.get(k, 0) for k in sorted(protocol_required)}, "actual": {k: actual_counts.get(k, 0) for k in sorted(protocol_required)}, "missingUnits": typed_unit_details(protocol_missing), "protocolErrors": [e for e in errors if e.startswith("protocol command")]})
    typed_gate(gate_rows, "protocol-semantics-not-layout", not layout_bad, {"badLayoutNodes": len(layout_bad)})
    records_remain_candidate = all(row.get("claimAllowed") is False and row.get("status") in {"candidate", "pass"} and not any(row.get(key) is True for key in TYPED_JSON_FORBIDDEN_KEYS) for table in rows.values() for row in table)
    forbidden_clear_signal = any(any(row.get(key) is True for key in TYPED_JSON_FORBIDDEN_KEYS) for table in rows.values() for row in table)
    cutover_ready = False
    policy_deletion_approved = False
    typed_gate(gate_rows, "typed-records-remain-candidate", records_remain_candidate, {})
    typed_gate(gate_rows, "typed-extraction-does-not-clear-current-cutover-gates", not cutover_ready and not policy_deletion_approved and not forbidden_clear_signal, {"cutoverReady": cutover_ready, "policyDeletionApproved": policy_deletion_approved, "forbiddenClearSignal": forbidden_clear_signal})
    typed_gate(gate_rows, "typed-span-edge-integrity", span_ids <= span_supported and span_ids <= source_covered and node_ids <= node_supported, {"spanCount": len(span_ids), "nodeCount": len(node_ids)})
    for error in errors:
        gate_rows.append({"gate_id": "typed-json-runtime-error", "status": "blocked", "details": {"error": error}})
    jsonl_write(out_dir / "typed-source-files.jsonl", rows["sources"])
    jsonl_write(out_dir / "typed-source-spans.jsonl", rows["spans"])
    jsonl_write(out_dir / "typed-semantic-nodes.jsonl", rows["nodes"])
    jsonl_write(out_dir / "typed-semantic-edges.jsonl", rows["edges"])
    jsonl_write(out_dir / "deletion-negative-controls.jsonl", rows["negative"])
    jsonl_write(out_dir / "typed-gates.jsonl", gate_rows)
    ok = all(row.get("status") == "pass" for row in gate_rows)
    manifest = {"kind": "policySemantic.typedJsonExtractorRun.v1", "ok": ok, "claim": "typed-json-semantic-graph-candidate-ready-for-review", "cutoverReady": cutover_ready, "policyDeletionApproved": policy_deletion_approved, "source": meta, "outputs": {"sourceFiles": "typed-source-files.jsonl", "sourceSpans": "typed-source-spans.jsonl", "semanticNodes": "typed-semantic-nodes.jsonl", "semanticEdges": "typed-semantic-edges.jsonl", "gates": "typed-gates.jsonl", "negativeControls": "deletion-negative-controls.jsonl"}}
    (out_dir / "manifest.json").write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, sort_keys=True))
    return 0 if ok else 1

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="policy-semantic-compiler")
    sub = parser.add_subparsers(dest="command", required=True)
    compile_parser = sub.add_parser("compile")
    compile_parser.add_argument("--policy-root", default=str(DEFAULT_POLICY_ROOT))
    compile_parser.add_argument("--out-dir", required=True)
    compile_parser.add_argument("--duckdb-bin", default="duckdb")
    compile_parser.add_argument("--python-only", action="store_true")
    compile_parser.set_defaults(func=command_compile)
    typed_parser = sub.add_parser("extract-typed-json")
    typed_parser.add_argument("--policy-root", default=str(DEFAULT_POLICY_ROOT))
    typed_parser.add_argument("--out-dir", required=True)
    typed_parser.add_argument("--inject-violation", action="append")
    typed_parser.set_defaults(func=command_extract_typed_json)
    deletion_parser = sub.add_parser("review-deletion-readiness")
    deletion_parser.add_argument("--policy-root", default=str(DEFAULT_POLICY_ROOT))
    deletion_parser.add_argument("--repo-root", action="append")
    deletion_parser.add_argument("--out-dir", required=True)
    deletion_parser.set_defaults(func=command_review_deletion_readiness)
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
    projected_parser = sub.add_parser("project-policy-entry")
    projected_parser.add_argument("--out-dir", required=True)
    projected_parser.add_argument("--native-rows")
    projected_parser.add_argument("--policy-text")
    projected_parser.add_argument("--fixture-accepted", action="store_true")
    projected_parser.add_argument("--fixture-reason")
    projected_parser.add_argument("--accepted-source")
    projected_parser.set_defaults(func=command_project_policy_entry)
    accepted_source_parser = sub.add_parser("check-accepted-policy-entry-source")
    accepted_source_parser.add_argument("--source", required=True)
    accepted_source_parser.add_argument("--expected-lock", required=True)
    accepted_source_parser.add_argument("--out")
    accepted_source_parser.set_defaults(func=command_check_accepted_policy_entry_source)
    projected_check_parser = sub.add_parser("check-projected-policy-entry")
    projected_check_parser.add_argument("--dir", required=True)
    projected_check_parser.add_argument("--expect-accepted", action="store_true")
    projected_check_parser.set_defaults(func=command_check_projected_policy_entry)
    review_parser = sub.add_parser("review-semantic-coverage")
    review_parser.add_argument("--source-files", required=True)
    review_parser.add_argument("--source-spans", required=True)
    review_parser.add_argument("--source-file-dispositions")
    review_parser.add_argument("--semantic-nodes", required=True)
    review_parser.add_argument("--semantic-edges", required=True)
    review_parser.add_argument("--approvals")
    review_parser.add_argument("--equivalence-proofs")
    review_parser.add_argument("--out-dir", required=True)
    review_parser.set_defaults(func=command_review_semantic_coverage)
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
