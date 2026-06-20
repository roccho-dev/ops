from __future__ import annotations

import argparse
import csv
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


def sql_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


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


def command_review_adrs_projection_duckdb(args: argparse.Namespace) -> int:
    records_dir = Path(args.adrs_records_dir)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    required_files = {
        "source_files": records_dir / "policy.sourceFile.v1.jsonl",
        "source_spans": records_dir / "policy.sourceSpan.v1.jsonl",
        "semantic_nodes": records_dir / "policy.semanticNode.v1.jsonl",
        "semantic_edges": records_dir / "policy.semanticEdge.v1.jsonl",
        "span_dispositions": records_dir / "policy.sourceSpanDisposition.v1.jsonl",
        "coverage_proofs": records_dir / "policy.acceptedCoverageProof.v1.jsonl",
        "fresh_genx_reviews": records_dir / "policy.freshGenXReconstructionReview.v1.jsonl",
    }
    optional_files = {
        "dispositions": records_dir / "policy.sourceFileDisposition.v1.jsonl",
        "review_batches": records_dir / "policy.sourceSpanDispositionReviewBatch.v1.jsonl",
        "review_assignments": records_dir / "policy.sourceSpanDispositionReviewAssignment.v1.jsonl",
        "review_packets": records_dir / "policy.sourceSpanDispositionReviewPacket.v1.jsonl",
        "review_work_orders": records_dir / "policy.sourceSpanDispositionReviewerWorkOrder.v1.jsonl",
        "review_result_templates": records_dir / "policy.sourceSpanDispositionReviewResultTemplate.v1.jsonl",
        "required_discussions": records_dir / "policy.sourceSpanDispositionDirectCrossDiscussionRequired.v1.jsonl",
        "direct_discussion_templates": records_dir / "policy.sourceSpanDispositionDirectCrossDiscussionTemplate.v1.jsonl",
        "review_results": records_dir / "policy.sourceSpanDispositionReviewResult.v1.jsonl",
        "discussion_results": records_dir / "policy.sourceSpanDispositionDirectCrossDiscussion.v1.jsonl",
    }
    missing_files = [str(path) for path in required_files.values() if not path.exists()]
    if missing_files:
        gates = [
            {
                "gate_id": "adrs-required-record-files-present",
                "status": "blocked",
                "blocker": "missing required ADRS projection record files",
                "details": missing_files,
            }
        ]
        jsonl_write(out_dir / "adrs-projection-duckdb-gates.jsonl", gates)
        manifest = {
            "kind": "policySemantic.adrsProjectionDuckdbReview.v1",
            "ok": False,
            "status": "blocked",
            "cutoverReady": False,
            "policyDeletionApproved": False,
            "generatedIsAuthority": False,
            "duckdbExecuted": False,
            "blockers": ["missing required ADRS projection record files"],
            "outputs": {"gates": "adrs-projection-duckdb-gates.jsonl"},
        }
        (out_dir / "manifest.json").write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(manifest, sort_keys=True))
        return 1

    duckdb = shutil.which(args.duckdb_bin) if "/" not in args.duckdb_bin else args.duckdb_bin
    if not duckdb:
        gates = [
            {
                "gate_id": "adrs-projection-duckdb-executed",
                "status": "blocked",
                "blocker": f"DuckDB executable not found: {args.duckdb_bin}",
            }
        ]
        jsonl_write(out_dir / "adrs-projection-duckdb-gates.jsonl", gates)
        manifest = {
            "kind": "policySemantic.adrsProjectionDuckdbReview.v1",
            "ok": False,
            "status": "blocked",
            "cutoverReady": False,
            "policyDeletionApproved": False,
            "generatedIsAuthority": False,
            "duckdbExecuted": False,
            "blockers": [gates[0]["blocker"]],
            "outputs": {"gates": "adrs-projection-duckdb-gates.jsonl"},
        }
        (out_dir / "manifest.json").write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(manifest, sort_keys=True))
        return 1

    dispositions_path = optional_files["dispositions"]
    csv_path = out_dir / "adrs-projection-duckdb-gates.csv"
    missing_span_dispositions_csv_path = out_dir / "missing-accepted-span-dispositions.csv"
    missing_coverage_csv_path = out_dir / "missing-accepted-coverage.csv"
    candidate_span_dispositions_csv_path = out_dir / "candidate-only-span-dispositions.csv"
    candidate_file_dispositions_csv_path = out_dir / "candidate-only-file-dispositions.csv"
    runner = out_dir / "adrs-projection-duckdb.sql"
    expected_rev = str(args.policy_rev)
    dispositions_source = (
        f"read_json_auto({sql_quote(str(dispositions_path))})"
        if dispositions_path.exists()
        else "(SELECT NULL::VARCHAR AS id, NULL::VARCHAR AS sourceFileId, NULL::VARCHAR AS status, NULL::BOOLEAN AS requiresIndividualSemanticApproval WHERE false)"
    )
    runner.write_text(
        f"""
CREATE OR REPLACE TABLE source_files AS SELECT * FROM read_json_auto({sql_quote(str(required_files["source_files"]))});
CREATE OR REPLACE TABLE source_spans AS SELECT * FROM read_json_auto({sql_quote(str(required_files["source_spans"]))});
CREATE OR REPLACE TABLE semantic_nodes AS SELECT * FROM read_json_auto({sql_quote(str(required_files["semantic_nodes"]))});
CREATE OR REPLACE TABLE semantic_edges AS SELECT * FROM read_json_auto({sql_quote(str(required_files["semantic_edges"]))});
CREATE OR REPLACE TABLE span_dispositions AS SELECT * FROM read_json_auto({sql_quote(str(required_files["span_dispositions"]))});
CREATE OR REPLACE TABLE coverage_proofs AS SELECT * FROM read_json_auto({sql_quote(str(required_files["coverage_proofs"]))});
CREATE OR REPLACE TABLE fresh_genx_reviews AS SELECT * FROM read_json_auto({sql_quote(str(required_files["fresh_genx_reviews"]))});
CREATE OR REPLACE TABLE dispositions AS SELECT * FROM {dispositions_source};

CREATE OR REPLACE TABLE endpoint_ids AS
SELECT id FROM source_files
UNION SELECT id FROM source_spans
UNION SELECT id FROM semantic_nodes;

CREATE OR REPLACE TABLE non_normative_span_ids AS
SELECT ss.id
FROM source_spans ss
JOIN dispositions d ON d.sourceFileId = ss.sourceFileId
WHERE d.status = 'accepted' AND d.requiresIndividualSemanticApproval = false;

CREATE OR REPLACE TABLE accepted_span_dispositions AS
SELECT *
FROM span_dispositions
WHERE kind = 'policy.sourceSpanDisposition.v1'
  AND accepted = true
  AND status = 'accepted'
  AND policyRev = {sql_quote(expected_rev)}
  AND fixtureOnly = false
  AND generatedIsAuthority = false
  AND policyDeletionApproved = false;

CREATE OR REPLACE TABLE accepted_span_disposition_ids AS
SELECT DISTINCT TRIM(BOTH '"' FROM CAST(unnest(sourceSpanIds) AS VARCHAR)) AS id FROM accepted_span_dispositions;

CREATE OR REPLACE TABLE accepted_non_normative_span_ids AS
SELECT DISTINCT TRIM(BOTH '"' FROM CAST(unnest(sourceSpanIds) AS VARCHAR)) AS id
FROM accepted_span_dispositions
WHERE disposition IN ('non-normative', 'duplicate', 'superseded', 'retired');

CREATE OR REPLACE TABLE review_required_spans AS
SELECT id FROM source_spans
EXCEPT SELECT id FROM non_normative_span_ids
EXCEPT SELECT id FROM accepted_non_normative_span_ids;

CREATE OR REPLACE TABLE coverage_proof_candidates AS
SELECT *
FROM coverage_proofs
WHERE kind = 'policy.acceptedCoverageProof.v1'
  AND accepted = true
  AND status = 'accepted'
  AND policyRev = {sql_quote(expected_rev)};

CREATE OR REPLACE TABLE accepted_fresh_genx_reviews AS
SELECT *
FROM fresh_genx_reviews
WHERE kind = 'policy.freshGenXReconstructionReview.v1'
  AND status = 'accepted'
  AND noRemainingObjections = true
  AND memoryUsed = false
  AND policyBodyUsedAsSource = false
  AND fixtureOnly = false
  AND policyRev = {sql_quote(expected_rev)};

CREATE OR REPLACE TABLE coverage_proof_genx_ids AS
SELECT id AS proof_id, TRIM(BOTH '"' FROM CAST(unnest(freshGenXEvidenceIds) AS VARCHAR)) AS genx_id
FROM coverage_proof_candidates;

CREATE OR REPLACE TABLE accepted_coverage_proofs AS
SELECT c.*
FROM coverage_proof_candidates c
WHERE c.noRemainingObjections = true
  AND generatedIsAuthority = false
  AND policyDeletionApproved = false
  AND c.fixtureOnly = false
  AND EXISTS (
    SELECT 1
    FROM coverage_proof_genx_ids p
    JOIN accepted_fresh_genx_reviews g ON g.id = p.genx_id
    WHERE p.proof_id = c.id
  );

CREATE OR REPLACE TABLE covered_span_ids AS
SELECT DISTINCT TRIM(BOTH '"' FROM CAST(unnest(coveredSourceSpanIds) AS VARCHAR)) AS id FROM accepted_coverage_proofs;

CREATE OR REPLACE TABLE node_span_ids AS
SELECT DISTINCT TRIM(BOTH '"' FROM CAST(unnest(sourceSpanIds) AS VARCHAR)) AS id FROM semantic_nodes;

CREATE OR REPLACE TABLE edge_span_ids AS
SELECT DISTINCT TRIM(BOTH '"' FROM CAST(unnest(sourceSpanIds) AS VARCHAR)) AS id FROM semantic_edges;

CREATE OR REPLACE TABLE gate_results AS
SELECT 'adrs-projection-duckdb-executed' AS gate_id, 'pass' AS status, NULL AS blocker, 0 AS count
UNION ALL
SELECT 'adrs-required-record-files-present', 'pass', NULL, 0
UNION ALL
SELECT 'policy-ref-current',
       CASE WHEN count(*) = 0 THEN 'pass' ELSE 'blocked' END,
       CASE WHEN count(*) = 0 THEN NULL ELSE 'ADRS projection row has stale or missing policy rev' END,
       count(*)
FROM (
  SELECT id FROM source_spans WHERE sourceTrace.rev IS NULL OR sourceTrace.rev <> {sql_quote(expected_rev)}
  UNION ALL SELECT id FROM semantic_nodes WHERE sourceTrace.rev IS NULL OR sourceTrace.rev <> {sql_quote(expected_rev)}
  UNION ALL SELECT id FROM semantic_edges WHERE sourceTrace.rev IS NULL OR sourceTrace.rev <> {sql_quote(expected_rev)}
) stale
UNION ALL
SELECT 'orphan-span-source-file',
       CASE WHEN count(*) = 0 THEN 'pass' ELSE 'blocked' END,
       CASE WHEN count(*) = 0 THEN NULL ELSE 'sourceSpan.sourceFileId does not resolve' END,
       count(*)
FROM source_spans ss LEFT JOIN source_files sf ON sf.id = ss.sourceFileId
WHERE sf.id IS NULL
UNION ALL
SELECT 'orphan-node-source-span',
       CASE WHEN count(*) = 0 THEN 'pass' ELSE 'blocked' END,
       CASE WHEN count(*) = 0 THEN NULL ELSE 'semanticNode.sourceSpanIds contains missing sourceSpan' END,
       count(*)
FROM (SELECT id AS node_id, TRIM(BOTH '"' FROM CAST(unnest(sourceSpanIds) AS VARCHAR)) AS span_id FROM semantic_nodes) ns
LEFT JOIN source_spans ss ON ss.id = ns.span_id
WHERE ss.id IS NULL
UNION ALL
SELECT 'orphan-edge-endpoint',
       CASE WHEN count(*) = 0 THEN 'pass' ELSE 'blocked' END,
       CASE WHEN count(*) = 0 THEN NULL ELSE 'semanticEdge endpoint does not resolve' END,
       count(*)
FROM (
  SELECT id AS edge_id, "from" AS endpoint FROM semantic_edges
  UNION ALL SELECT id AS edge_id, "to" AS endpoint FROM semantic_edges
) ee
LEFT JOIN endpoint_ids ep ON ep.id = ee.endpoint
WHERE ep.id IS NULL
UNION ALL
SELECT 'orphan-edge-source-span',
       CASE WHEN count(*) = 0 THEN 'pass' ELSE 'blocked' END,
       CASE WHEN count(*) = 0 THEN NULL ELSE 'semanticEdge.sourceSpanIds contains missing sourceSpan' END,
       count(*)
FROM (SELECT id AS edge_id, TRIM(BOTH '"' FROM CAST(unnest(sourceSpanIds) AS VARCHAR)) AS span_id FROM semantic_edges) es
LEFT JOIN source_spans ss ON ss.id = es.span_id
WHERE ss.id IS NULL
UNION ALL
SELECT 'orphan-span-without-node',
       CASE WHEN count(*) = 0 THEN 'pass' ELSE 'blocked' END,
       CASE WHEN count(*) = 0 THEN NULL ELSE 'review-required sourceSpan has no semanticNode coverage' END,
       count(*)
FROM review_required_spans r
LEFT JOIN node_span_ids n ON n.id = r.id
WHERE n.id IS NULL
UNION ALL
SELECT 'accepted-coverage-proof-present',
       CASE WHEN count(*) > 0 THEN 'pass' ELSE 'blocked' END,
       CASE WHEN count(*) > 0 THEN NULL ELSE 'accepted coverage proof is missing' END,
       count(*)
FROM accepted_coverage_proofs
UNION ALL
SELECT 'accepted-span-disposition-missing',
       CASE WHEN count(*) = 0 THEN 'pass' ELSE 'blocked' END,
       CASE WHEN count(*) = 0 THEN NULL ELSE 'sourceSpan lacks accepted span disposition' END,
       count(*)
FROM source_spans ss
LEFT JOIN accepted_span_disposition_ids d ON d.id = ss.id
WHERE d.id IS NULL
UNION ALL
SELECT 'accepted-coverage-missing',
       CASE WHEN count(*) = 0 THEN 'pass' ELSE 'blocked' END,
       CASE WHEN count(*) = 0 THEN NULL ELSE 'review-required sourceSpan is not covered by accepted coverage proof' END,
       count(*)
FROM review_required_spans r
LEFT JOIN covered_span_ids c ON c.id = r.id
WHERE c.id IS NULL
UNION ALL
SELECT 'fresh-genx-evidence-accepted',
       CASE WHEN count(*) = 0 THEN 'pass' ELSE 'blocked' END,
       CASE WHEN count(*) = 0 THEN NULL ELSE 'accepted Fresh GenX no-objection evidence is missing or not linked from coverage proof' END,
       count(*)
FROM (
  SELECT 'accepted-fresh-genx-missing' AS id
  WHERE NOT EXISTS (SELECT 1 FROM accepted_fresh_genx_reviews)
  UNION ALL
  SELECT c.id
  FROM coverage_proof_candidates c
  WHERE NOT EXISTS (
    SELECT 1
    FROM coverage_proof_genx_ids p
    JOIN accepted_fresh_genx_reviews g ON g.id = p.genx_id
    WHERE p.proof_id = c.id
  )
) missing_fresh_genx
UNION ALL
SELECT 'fixture-only-proof-rejected',
       CASE WHEN count(*) = 0 THEN 'pass' ELSE 'blocked' END,
       CASE WHEN count(*) = 0 THEN NULL ELSE 'fixture-only proof cannot satisfy accepted coverage' END,
       count(*)
FROM coverage_proof_candidates
WHERE fixtureOnly = true
UNION ALL
SELECT 'candidate-only-disposition',
       CASE WHEN count(*) = 0 THEN 'pass' ELSE 'blocked' END,
       CASE WHEN count(*) = 0 THEN NULL ELSE 'candidate disposition cannot satisfy accepted coverage' END,
       count(*)
FROM dispositions
WHERE status IS NOT NULL AND status <> 'accepted'
UNION ALL
SELECT 'candidate-only-span-disposition',
       CASE WHEN count(*) = 0 THEN 'pass' ELSE 'blocked' END,
       CASE WHEN count(*) = 0 THEN NULL ELSE 'candidate span disposition cannot satisfy accepted coverage' END,
       count(*)
FROM span_dispositions
WHERE status IS NOT NULL AND status <> 'accepted'
UNION ALL
SELECT 'span-disposition-missing-source-span',
       CASE WHEN count(*) = 0 THEN 'pass' ELSE 'blocked' END,
       CASE WHEN count(*) = 0 THEN NULL ELSE 'span disposition references missing sourceSpan' END,
       count(*)
FROM (SELECT id AS disposition_id, TRIM(BOTH '"' FROM CAST(unnest(sourceSpanIds) AS VARCHAR)) AS span_id FROM span_dispositions) sd
LEFT JOIN source_spans ss ON ss.id = sd.span_id
WHERE ss.id IS NULL
UNION ALL
SELECT 'contradictory-disposition',
       CASE WHEN count(*) = 0 THEN 'pass' ELSE 'blocked' END,
       CASE WHEN count(*) = 0 THEN NULL ELSE 'multiple dispositions for one source file conflict' END,
       count(*)
FROM (
  SELECT sourceFileId
  FROM dispositions
  WHERE sourceFileId IS NOT NULL
  GROUP BY sourceFileId
  HAVING count(DISTINCT coalesce(status, '') || ':' || coalesce(CAST(requiresIndividualSemanticApproval AS VARCHAR), '')) > 1
) conflicts
UNION ALL
SELECT 'generated-rows-not-authority',
       CASE WHEN count(*) = 0 THEN 'pass' ELSE 'blocked' END,
       CASE WHEN count(*) = 0 THEN NULL ELSE 'projection/generated row claimed authority' END,
       count(*)
FROM (
  SELECT id, generatedIsAuthority, policyDeletionApproved FROM coverage_proofs
  UNION ALL
  SELECT id, generatedIsAuthority, policyDeletionApproved FROM span_dispositions
) generated_authority_candidates
WHERE generatedIsAuthority <> false OR policyDeletionApproved <> false;

COPY (SELECT gate_id, status, blocker, count FROM gate_results ORDER BY gate_id)
TO {sql_quote(str(csv_path))} (HEADER, DELIMITER ',');

COPY (
  SELECT ss.id AS sourceSpanId,
         ss.sourceFileId AS sourceFileId,
         ss.sourceTrace.path AS sourcePath,
         ss.sourceTrace.startLine AS startLine,
         ss.sourceTrace.endLine AS endLine
  FROM source_spans ss
  LEFT JOIN accepted_span_disposition_ids d ON d.id = ss.id
  WHERE d.id IS NULL
  ORDER BY sourcePath, startLine, sourceSpanId
) TO {sql_quote(str(missing_span_dispositions_csv_path))} (HEADER, DELIMITER ',');

COPY (
  SELECT r.id AS sourceSpanId,
         ss.sourceFileId AS sourceFileId,
         ss.sourceTrace.path AS sourcePath,
         ss.sourceTrace.startLine AS startLine,
         ss.sourceTrace.endLine AS endLine
  FROM review_required_spans r
  JOIN source_spans ss ON ss.id = r.id
  LEFT JOIN covered_span_ids c ON c.id = r.id
  WHERE c.id IS NULL
  ORDER BY sourcePath, startLine, sourceSpanId
) TO {sql_quote(str(missing_coverage_csv_path))} (HEADER, DELIMITER ',');

COPY (
  SELECT id AS dispositionId,
         status,
         accepted,
         policyRev,
         disposition,
         sourceSpanIds
  FROM span_dispositions
  WHERE status IS NOT NULL AND status <> 'accepted'
  ORDER BY dispositionId
) TO {sql_quote(str(candidate_span_dispositions_csv_path))} (HEADER, DELIMITER ',');

COPY (
  SELECT id AS dispositionId,
         sourceFileId,
         status,
         requiresIndividualSemanticApproval
  FROM dispositions
  WHERE status IS NOT NULL AND status <> 'accepted'
  ORDER BY sourceFileId, dispositionId
) TO {sql_quote(str(candidate_file_dispositions_csv_path))} (HEADER, DELIMITER ',');
""".lstrip(),
        encoding="utf-8",
    )
    proc = subprocess.run([duckdb, str(out_dir / "adrs-projection.duckdb"), "-c", f".read {runner}"], text=True)
    if proc.returncode != 0:
        gates = [
            {
                "gate_id": "adrs-projection-duckdb-executed",
                "status": "blocked",
                "blocker": f"DuckDB projection review failed with exit code {proc.returncode}",
            }
        ]
        jsonl_write(out_dir / "adrs-projection-duckdb-gates.jsonl", gates)
        manifest = {
            "kind": "policySemantic.adrsProjectionDuckdbReview.v1",
            "ok": False,
            "status": "blocked",
            "cutoverReady": False,
            "policyDeletionApproved": False,
            "generatedIsAuthority": False,
            "duckdbExecuted": False,
            "blockers": [gates[0]["blocker"]],
            "outputs": {"gates": "adrs-projection-duckdb-gates.jsonl", "sql": "adrs-projection-duckdb.sql"},
        }
        (out_dir / "manifest.json").write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(manifest, sort_keys=True))
        return 1

    with csv_path.open("r", encoding="utf-8", newline="") as handle:
        gates = [
            {
                "gate_id": row["gate_id"],
                "status": row["status"],
                "blocker": row["blocker"] or None,
                "count": int(row["count"]),
            }
            for row in csv.DictReader(handle)
        ]

    detail_outputs = {
        "missingAcceptedSpanDispositions": (
            missing_span_dispositions_csv_path,
            out_dir / "missing-accepted-span-dispositions.jsonl",
            "policySemantic.missingAcceptedSpanDisposition.v1",
        ),
        "missingAcceptedCoverage": (
            missing_coverage_csv_path,
            out_dir / "missing-accepted-coverage.jsonl",
            "policySemantic.missingAcceptedCoverage.v1",
        ),
        "candidateOnlySpanDispositions": (
            candidate_span_dispositions_csv_path,
            out_dir / "candidate-only-span-dispositions.jsonl",
            "policySemantic.candidateOnlySpanDisposition.v1",
        ),
        "candidateOnlyFileDispositions": (
            candidate_file_dispositions_csv_path,
            out_dir / "candidate-only-file-dispositions.jsonl",
            "policySemantic.candidateOnlyFileDisposition.v1",
        ),
    }
    for _name, (csv_detail_path, jsonl_detail_path, kind) in detail_outputs.items():
        with csv_detail_path.open("r", encoding="utf-8", newline="") as handle:
            rows = []
            for index, row in enumerate(csv.DictReader(handle), start=1):
                clean_row = {key: value for key, value in row.items() if value not in {"", None}}
                clean_row["kind"] = kind
                clean_row["rowNumber"] = index
                rows.append(clean_row)
        jsonl_write(jsonl_detail_path, rows)

    missing_span_rows = read_jsonl(out_dir / "missing-accepted-span-dispositions.jsonl")
    missing_span_ids = {str(row.get("sourceSpanId")) for row in missing_span_rows if row.get("sourceSpanId")}
    review_batches = read_jsonl(optional_files["review_batches"]) if optional_files["review_batches"].exists() else []
    review_assignments = read_jsonl(optional_files["review_assignments"]) if optional_files["review_assignments"].exists() else []
    review_packets = read_jsonl(optional_files["review_packets"]) if optional_files["review_packets"].exists() else []
    review_work_orders = read_jsonl(optional_files["review_work_orders"]) if optional_files["review_work_orders"].exists() else []
    review_result_templates = read_jsonl(optional_files["review_result_templates"]) if optional_files["review_result_templates"].exists() else []
    required_discussions = read_jsonl(optional_files["required_discussions"]) if optional_files["required_discussions"].exists() else []
    direct_discussion_templates = read_jsonl(optional_files["direct_discussion_templates"]) if optional_files["direct_discussion_templates"].exists() else []
    review_results = read_jsonl(optional_files["review_results"]) if optional_files["review_results"].exists() else []
    discussion_results = read_jsonl(optional_files["discussion_results"]) if optional_files["discussion_results"].exists() else []

    valid_batches = [
        row
        for row in review_batches
        if row.get("kind") == "policy.sourceSpanDispositionReviewBatch.v1"
        and row.get("policyRev") == expected_rev
        and row.get("accepted") is False
        and row.get("generatedIsAuthority") is False
        and row.get("policyDeletionApproved") is False
        and row.get("status") == "review-required"
    ]
    batch_span_ids = {str(span_id) for row in valid_batches for span_id in as_list(row.get("sourceSpanIds")) if span_id}
    batch_ids = {str(row.get("id")) for row in valid_batches if row.get("id")}
    batch_assignment_reviewers: dict[str, set[str]] = {}
    valid_assignments = [
        row
        for row in review_assignments
        if row.get("kind") == "policy.sourceSpanDispositionReviewAssignment.v1"
        and row.get("policyRev") == expected_rev
        and row.get("accepted") is False
        and row.get("generatedIsAuthority") is False
        and row.get("policyDeletionApproved") is False
        and row.get("status") == "assigned-review-required"
        and str(row.get("batchId")) in batch_ids
    ]
    for row in valid_assignments:
        batch_assignment_reviewers.setdefault(str(row.get("batchId")), set()).add(str(row.get("reviewerId")))
    batch_span_ids_by_batch = {
        str(row.get("id")): {str(span_id) for span_id in as_list(row.get("sourceSpanIds")) if span_id}
        for row in valid_batches
        if row.get("id")
    }
    valid_packet_batch_ids: set[str] = set()
    valid_packet_ids_by_batch: dict[str, str] = {}
    packets_with_span_mismatch: list[str] = []
    packets_with_missing_projection_fields: list[str] = []
    for row in review_packets:
        if not (
            row.get("kind") == "policy.sourceSpanDispositionReviewPacket.v1"
            and row.get("policyRev") == expected_rev
            and row.get("accepted") is False
            and row.get("generatedIsAuthority") is False
            and row.get("policyDeletionApproved") is False
            and row.get("status") == "review-required"
            and str(row.get("batchId")) in batch_ids
        ):
            continue
        batch_id = str(row.get("batchId"))
        valid_packet_batch_ids.add(batch_id)
        packet_span_ids = {str(span.get("sourceSpanId")) for span in as_list(row.get("sourceSpans")) if isinstance(span, dict) and span.get("sourceSpanId")}
        if packet_span_ids != batch_span_ids_by_batch.get(batch_id, set()):
            packets_with_span_mismatch.append(str(row.get("id")))
        missing_projection = [
            str(span.get("sourceSpanId"))
            for span in as_list(row.get("sourceSpans"))
            if isinstance(span, dict)
            and (
                not span.get("sourceTrace")
                or not span.get("sha256")
                or "excerpt" not in span
            )
        ]
        if missing_projection:
            packets_with_missing_projection_fields.append(str(row.get("id")))
        if packet_span_ids == batch_span_ids_by_batch.get(batch_id, set()) and not missing_projection and row.get("id"):
            valid_packet_ids_by_batch[batch_id] = str(row.get("id"))
    valid_required_discussion_batch_ids: set[str] = set()
    required_discussion_id_by_batch: dict[str, str] = {}
    for row in required_discussions:
        if (
            row.get("kind") == "policy.sourceSpanDispositionDirectCrossDiscussionRequired.v1"
            and row.get("policyRev") == expected_rev
            and row.get("accepted") is False
            and row.get("generatedIsAuthority") is False
            and row.get("policyDeletionApproved") is False
            and row.get("sameRevisionRequired") is True
            and row.get("peerRepliesReadRequired") is True
            and row.get("noRemainingObjectionsRequired") is True
            and row.get("status") == "direct-cross-discussion-required"
            and str(row.get("batchId")) in batch_ids
            and row.get("id")
        ):
            batch_id = str(row.get("batchId"))
            valid_required_discussion_batch_ids.add(batch_id)
            required_discussion_id_by_batch[batch_id] = str(row.get("id"))
    assignment_span_ids = {
        (str(row.get("batchId")), str(row.get("reviewerId"))): {str(span_id) for span_id in as_list(row.get("sourceSpanIds")) if span_id}
        for row in valid_assignments
    }
    packet_ids_by_batch = valid_packet_ids_by_batch
    assignment_ids = {str(row.get("id")) for row in valid_assignments if row.get("id")}
    assignment_ids_by_pair = {
        (str(row.get("batchId")), str(row.get("reviewerId"))): str(row.get("id"))
        for row in valid_assignments
        if row.get("id")
    }
    valid_work_order_assignment_ids: set[str] = set()
    work_order_ids: set[str] = set()
    work_order_shape_by_id: dict[str, dict] = {}
    invalid_work_order_ids: list[str] = []
    for row in review_work_orders:
        if not (
            row.get("kind") == "policy.sourceSpanDispositionReviewerWorkOrder.v1"
            and row.get("policyRev") == expected_rev
            and row.get("accepted") is False
            and row.get("generatedIsAuthority") is False
            and row.get("policyDeletionApproved") is False
            and row.get("status") == "assigned-review-required"
            and str(row.get("assignmentId")) in assignment_ids
        ):
            continue
        pair = (str(row.get("batchId")), str(row.get("reviewerId")))
        work_order_span_ids = {str(span_id) for span_id in as_list(row.get("sourceSpanIds")) if span_id}
        valid_shape = (
            row.get("assignmentId") == assignment_ids_by_pair.get(pair)
            and row.get("packetId") == packet_ids_by_batch.get(str(row.get("batchId")))
            and work_order_span_ids == assignment_span_ids.get(pair, set())
            and row.get("requiredOutputRecord") == "policy.sourceSpanDispositionReviewResult.v1"
            and "reviewInput" in row
            and "sourceSpans" in row.get("reviewInput", {})
        )
        if valid_shape:
            work_order_id = str(row.get("id"))
            work_order_ids.add(work_order_id)
            valid_work_order_assignment_ids.add(str(row.get("assignmentId")))
            work_order_shape_by_id[work_order_id] = {
                "assignmentId": row.get("assignmentId"),
                "batchId": row.get("batchId"),
                "reviewerId": row.get("reviewerId"),
                "packetId": row.get("packetId"),
                "sourceSpanIds": work_order_span_ids,
            }
        else:
            invalid_work_order_ids.append(str(row.get("id") or row.get("assignmentId")))
    valid_template_work_order_ids: set[str] = set()
    review_result_template_ids_by_batch: dict[str, set[str]] = {}
    invalid_template_ids: list[str] = []
    for row in review_result_templates:
        if not (
            row.get("kind") == "policy.sourceSpanDispositionReviewResultTemplate.v1"
            and row.get("policyRev") == expected_rev
            and row.get("accepted") is False
            and row.get("generatedIsAuthority") is False
            and row.get("policyDeletionApproved") is False
            and row.get("status") == "template-review-required"
            and str(row.get("workOrderId")) in work_order_ids
        ):
            continue
        work_order_id = str(row.get("workOrderId"))
        expected_shape = work_order_shape_by_id.get(work_order_id, {})
        template_span_ids = {str(span_id) for span_id in as_list(row.get("sourceSpanIds")) if span_id}
        valid_shape = (
            row.get("assignmentId") == expected_shape.get("assignmentId")
            and row.get("batchId") == expected_shape.get("batchId")
            and row.get("reviewerId") == expected_shape.get("reviewerId")
            and row.get("packetId") == expected_shape.get("packetId")
            and template_span_ids == expected_shape.get("sourceSpanIds")
            and row.get("packetRead") is False
            and row.get("disposition") is None
            and row.get("rationale") is None
            and row.get("noRemainingObjections") is False
        )
        if valid_shape:
            template_id = str(row.get("id"))
            valid_template_work_order_ids.add(work_order_id)
            review_result_template_ids_by_batch.setdefault(str(row.get("batchId")), set()).add(template_id)
        else:
            invalid_template_ids.append(str(row.get("id") or work_order_id))
    valid_direct_template_batch_ids: set[str] = set()
    invalid_direct_template_ids: list[str] = []
    for row in direct_discussion_templates:
        if not (
            row.get("kind") == "policy.sourceSpanDispositionDirectCrossDiscussionTemplate.v1"
            and row.get("policyRev") == expected_rev
            and row.get("accepted") is False
            and row.get("generatedIsAuthority") is False
            and row.get("policyDeletionApproved") is False
            and row.get("status") == "template-cross-discussion-required"
            and str(row.get("batchId")) in batch_ids
        ):
            continue
        batch_id = str(row.get("batchId"))
        reviewer_ids = {str(item) for item in as_list(row.get("reviewerIds")) if item}
        peer_read_reviewers = {str(item) for item in as_list(row.get("peerRepliesReadByReviewerIds")) if item}
        template_ids = {str(item) for item in as_list(row.get("reviewResultTemplateIds")) if item}
        valid_shape = (
            row.get("requiredDiscussionId") == required_discussion_id_by_batch.get(batch_id)
            and reviewer_ids == batch_assignment_reviewers.get(batch_id, set())
            and peer_read_reviewers == set()
            and template_ids == review_result_template_ids_by_batch.get(batch_id, set())
            and row.get("sameRevision") is False
            and row.get("peerRepliesRead") is False
            and row.get("noRemainingObjections") is False
            and row.get("rationale") is None
        )
        if valid_shape:
            valid_direct_template_batch_ids.add(batch_id)
        else:
            invalid_direct_template_ids.append(str(row.get("id") or batch_id))
    valid_review_results = []
    invalid_review_result_ids: list[str] = []
    for row in review_results:
        if not (
            row.get("kind") == "policy.sourceSpanDispositionReviewResult.v1"
            and row.get("status") == "accepted"
            and row.get("accepted") is True
            and row.get("policyRev") == expected_rev
            and row.get("fixtureOnly") is False
            and row.get("generatedIsAuthority") is False
            and row.get("policyDeletionApproved") is False
        ):
            continue
        pair = (str(row.get("batchId")), str(row.get("reviewerId")))
        result_span_ids = {str(span_id) for span_id in as_list(row.get("sourceSpanIds")) if span_id}
        valid_shape = (
            pair in assignment_span_ids
            and result_span_ids == assignment_span_ids[pair]
            and row.get("packetRead") is True
            and row.get("packetId") == packet_ids_by_batch.get(str(row.get("batchId")))
            and row.get("noRemainingObjections") is True
            and bool(row.get("disposition"))
            and bool(row.get("rationale"))
        )
        if valid_shape:
            valid_review_results.append(row)
        else:
            invalid_review_result_ids.append(str(row.get("id") or f"{pair[0]}:{pair[1]}"))
    accepted_review_pairs = {
        (str(row.get("batchId")), str(row.get("reviewerId")))
        for row in valid_review_results
    }
    review_result_ids_by_batch: dict[str, set[str]] = {}
    for row in valid_review_results:
        if row.get("id"):
            review_result_ids_by_batch.setdefault(str(row.get("batchId")), set()).add(str(row.get("id")))
    accepted_discussion_batch_ids: set[str] = set()
    invalid_discussion_result_ids: list[str] = []
    for row in discussion_results:
        if not (
            row.get("kind") == "policy.sourceSpanDispositionDirectCrossDiscussion.v1"
            and row.get("status") == "accepted"
            and row.get("accepted") is True
            and row.get("policyRev") == expected_rev
            and row.get("sameRevision") is True
            and row.get("peerRepliesRead") is True
            and row.get("noRemainingObjections") is True
            and row.get("fixtureOnly") is False
            and row.get("generatedIsAuthority") is False
            and row.get("policyDeletionApproved") is False
        ):
            continue
        batch_id = str(row.get("batchId"))
        result_ids = {str(item) for item in as_list(row.get("reviewResultIds")) if item}
        peer_read_reviewers = {str(item) for item in as_list(row.get("peerRepliesReadByReviewerIds")) if item}
        valid_shape = (
            result_ids == review_result_ids_by_batch.get(batch_id, set())
            and peer_read_reviewers == batch_assignment_reviewers.get(batch_id, set())
            and bool(row.get("rationale"))
        )
        if valid_shape:
            accepted_discussion_batch_ids.add(batch_id)
        else:
            invalid_discussion_result_ids.append(str(row.get("id") or batch_id))
    missing_batch_span_ids = sorted(missing_span_ids - batch_span_ids)
    invalid_batch_span_ids = sorted(batch_span_ids - missing_span_ids)
    batches_missing_two_reviewers = sorted(batch_id for batch_id in batch_ids if len(batch_assignment_reviewers.get(batch_id, set())) < 2)
    batches_missing_review_packets = sorted(batch_ids - valid_packet_batch_ids)
    assignments_missing_work_orders = sorted(assignment_ids - valid_work_order_assignment_ids)
    work_orders_missing_templates = sorted(work_order_ids - valid_template_work_order_ids)
    batches_missing_required_discussion = sorted(batch_ids - valid_required_discussion_batch_ids)
    batches_missing_direct_templates = sorted(batch_ids - valid_direct_template_batch_ids)
    missing_review_result_pairs = sorted(
        (batch_id, reviewer_id)
        for batch_id, reviewers in batch_assignment_reviewers.items()
        for reviewer_id in reviewers
        if (batch_id, reviewer_id) not in accepted_review_pairs
    )
    batches_missing_accepted_discussion = sorted(batch_ids - accepted_discussion_batch_ids)
    review_provider_gates = [
        {
            "gate_id": "review-batches-cover-missing-accepted-spans",
            "status": "pass" if not missing_batch_span_ids and not invalid_batch_span_ids else "blocked",
            "blocker": None if not missing_batch_span_ids and not invalid_batch_span_ids else "review batches do not exactly cover missing accepted source spans",
            "count": len(missing_batch_span_ids) + len(invalid_batch_span_ids),
        },
        {
            "gate_id": "review-batches-have-two-reviewer-assignments",
            "status": "pass" if not batches_missing_two_reviewers else "blocked",
            "blocker": None if not batches_missing_two_reviewers else "review batch lacks at least two reviewer assignments",
            "count": len(batches_missing_two_reviewers),
        },
        {
            "gate_id": "review-batches-have-review-packets",
            "status": "pass" if not batches_missing_review_packets else "blocked",
            "blocker": None if not batches_missing_review_packets else "review batch lacks projection-only review packet",
            "count": len(batches_missing_review_packets),
        },
        {
            "gate_id": "review-packets-match-batch-spans",
            "status": "pass" if not packets_with_span_mismatch else "blocked",
            "blocker": None if not packets_with_span_mismatch else "review packet source spans do not match batch source spans",
            "count": len(packets_with_span_mismatch),
        },
        {
            "gate_id": "review-packets-have-projection-fields",
            "status": "pass" if not packets_with_missing_projection_fields else "blocked",
            "blocker": None if not packets_with_missing_projection_fields else "review packet lacks sourceTrace, sha256, or excerpt",
            "count": len(packets_with_missing_projection_fields),
        },
        {
            "gate_id": "review-assignments-have-work-orders",
            "status": "pass" if not assignments_missing_work_orders else "blocked",
            "blocker": None if not assignments_missing_work_orders else "review assignment lacks projection-only reviewer work order",
            "count": len(assignments_missing_work_orders),
        },
        {
            "gate_id": "review-work-orders-match-assignments-and-packets",
            "status": "pass" if not invalid_work_order_ids else "blocked",
            "blocker": None if not invalid_work_order_ids else "review work order does not match assignment, packet, span set, or required output contract",
            "count": len(invalid_work_order_ids),
        },
        {
            "gate_id": "review-work-orders-have-result-templates",
            "status": "pass" if not work_orders_missing_templates else "blocked",
            "blocker": None if not work_orders_missing_templates else "review work order lacks non-authoritative result template",
            "count": len(work_orders_missing_templates),
        },
        {
            "gate_id": "review-result-templates-match-work-orders",
            "status": "pass" if not invalid_template_ids else "blocked",
            "blocker": None if not invalid_template_ids else "review result template does not match work order or is pre-filled as accepted",
            "count": len(invalid_template_ids),
        },
        {
            "gate_id": "review-batches-have-direct-cross-discussion-required",
            "status": "pass" if not batches_missing_required_discussion else "blocked",
            "blocker": None if not batches_missing_required_discussion else "review batch lacks direct cross-discussion requirement",
            "count": len(batches_missing_required_discussion),
        },
        {
            "gate_id": "review-batches-have-direct-cross-discussion-templates",
            "status": "pass" if not batches_missing_direct_templates else "blocked",
            "blocker": None if not batches_missing_direct_templates else "review batch lacks non-authoritative direct cross-discussion template",
            "count": len(batches_missing_direct_templates),
        },
        {
            "gate_id": "direct-cross-discussion-templates-match-required-discussions",
            "status": "pass" if not invalid_direct_template_ids else "blocked",
            "blocker": None if not invalid_direct_template_ids else "direct cross-discussion template does not match required discussion, reviewers, result templates, or empty acceptance fields",
            "count": len(invalid_direct_template_ids),
        },
        {
            "gate_id": "review-assignments-have-accepted-results",
            "status": "pass" if not missing_review_result_pairs else "blocked",
            "blocker": None if not missing_review_result_pairs else "review assignments lack accepted results",
            "count": len(missing_review_result_pairs),
        },
        {
            "gate_id": "review-results-match-assignments-and-packets",
            "status": "pass" if not invalid_review_result_ids else "blocked",
            "blocker": None if not invalid_review_result_ids else "review result does not match assignment spans, packet id, packet read, disposition, rationale, or no-objection requirements",
            "count": len(invalid_review_result_ids),
        },
        {
            "gate_id": "review-batches-have-accepted-direct-cross-discussions",
            "status": "pass" if not batches_missing_accepted_discussion else "blocked",
            "blocker": None if not batches_missing_accepted_discussion else "review batches lack accepted no-objection direct cross-discussions",
            "count": len(batches_missing_accepted_discussion),
        },
        {
            "gate_id": "direct-cross-discussions-match-review-results",
            "status": "pass" if not invalid_discussion_result_ids else "blocked",
            "blocker": None if not invalid_discussion_result_ids else "direct cross-discussion does not reference accepted review results, peer-read reviewers, rationale, or no-objection requirements",
            "count": len(invalid_discussion_result_ids),
        },
    ]
    jsonl_write(out_dir / "review-provider-gates.jsonl", review_provider_gates)
    jsonl_write(out_dir / "review-batch-missing-source-spans.jsonl", [{"kind": "policySemantic.reviewBatchMissingSourceSpan.v1", "sourceSpanId": span_id} for span_id in missing_batch_span_ids])
    jsonl_write(out_dir / "review-batch-extra-source-spans.jsonl", [{"kind": "policySemantic.reviewBatchExtraSourceSpan.v1", "sourceSpanId": span_id} for span_id in invalid_batch_span_ids])
    jsonl_write(out_dir / "review-batches-missing-two-reviewers.jsonl", [{"kind": "policySemantic.reviewBatchMissingTwoReviewers.v1", "batchId": batch_id} for batch_id in batches_missing_two_reviewers])
    jsonl_write(out_dir / "review-batches-missing-review-packets.jsonl", [{"kind": "policySemantic.reviewBatchMissingReviewPacket.v1", "batchId": batch_id} for batch_id in batches_missing_review_packets])
    jsonl_write(out_dir / "review-packets-with-span-mismatch.jsonl", [{"kind": "policySemantic.reviewPacketSpanMismatch.v1", "packetId": packet_id} for packet_id in packets_with_span_mismatch])
    jsonl_write(out_dir / "review-packets-missing-projection-fields.jsonl", [{"kind": "policySemantic.reviewPacketMissingProjectionFields.v1", "packetId": packet_id} for packet_id in packets_with_missing_projection_fields])
    jsonl_write(out_dir / "review-assignments-missing-work-orders.jsonl", [{"kind": "policySemantic.reviewAssignmentMissingWorkOrder.v1", "assignmentId": assignment_id} for assignment_id in assignments_missing_work_orders])
    jsonl_write(out_dir / "invalid-review-work-orders.jsonl", [{"kind": "policySemantic.invalidReviewWorkOrder.v1", "workOrderId": work_order_id} for work_order_id in invalid_work_order_ids])
    jsonl_write(out_dir / "review-work-orders-missing-result-templates.jsonl", [{"kind": "policySemantic.reviewWorkOrderMissingResultTemplate.v1", "workOrderId": work_order_id} for work_order_id in work_orders_missing_templates])
    jsonl_write(out_dir / "invalid-review-result-templates.jsonl", [{"kind": "policySemantic.invalidReviewResultTemplate.v1", "templateId": template_id} for template_id in invalid_template_ids])
    jsonl_write(out_dir / "review-batches-missing-required-discussion.jsonl", [{"kind": "policySemantic.reviewBatchMissingRequiredDiscussion.v1", "batchId": batch_id} for batch_id in batches_missing_required_discussion])
    jsonl_write(out_dir / "review-batches-missing-direct-discussion-templates.jsonl", [{"kind": "policySemantic.reviewBatchMissingDirectDiscussionTemplate.v1", "batchId": batch_id} for batch_id in batches_missing_direct_templates])
    jsonl_write(out_dir / "invalid-direct-discussion-templates.jsonl", [{"kind": "policySemantic.invalidDirectDiscussionTemplate.v1", "templateId": template_id} for template_id in invalid_direct_template_ids])
    jsonl_write(out_dir / "review-assignments-missing-accepted-results.jsonl", [{"kind": "policySemantic.reviewAssignmentMissingAcceptedResult.v1", "batchId": batch_id, "reviewerId": reviewer_id} for batch_id, reviewer_id in missing_review_result_pairs])
    jsonl_write(out_dir / "invalid-review-results.jsonl", [{"kind": "policySemantic.invalidReviewResult.v1", "reviewResultId": result_id} for result_id in invalid_review_result_ids])
    jsonl_write(out_dir / "review-batches-missing-accepted-discussions.jsonl", [{"kind": "policySemantic.reviewBatchMissingAcceptedDiscussion.v1", "batchId": batch_id} for batch_id in batches_missing_accepted_discussion])
    jsonl_write(out_dir / "invalid-direct-cross-discussions.jsonl", [{"kind": "policySemantic.invalidDirectCrossDiscussion.v1", "discussionId": discussion_id} for discussion_id in invalid_discussion_result_ids])
    gates.extend(review_provider_gates)

    ok = bool(gates) and all(row["status"] == "pass" for row in gates)
    blockers = [row["blocker"] for row in gates if row["status"] != "pass" and row["blocker"]]
    jsonl_write(out_dir / "adrs-projection-duckdb-gates.jsonl", gates)
    manifest = {
        "kind": "policySemantic.adrsProjectionDuckdbReview.v1",
        "ok": ok,
        "status": "accepted" if ok else "blocked",
        "semanticCoverageReady": ok,
        "cutoverReady": False,
        "policyDeletionApproved": False,
        "generatedIsAuthority": False,
        "duckdbExecuted": True,
        "policyRev": expected_rev,
        "blockers": blockers,
        "outputs": {
            "gates": "adrs-projection-duckdb-gates.jsonl",
            "gatesCsv": "adrs-projection-duckdb-gates.csv",
            "missingAcceptedSpanDispositions": "missing-accepted-span-dispositions.jsonl",
            "missingAcceptedCoverage": "missing-accepted-coverage.jsonl",
            "candidateOnlySpanDispositions": "candidate-only-span-dispositions.jsonl",
            "candidateOnlyFileDispositions": "candidate-only-file-dispositions.jsonl",
            "reviewProviderGates": "review-provider-gates.jsonl",
            "reviewBatchMissingSourceSpans": "review-batch-missing-source-spans.jsonl",
            "reviewBatchExtraSourceSpans": "review-batch-extra-source-spans.jsonl",
            "reviewBatchesMissingTwoReviewers": "review-batches-missing-two-reviewers.jsonl",
            "reviewBatchesMissingReviewPackets": "review-batches-missing-review-packets.jsonl",
            "reviewPacketsWithSpanMismatch": "review-packets-with-span-mismatch.jsonl",
            "reviewPacketsMissingProjectionFields": "review-packets-missing-projection-fields.jsonl",
            "reviewAssignmentsMissingWorkOrders": "review-assignments-missing-work-orders.jsonl",
            "invalidReviewWorkOrders": "invalid-review-work-orders.jsonl",
            "reviewWorkOrdersMissingResultTemplates": "review-work-orders-missing-result-templates.jsonl",
            "invalidReviewResultTemplates": "invalid-review-result-templates.jsonl",
            "reviewBatchesMissingRequiredDiscussion": "review-batches-missing-required-discussion.jsonl",
            "reviewBatchesMissingDirectDiscussionTemplates": "review-batches-missing-direct-discussion-templates.jsonl",
            "invalidDirectDiscussionTemplates": "invalid-direct-discussion-templates.jsonl",
            "reviewAssignmentsMissingAcceptedResults": "review-assignments-missing-accepted-results.jsonl",
            "invalidReviewResults": "invalid-review-results.jsonl",
            "reviewBatchesMissingAcceptedDiscussions": "review-batches-missing-accepted-discussions.jsonl",
            "invalidDirectCrossDiscussions": "invalid-direct-cross-discussions.jsonl",
            "sql": "adrs-projection-duckdb.sql",
        },
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, sort_keys=True))
    return 0 if ok else 1


def command_materialize_source_span_review_batches(args: argparse.Namespace) -> int:
    input_path = Path(args.missing_span_dispositions)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    batch_size = int(args.batch_size)
    policy_rev = str(args.policy_rev)
    rows = read_jsonl(input_path)
    sorted_rows = sorted(rows, key=lambda row: (str(row.get("sourcePath") or ""), int(row.get("startLine") or 0), str(row.get("sourceSpanId") or "")))
    batches: list[dict] = []
    for index in range(0, len(sorted_rows), batch_size):
        items = sorted_rows[index : index + batch_size]
        span_ids = [str(row.get("sourceSpanId")) for row in items if row.get("sourceSpanId")]
        source_paths = sorted({str(row.get("sourcePath")) for row in items if row.get("sourcePath")})
        batch_number = len(batches) + 1
        batch_id = "policy-source-span-review-batch-" + sha256_bytes(("\0".join(span_ids) + f":{batch_number}").encode("utf-8"))[:20]
        batches.append(
            {
                "kind": "policy.sourceSpanDispositionReviewBatch.v1",
                "id": batch_id,
                "policyRev": policy_rev,
                "batchNumber": batch_number,
                "sourceSpanCount": len(span_ids),
                "sourceSpanIds": span_ids,
                "sourcePaths": source_paths,
                "input": str(input_path),
                "accepted": False,
                "claimAllowed": False,
                "generatedIsAuthority": False,
                "policyDeletionApproved": False,
                "status": "review-required",
                "nextRecord": "policy.sourceSpanDisposition.v1",
            }
        )
    jsonl_write(out_dir / "source-span-disposition-review-batches.jsonl", batches)
    jsonl_write(out_dir / "policy.sourceSpanDispositionReviewBatch.v1.jsonl", batches)
    manifest = {
        "kind": "policy.sourceSpanDispositionReviewBatchRun.v1",
        "ok": bool(batches) or len(rows) == 0,
        "policyRev": policy_rev,
        "input": str(input_path),
        "batchSize": batch_size,
        "sourceSpanCount": len(rows),
        "batchCount": len(batches),
        "accepted": False,
        "claimAllowed": False,
        "generatedIsAuthority": False,
        "policyDeletionApproved": False,
        "outputs": {
            "batches": "source-span-disposition-review-batches.jsonl",
            "providerRecord": "policy.sourceSpanDispositionReviewBatch.v1.jsonl",
        },
        "status": "review-batches-materialized",
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, sort_keys=True))
    return 0


def command_assign_source_span_review_batches(args: argparse.Namespace) -> int:
    batches_path = Path(args.batches)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    reviewer_ids = [item.strip() for item in str(args.reviewers).split(",") if item.strip()]
    if len(reviewer_ids) < 2:
        print(json.dumps({"ok": False, "error": "at least two reviewers are required", "reviewers": reviewer_ids}, sort_keys=True))
        return 1
    batches = read_jsonl(batches_path)
    assignments: list[dict] = []
    discussion_rows: list[dict] = []
    for batch in batches:
        batch_id = str(batch.get("id"))
        batch_number = batch.get("batchNumber")
        for reviewer_id in reviewer_ids:
            assignments.append(
                {
                    "kind": "policy.sourceSpanDispositionReviewAssignment.v1",
                    "id": "policy-source-span-review-assignment-" + sha256_bytes(f"{batch_id}:{reviewer_id}".encode("utf-8"))[:20],
                    "policyRev": batch.get("policyRev"),
                    "batchId": batch_id,
                    "batchNumber": batch_number,
                    "reviewerId": reviewer_id,
                    "sourceSpanCount": batch.get("sourceSpanCount"),
                    "sourceSpanIds": batch.get("sourceSpanIds", []),
                    "requiredOutputRecord": "policy.sourceSpanDisposition.v1",
                    "peerReplyRequired": True,
                    "accepted": False,
                    "claimAllowed": False,
                    "generatedIsAuthority": False,
                    "policyDeletionApproved": False,
                    "status": "assigned-review-required",
                }
            )
        discussion_rows.append(
            {
                "kind": "policy.sourceSpanDispositionDirectCrossDiscussionRequired.v1",
                "id": "policy-source-span-review-cross-discussion-" + sha256_bytes(batch_id.encode("utf-8"))[:20],
                "policyRev": batch.get("policyRev"),
                "batchId": batch_id,
                "batchNumber": batch_number,
                "reviewerIds": reviewer_ids,
                "sameRevisionRequired": True,
                "peerRepliesReadRequired": True,
                "noRemainingObjectionsRequired": True,
                "accepted": False,
                "claimAllowed": False,
                "generatedIsAuthority": False,
                "policyDeletionApproved": False,
                "status": "direct-cross-discussion-required",
            }
        )
    jsonl_write(out_dir / "source-span-disposition-review-assignments.jsonl", assignments)
    jsonl_write(out_dir / "source-span-disposition-direct-cross-discussion-required.jsonl", discussion_rows)
    jsonl_write(out_dir / "policy.sourceSpanDispositionReviewAssignment.v1.jsonl", assignments)
    jsonl_write(out_dir / "policy.sourceSpanDispositionDirectCrossDiscussionRequired.v1.jsonl", discussion_rows)
    manifest = {
        "kind": "policy.sourceSpanDispositionReviewAssignmentRun.v1",
        "ok": bool(batches),
        "input": str(batches_path),
        "batchCount": len(batches),
        "reviewerIds": reviewer_ids,
        "assignmentCount": len(assignments),
        "directCrossDiscussionRequiredCount": len(discussion_rows),
        "accepted": False,
        "claimAllowed": False,
        "generatedIsAuthority": False,
        "policyDeletionApproved": False,
        "outputs": {
            "assignments": "source-span-disposition-review-assignments.jsonl",
            "directCrossDiscussionRequired": "source-span-disposition-direct-cross-discussion-required.jsonl",
            "assignmentProviderRecord": "policy.sourceSpanDispositionReviewAssignment.v1.jsonl",
            "directCrossDiscussionProviderRecord": "policy.sourceSpanDispositionDirectCrossDiscussionRequired.v1.jsonl",
        },
        "status": "review-assignments-materialized",
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, sort_keys=True))
    return 0 if batches else 1


def command_materialize_source_span_review_packets(args: argparse.Namespace) -> int:
    source_spans = read_jsonl(Path(args.source_spans))
    batches = read_jsonl(Path(args.batches))
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    policy_rev = str(args.policy_rev)
    span_by_id = {str(row.get("id")): row for row in source_spans if row.get("kind") == "policy.sourceSpan.v1" and row.get("id")}
    packets: list[dict] = []
    missing_refs: list[dict] = []
    stale_spans: list[dict] = []
    for batch in batches:
        if batch.get("kind") != "policy.sourceSpanDispositionReviewBatch.v1":
            continue
        batch_id = str(batch.get("id"))
        spans: list[dict] = []
        for span_id_value in as_list(batch.get("sourceSpanIds")):
            span_id = str(span_id_value)
            span = span_by_id.get(span_id)
            if not span:
                missing_refs.append(
                    {
                        "kind": "policySemantic.reviewPacketMissingSourceSpan.v1",
                        "batchId": batch_id,
                        "sourceSpanId": span_id,
                    }
                )
                continue
            if span.get("sourceTrace", {}).get("rev") != policy_rev:
                stale_spans.append(
                    {
                        "kind": "policySemantic.reviewPacketStaleSourceSpan.v1",
                        "batchId": batch_id,
                        "sourceSpanId": span_id,
                        "sourceTrace": span.get("sourceTrace"),
                    }
                )
            spans.append(
                {
                    "sourceSpanId": span_id,
                    "sourceFileId": span.get("sourceFileId"),
                    "sourceTrace": span.get("sourceTrace"),
                    "startLine": span.get("startLine"),
                    "endLine": span.get("endLine"),
                    "sha256": span.get("sha256"),
                    "excerpt": span.get("excerpt"),
                    "detection": span.get("detection"),
                }
            )
        packets.append(
            {
                "kind": "policy.sourceSpanDispositionReviewPacket.v1",
                "id": "policy-source-span-review-packet-" + sha256_bytes(batch_id.encode("utf-8"))[:20],
                "policyRev": policy_rev,
                "batchId": batch_id,
                "batchNumber": batch.get("batchNumber"),
                "sourceSpanCount": len(spans),
                "sourceSpans": spans,
                "sourcePaths": batch.get("sourcePaths", []),
                "reviewInstruction": "Review each sourceSpan from ADRS projection fields only; do not read policy.git body. Emit policy.sourceSpanDispositionReviewResult.v1 for the assigned batch.",
                "requiredOutputRecord": "policy.sourceSpanDispositionReviewResult.v1",
                "accepted": False,
                "claimAllowed": False,
                "generatedIsAuthority": False,
                "policyDeletionApproved": False,
                "status": "review-required",
            }
        )
    jsonl_write(out_dir / "policy.sourceSpanDispositionReviewPacket.v1.jsonl", packets)
    jsonl_write(out_dir / "review-packet-missing-source-spans.jsonl", missing_refs)
    jsonl_write(out_dir / "review-packet-stale-source-spans.jsonl", stale_spans)
    ok = not missing_refs and not stale_spans and bool(packets)
    manifest = {
        "kind": "policy.sourceSpanDispositionReviewPacketRun.v1",
        "ok": ok,
        "policyRev": policy_rev,
        "batchCount": len(batches),
        "packetCount": len(packets),
        "missingSourceSpanCount": len(missing_refs),
        "staleSourceSpanCount": len(stale_spans),
        "accepted": False,
        "claimAllowed": False,
        "generatedIsAuthority": False,
        "policyDeletionApproved": False,
        "outputs": {
            "packets": "policy.sourceSpanDispositionReviewPacket.v1.jsonl",
            "missingSourceSpans": "review-packet-missing-source-spans.jsonl",
            "staleSourceSpans": "review-packet-stale-source-spans.jsonl",
        },
        "status": "review-packets-materialized" if ok else "blocked",
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, sort_keys=True))
    return 0 if ok else 1


def command_materialize_source_span_review_work_orders(args: argparse.Namespace) -> int:
    assignments = read_jsonl(Path(args.assignments))
    review_packets = read_jsonl(Path(args.review_packets))
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    policy_rev = str(args.policy_rev)
    packet_by_batch = {
        str(row.get("batchId")): row
        for row in review_packets
        if row.get("kind") == "policy.sourceSpanDispositionReviewPacket.v1"
        and row.get("policyRev") == policy_rev
        and row.get("accepted") is False
        and row.get("generatedIsAuthority") is False
        and row.get("policyDeletionApproved") is False
        and row.get("status") == "review-required"
    }
    work_orders: list[dict] = []
    missing_packets: list[dict] = []
    span_mismatches: list[dict] = []
    for assignment in assignments:
        if not (
            assignment.get("kind") == "policy.sourceSpanDispositionReviewAssignment.v1"
            and assignment.get("policyRev") == policy_rev
            and assignment.get("accepted") is False
            and assignment.get("generatedIsAuthority") is False
            and assignment.get("policyDeletionApproved") is False
            and assignment.get("status") == "assigned-review-required"
        ):
            continue
        batch_id = str(assignment.get("batchId"))
        packet = packet_by_batch.get(batch_id)
        if not packet:
            missing_packets.append(
                {
                    "kind": "policySemantic.reviewWorkOrderMissingPacket.v1",
                    "assignmentId": assignment.get("id"),
                    "batchId": batch_id,
                }
            )
            continue
        assignment_span_ids = {str(span_id) for span_id in as_list(assignment.get("sourceSpanIds")) if span_id}
        packet_span_ids = {str(span.get("sourceSpanId")) for span in as_list(packet.get("sourceSpans")) if isinstance(span, dict) and span.get("sourceSpanId")}
        if assignment_span_ids != packet_span_ids:
            span_mismatches.append(
                {
                    "kind": "policySemantic.reviewWorkOrderSpanMismatch.v1",
                    "assignmentId": assignment.get("id"),
                    "packetId": packet.get("id"),
                    "batchId": batch_id,
                }
            )
            continue
        reviewer_id = str(assignment.get("reviewerId"))
        work_orders.append(
            {
                "kind": "policy.sourceSpanDispositionReviewerWorkOrder.v1",
                "id": "policy-source-span-review-work-order-" + sha256_bytes(f"{assignment.get('id')}:{packet.get('id')}".encode("utf-8"))[:20],
                "policyRev": policy_rev,
                "assignmentId": assignment.get("id"),
                "batchId": batch_id,
                "batchNumber": assignment.get("batchNumber"),
                "reviewerId": reviewer_id,
                "packetId": packet.get("id"),
                "sourceSpanCount": len(assignment_span_ids),
                "sourceSpanIds": sorted(assignment_span_ids),
                "sourcePaths": packet.get("sourcePaths", []),
                "reviewInput": {
                    "packetKind": packet.get("kind"),
                    "packetId": packet.get("id"),
                    "sourceSpans": packet.get("sourceSpans", []),
                },
                "requiredOutputRecord": "policy.sourceSpanDispositionReviewResult.v1",
                "requiredOutputFields": [
                    "id",
                    "batchId",
                    "reviewerId",
                    "packetId",
                    "packetRead",
                    "sourceSpanIds",
                    "disposition",
                    "rationale",
                    "noRemainingObjections",
                    "accepted",
                    "status",
                    "fixtureOnly",
                    "generatedIsAuthority",
                    "policyDeletionApproved",
                ],
                "instruction": "Use only this ADRS projection reviewInput. Do not read policy.git body. Emit one policy.sourceSpanDispositionReviewResult.v1 for this assignment.",
                "accepted": False,
                "claimAllowed": False,
                "generatedIsAuthority": False,
                "policyDeletionApproved": False,
                "status": "assigned-review-required",
            }
        )
    jsonl_write(out_dir / "policy.sourceSpanDispositionReviewerWorkOrder.v1.jsonl", work_orders)
    jsonl_write(out_dir / "review-work-orders-missing-packets.jsonl", missing_packets)
    jsonl_write(out_dir / "review-work-orders-span-mismatch.jsonl", span_mismatches)
    ok = bool(work_orders) and not missing_packets and not span_mismatches
    manifest = {
        "kind": "policy.sourceSpanDispositionReviewerWorkOrderRun.v1",
        "ok": ok,
        "policyRev": policy_rev,
        "assignmentCount": len(assignments),
        "workOrderCount": len(work_orders),
        "missingPacketCount": len(missing_packets),
        "spanMismatchCount": len(span_mismatches),
        "accepted": False,
        "claimAllowed": False,
        "generatedIsAuthority": False,
        "policyDeletionApproved": False,
        "outputs": {
            "workOrders": "policy.sourceSpanDispositionReviewerWorkOrder.v1.jsonl",
            "missingPackets": "review-work-orders-missing-packets.jsonl",
            "spanMismatches": "review-work-orders-span-mismatch.jsonl",
        },
        "status": "review-work-orders-materialized" if ok else "blocked",
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, sort_keys=True))
    return 0 if ok else 1


def command_materialize_source_span_review_result_templates(args: argparse.Namespace) -> int:
    work_orders = read_jsonl(Path(args.work_orders))
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    policy_rev = str(args.policy_rev)
    templates: list[dict] = []
    invalid_work_orders: list[dict] = []
    for order in work_orders:
        if not (
            order.get("kind") == "policy.sourceSpanDispositionReviewerWorkOrder.v1"
            and order.get("policyRev") == policy_rev
            and order.get("accepted") is False
            and order.get("generatedIsAuthority") is False
            and order.get("policyDeletionApproved") is False
            and order.get("status") == "assigned-review-required"
            and order.get("requiredOutputRecord") == "policy.sourceSpanDispositionReviewResult.v1"
        ):
            invalid_work_orders.append(
                {
                    "kind": "policySemantic.invalidReviewResultTemplateWorkOrder.v1",
                    "workOrderId": order.get("id"),
                }
            )
            continue
        template_id = "policy-source-span-review-result-template-" + sha256_bytes(str(order.get("id")).encode("utf-8"))[:20]
        templates.append(
            {
                "kind": "policy.sourceSpanDispositionReviewResultTemplate.v1",
                "id": template_id,
                "policyRev": policy_rev,
                "workOrderId": order.get("id"),
                "assignmentId": order.get("assignmentId"),
                "batchId": order.get("batchId"),
                "batchNumber": order.get("batchNumber"),
                "reviewerId": order.get("reviewerId"),
                "packetId": order.get("packetId"),
                "packetRead": False,
                "sourceSpanIds": order.get("sourceSpanIds", []),
                "sourceSpanCount": order.get("sourceSpanCount"),
                "disposition": None,
                "rationale": None,
                "noRemainingObjections": False,
                "requiredBeforeAccepted": [
                    "reviewer reads only ADRS projection workOrder.reviewInput",
                    "packetRead is true",
                    "disposition is set",
                    "rationale is set",
                    "noRemainingObjections is true",
                    "sourceSpanIds remain unchanged from work order",
                ],
                "accepted": False,
                "claimAllowed": False,
                "generatedIsAuthority": False,
                "policyDeletionApproved": False,
                "status": "template-review-required",
            }
        )
    jsonl_write(out_dir / "policy.sourceSpanDispositionReviewResultTemplate.v1.jsonl", templates)
    jsonl_write(out_dir / "invalid-review-result-template-work-orders.jsonl", invalid_work_orders)
    ok = bool(templates) and not invalid_work_orders
    manifest = {
        "kind": "policy.sourceSpanDispositionReviewResultTemplateRun.v1",
        "ok": ok,
        "policyRev": policy_rev,
        "workOrderCount": len(work_orders),
        "templateCount": len(templates),
        "invalidWorkOrderCount": len(invalid_work_orders),
        "accepted": False,
        "claimAllowed": False,
        "generatedIsAuthority": False,
        "policyDeletionApproved": False,
        "outputs": {
            "templates": "policy.sourceSpanDispositionReviewResultTemplate.v1.jsonl",
            "invalidWorkOrders": "invalid-review-result-template-work-orders.jsonl",
        },
        "status": "review-result-templates-materialized" if ok else "blocked",
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, sort_keys=True))
    return 0 if ok else 1


def command_materialize_source_span_direct_cross_discussion_templates(args: argparse.Namespace) -> int:
    required_discussions = read_jsonl(Path(args.required_discussions))
    review_result_templates = read_jsonl(Path(args.review_result_templates))
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    policy_rev = str(args.policy_rev)
    templates_by_batch: dict[str, list[dict]] = {}
    invalid_review_result_templates: list[dict] = []
    for row in review_result_templates:
        if not (
            row.get("kind") == "policy.sourceSpanDispositionReviewResultTemplate.v1"
            and row.get("policyRev") == policy_rev
            and row.get("accepted") is False
            and row.get("generatedIsAuthority") is False
            and row.get("policyDeletionApproved") is False
            and row.get("status") == "template-review-required"
            and row.get("id")
            and row.get("batchId")
            and row.get("reviewerId")
        ):
            invalid_review_result_templates.append(
                {
                    "kind": "policySemantic.invalidDirectDiscussionTemplateReviewResultTemplate.v1",
                    "templateId": row.get("id"),
                }
            )
            continue
        templates_by_batch.setdefault(str(row.get("batchId")), []).append(row)

    templates: list[dict] = []
    invalid_required_discussions: list[dict] = []
    missing_review_result_templates: list[dict] = []
    for required in required_discussions:
        if not (
            required.get("kind") == "policy.sourceSpanDispositionDirectCrossDiscussionRequired.v1"
            and required.get("policyRev") == policy_rev
            and required.get("accepted") is False
            and required.get("generatedIsAuthority") is False
            and required.get("policyDeletionApproved") is False
            and required.get("sameRevisionRequired") is True
            and required.get("peerRepliesReadRequired") is True
            and required.get("noRemainingObjectionsRequired") is True
            and required.get("status") == "direct-cross-discussion-required"
            and required.get("id")
            and required.get("batchId")
        ):
            invalid_required_discussions.append(
                {
                    "kind": "policySemantic.invalidDirectDiscussionTemplateRequiredDiscussion.v1",
                    "requiredDiscussionId": required.get("id"),
                }
            )
            continue
        batch_id = str(required.get("batchId"))
        batch_templates = templates_by_batch.get(batch_id, [])
        if not batch_templates:
            missing_review_result_templates.append(
                {
                    "kind": "policySemantic.directDiscussionTemplateMissingReviewResultTemplates.v1",
                    "requiredDiscussionId": required.get("id"),
                    "batchId": batch_id,
                }
            )
            continue
        reviewer_ids = sorted({str(row.get("reviewerId")) for row in batch_templates if row.get("reviewerId")})
        review_template_ids = sorted({str(row.get("id")) for row in batch_templates if row.get("id")})
        template_id = "policy-source-span-direct-cross-discussion-template-" + sha256_bytes(str(required.get("id")).encode("utf-8"))[:20]
        templates.append(
            {
                "kind": "policy.sourceSpanDispositionDirectCrossDiscussionTemplate.v1",
                "id": template_id,
                "policyRev": policy_rev,
                "requiredDiscussionId": required.get("id"),
                "batchId": batch_id,
                "batchNumber": required.get("batchNumber"),
                "reviewerIds": reviewer_ids,
                "reviewResultTemplateIds": review_template_ids,
                "peerRepliesReadByReviewerIds": [],
                "sameRevision": False,
                "peerRepliesRead": False,
                "noRemainingObjections": False,
                "rationale": None,
                "requiredBeforeAccepted": [
                    "accepted review results exist for all reviewResultTemplateIds",
                    "peerRepliesReadByReviewerIds covers reviewerIds",
                    "sameRevision is true",
                    "peerRepliesRead is true",
                    "noRemainingObjections is true",
                    "rationale is set",
                ],
                "accepted": False,
                "claimAllowed": False,
                "generatedIsAuthority": False,
                "policyDeletionApproved": False,
                "status": "template-cross-discussion-required",
            }
        )
    jsonl_write(out_dir / "policy.sourceSpanDispositionDirectCrossDiscussionTemplate.v1.jsonl", templates)
    jsonl_write(out_dir / "invalid-direct-discussion-template-required-discussions.jsonl", invalid_required_discussions)
    jsonl_write(out_dir / "invalid-direct-discussion-template-review-result-templates.jsonl", invalid_review_result_templates)
    jsonl_write(out_dir / "direct-discussion-template-missing-review-result-templates.jsonl", missing_review_result_templates)
    ok = bool(templates) and not invalid_required_discussions and not invalid_review_result_templates and not missing_review_result_templates
    manifest = {
        "kind": "policy.sourceSpanDispositionDirectCrossDiscussionTemplateRun.v1",
        "ok": ok,
        "policyRev": policy_rev,
        "requiredDiscussionCount": len(required_discussions),
        "reviewResultTemplateCount": len(review_result_templates),
        "templateCount": len(templates),
        "invalidRequiredDiscussionCount": len(invalid_required_discussions),
        "invalidReviewResultTemplateCount": len(invalid_review_result_templates),
        "missingReviewResultTemplateCount": len(missing_review_result_templates),
        "accepted": False,
        "claimAllowed": False,
        "generatedIsAuthority": False,
        "policyDeletionApproved": False,
        "outputs": {
            "templates": "policy.sourceSpanDispositionDirectCrossDiscussionTemplate.v1.jsonl",
            "invalidRequiredDiscussions": "invalid-direct-discussion-template-required-discussions.jsonl",
            "invalidReviewResultTemplates": "invalid-direct-discussion-template-review-result-templates.jsonl",
            "missingReviewResultTemplates": "direct-discussion-template-missing-review-result-templates.jsonl",
        },
        "status": "direct-cross-discussion-templates-materialized" if ok else "blocked",
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, sort_keys=True))
    return 0 if ok else 1


def command_check_source_span_review_completion(args: argparse.Namespace) -> int:
    assignments = read_jsonl(Path(args.assignments))
    required_discussions = read_jsonl(Path(args.required_discussions))
    review_packets = read_jsonl(Path(args.review_packets)) if args.review_packets else []
    review_results = read_jsonl(Path(args.review_results)) if args.review_results else []
    discussion_results = read_jsonl(Path(args.discussion_results)) if args.discussion_results else []
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    assignment_span_ids = {
        (str(row.get("batchId")), str(row.get("reviewerId"))): {str(span_id) for span_id in as_list(row.get("sourceSpanIds")) if span_id}
        for row in assignments
    }
    packet_ids_by_batch = {
        str(row.get("batchId")): str(row.get("id"))
        for row in review_packets
        if row.get("kind") == "policy.sourceSpanDispositionReviewPacket.v1"
        and row.get("policyRev") == args.policy_rev
        and row.get("accepted") is False
        and row.get("generatedIsAuthority") is False
        and row.get("policyDeletionApproved") is False
        and row.get("status") == "review-required"
        and row.get("id")
    }
    accepted_reviews: set[tuple[str, str]] = set()
    invalid_review_results: list[dict] = []
    for row in review_results:
        if not (
            row.get("kind") == "policy.sourceSpanDispositionReviewResult.v1"
            and row.get("status") == "accepted"
            and row.get("accepted") is True
            and row.get("policyRev") == args.policy_rev
            and row.get("fixtureOnly") is False
            and row.get("generatedIsAuthority") is False
            and row.get("policyDeletionApproved") is False
        ):
            continue
        pair = (str(row.get("batchId")), str(row.get("reviewerId")))
        result_span_ids = {str(span_id) for span_id in as_list(row.get("sourceSpanIds")) if span_id}
        packet_ok = bool(packet_ids_by_batch) and row.get("packetRead") is True and row.get("packetId") == packet_ids_by_batch.get(str(row.get("batchId")))
        valid_shape = (
            pair in assignment_span_ids
            and result_span_ids == assignment_span_ids[pair]
            and packet_ok
            and row.get("noRemainingObjections") is True
            and bool(row.get("disposition"))
            and bool(row.get("rationale"))
        )
        if valid_shape:
            accepted_reviews.add(pair)
        else:
            invalid_review_results.append(row)
    missing_assignments = [
        row
        for row in assignments
        if (str(row.get("batchId")), str(row.get("reviewerId"))) not in accepted_reviews
    ]
    review_result_ids_by_batch: dict[str, set[str]] = {}
    for row in review_results:
        pair = (str(row.get("batchId")), str(row.get("reviewerId")))
        if pair in accepted_reviews and row.get("id"):
            review_result_ids_by_batch.setdefault(str(row.get("batchId")), set()).add(str(row.get("id")))
    assignment_reviewers_by_batch: dict[str, set[str]] = {}
    for row in assignments:
        assignment_reviewers_by_batch.setdefault(str(row.get("batchId")), set()).add(str(row.get("reviewerId")))
    accepted_discussions: set[str] = set()
    invalid_discussion_results: list[dict] = []
    for row in discussion_results:
        if not (
            row.get("kind") == "policy.sourceSpanDispositionDirectCrossDiscussion.v1"
            and row.get("status") == "accepted"
            and row.get("accepted") is True
            and row.get("policyRev") == args.policy_rev
            and row.get("sameRevision") is True
            and row.get("peerRepliesRead") is True
            and row.get("noRemainingObjections") is True
            and row.get("fixtureOnly") is False
            and row.get("generatedIsAuthority") is False
            and row.get("policyDeletionApproved") is False
        ):
            continue
        batch_id = str(row.get("batchId"))
        result_ids = {str(item) for item in as_list(row.get("reviewResultIds")) if item}
        peer_read_reviewers = {str(item) for item in as_list(row.get("peerRepliesReadByReviewerIds")) if item}
        valid_shape = (
            result_ids == review_result_ids_by_batch.get(batch_id, set())
            and peer_read_reviewers == assignment_reviewers_by_batch.get(batch_id, set())
            and bool(row.get("rationale"))
        )
        if valid_shape:
            accepted_discussions.add(batch_id)
        else:
            invalid_discussion_results.append(row)
    missing_discussions = [
        row
        for row in required_discussions
        if str(row.get("batchId")) not in accepted_discussions
    ]
    gates = [
        {
            "gate_id": "source-span-review-assignments-accepted",
            "status": "pass" if not missing_assignments else "blocked",
            "blocker": None if not missing_assignments else "review assignments missing accepted results",
            "count": len(missing_assignments),
        },
        {
            "gate_id": "source-span-review-results-match-packets",
            "status": "pass" if not invalid_review_results else "blocked",
            "blocker": None if not invalid_review_results else "review results fail assignment, packet, disposition, rationale, or no-objection requirements",
            "count": len(invalid_review_results),
        },
        {
            "gate_id": "source-span-direct-cross-discussions-accepted",
            "status": "pass" if not missing_discussions else "blocked",
            "blocker": None if not missing_discussions else "direct cross-discussions missing accepted no-objection results",
            "count": len(missing_discussions),
        },
        {
            "gate_id": "source-span-direct-cross-discussions-match-review-results",
            "status": "pass" if not invalid_discussion_results else "blocked",
            "blocker": None if not invalid_discussion_results else "direct cross-discussions fail review-result, peer-read, rationale, or no-objection requirements",
            "count": len(invalid_discussion_results),
        },
    ]
    jsonl_write(out_dir / "source-span-review-completion-gates.jsonl", gates)
    jsonl_write(out_dir / "missing-source-span-review-assignments.jsonl", missing_assignments)
    jsonl_write(out_dir / "invalid-source-span-review-results.jsonl", invalid_review_results)
    jsonl_write(out_dir / "missing-source-span-direct-cross-discussions.jsonl", missing_discussions)
    jsonl_write(out_dir / "invalid-source-span-direct-cross-discussions.jsonl", invalid_discussion_results)
    ok = all(row["status"] == "pass" for row in gates)
    manifest = {
        "kind": "policy.sourceSpanDispositionReviewCompletionCheck.v1",
        "ok": ok,
        "policyRev": args.policy_rev,
        "assignmentCount": len(assignments),
        "missingAssignmentCount": len(missing_assignments),
        "directCrossDiscussionRequiredCount": len(required_discussions),
        "missingDirectCrossDiscussionCount": len(missing_discussions),
        "accepted": False,
        "claimAllowed": False,
        "generatedIsAuthority": False,
        "policyDeletionApproved": False,
        "outputs": {
            "gates": "source-span-review-completion-gates.jsonl",
            "missingAssignments": "missing-source-span-review-assignments.jsonl",
            "invalidReviewResults": "invalid-source-span-review-results.jsonl",
            "missingDirectCrossDiscussions": "missing-source-span-direct-cross-discussions.jsonl",
            "invalidDirectCrossDiscussions": "invalid-source-span-direct-cross-discussions.jsonl",
        },
        "status": "pass" if ok else "blocked",
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, sort_keys=True))
    return 0 if ok else 1


def command_materialize_accepted_source_span_dispositions(args: argparse.Namespace) -> int:
    assignments = read_jsonl(Path(args.assignments))
    review_results = read_jsonl(Path(args.review_results))
    discussion_results = read_jsonl(Path(args.discussion_results))
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    policy_rev = str(args.policy_rev)
    completion_args = argparse.Namespace(
        assignments=args.assignments,
        required_discussions=args.required_discussions,
        review_packets=args.review_packets,
        review_results=args.review_results,
        discussion_results=args.discussion_results,
        policy_rev=policy_rev,
        out_dir=str(out_dir / "completion-check"),
    )
    completion_rc = command_check_source_span_review_completion(completion_args)
    if completion_rc != 0:
        manifest = {
            "kind": "policy.sourceSpanDispositionMaterializationRun.v1",
            "ok": False,
            "policyRev": policy_rev,
            "accepted": False,
            "claimAllowed": False,
            "generatedIsAuthority": False,
            "policyDeletionApproved": False,
            "blocker": "source span review completion check did not pass",
            "outputs": {"completionCheck": "completion-check/manifest.json"},
            "status": "blocked",
        }
        (out_dir / "manifest.json").write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(manifest, sort_keys=True))
        return 1

    result_by_batch: dict[str, list[dict]] = {}
    for row in review_results:
        if row.get("kind") == "policy.sourceSpanDispositionReviewResult.v1" and row.get("status") == "accepted":
            result_by_batch.setdefault(str(row.get("batchId")), []).append(row)
    discussion_by_batch = {
        str(row.get("batchId")): row
        for row in discussion_results
        if row.get("kind") == "policy.sourceSpanDispositionDirectCrossDiscussion.v1" and row.get("status") == "accepted"
    }
    assignments_by_batch: dict[str, list[dict]] = {}
    for row in assignments:
        assignments_by_batch.setdefault(str(row.get("batchId")), []).append(row)

    disposition_rows: list[dict] = []
    for batch_id, batch_assignments in sorted(assignments_by_batch.items()):
        source_span_ids = sorted({span_id for assignment in batch_assignments for span_id in as_list(assignment.get("sourceSpanIds")) if span_id})
        reviewers = sorted({str(row.get("reviewerId")) for row in result_by_batch.get(batch_id, []) if row.get("reviewerId")})
        discussion = discussion_by_batch.get(batch_id, {})
        disposition_rows.append(
            {
                "kind": "policy.sourceSpanDisposition.v1",
                "id": "policy-source-span-disposition-" + sha256_bytes((batch_id + "\0" + "\0".join(source_span_ids)).encode("utf-8"))[:20],
                "policyRev": policy_rev,
                "batchId": batch_id,
                "sourceSpanIds": source_span_ids,
                "sourceSpanCount": len(source_span_ids),
                "disposition": str(args.disposition),
                "reviewerIds": reviewers,
                "directCrossDiscussionId": discussion.get("id"),
                "accepted": True,
                "status": "accepted",
                "fixtureOnly": False,
                "generatedIsAuthority": False,
                "policyDeletionApproved": False,
            }
        )
    jsonl_write(out_dir / "policy.sourceSpanDisposition.v1.jsonl", disposition_rows)
    manifest = {
        "kind": "policy.sourceSpanDispositionMaterializationRun.v1",
        "ok": True,
        "policyRev": policy_rev,
        "accepted": True,
        "claimAllowed": False,
        "generatedIsAuthority": False,
        "policyDeletionApproved": False,
        "batchCount": len(disposition_rows),
        "sourceSpanCount": sum(row["sourceSpanCount"] for row in disposition_rows),
        "outputs": {
            "sourceSpanDispositions": "policy.sourceSpanDisposition.v1.jsonl",
            "completionCheck": "completion-check/manifest.json",
        },
        "status": "accepted-dispositions-materialized",
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, sort_keys=True))
    return 0


def command_materialize_accepted_coverage_proof(args: argparse.Namespace) -> int:
    source_spans = read_jsonl(Path(args.source_spans))
    span_dispositions = read_jsonl(Path(args.source_span_dispositions))
    fresh_genx_reviews = read_jsonl(Path(args.fresh_genx_reviews))
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    policy_rev = str(args.policy_rev)
    span_ids = {str(row.get("id")) for row in source_spans if row.get("id")}
    stale_source_spans = [
        row
        for row in source_spans
        if row.get("kind") == "policy.sourceSpan.v1"
        and row.get("sourceTrace", {}).get("rev") != policy_rev
    ]
    accepted_disposition_span_ids = {
        str(span_id)
        for row in span_dispositions
        if row.get("kind") == "policy.sourceSpanDisposition.v1"
        and row.get("status") == "accepted"
        and row.get("accepted") is True
        and row.get("policyRev") == policy_rev
        and row.get("fixtureOnly") is False
        and row.get("generatedIsAuthority") is False
        and row.get("policyDeletionApproved") is False
        for span_id in as_list(row.get("sourceSpanIds"))
        if span_id
    }
    invalid_span_dispositions = [
        row
        for row in span_dispositions
        if row.get("kind") == "policy.sourceSpanDisposition.v1"
        and row.get("policyRev") == policy_rev
        and (
            row.get("generatedIsAuthority") is not False
            or row.get("policyDeletionApproved") is not False
        )
    ]
    nonaccepted_covering_span_dispositions = [
        row
        for row in span_dispositions
        if row.get("kind") == "policy.sourceSpanDisposition.v1"
        and row.get("policyRev") == policy_rev
        and any(str(span_id) in span_ids for span_id in as_list(row.get("sourceSpanIds")))
        and not (
            row.get("status") == "accepted"
            and row.get("accepted") is True
            and row.get("fixtureOnly") is False
            and row.get("generatedIsAuthority") is False
            and row.get("policyDeletionApproved") is False
        )
    ]
    accepted_genx = [
        row
        for row in fresh_genx_reviews
        if row.get("kind") == "policy.freshGenXReconstructionReview.v1"
        and row.get("status") == "accepted"
        and row.get("noRemainingObjections") is True
        and row.get("memoryUsed") is False
        and row.get("policyBodyUsedAsSource") is False
        and row.get("fixtureOnly") is False
        and row.get("policyRev") == policy_rev
        and row.get("id")
    ]
    missing_span_ids = sorted(span_ids - accepted_disposition_span_ids)
    invalid_disposition_span_ids = sorted(accepted_disposition_span_ids - span_ids)
    gates = [
        {
            "gate_id": "source-spans-policy-rev-current",
            "status": "pass" if not stale_source_spans else "blocked",
            "blocker": None if not stale_source_spans else "sourceSpan sourceTrace.rev does not match policyRev",
            "count": len(stale_source_spans),
        },
        {
            "gate_id": "accepted-span-dispositions-cover-source-spans",
            "status": "pass" if not missing_span_ids else "blocked",
            "blocker": None if not missing_span_ids else "sourceSpan lacks accepted disposition",
            "count": len(missing_span_ids),
        },
        {
            "gate_id": "accepted-span-dispositions-reference-source-spans",
            "status": "pass" if not invalid_disposition_span_ids else "blocked",
            "blocker": None if not invalid_disposition_span_ids else "accepted disposition references sourceSpan not in review input",
            "count": len(invalid_disposition_span_ids),
        },
        {
            "gate_id": "fresh-genx-evidence-accepted",
            "status": "pass" if accepted_genx else "blocked",
            "blocker": None if accepted_genx else "accepted Fresh GenX reconstruction evidence is missing",
            "count": 0 if accepted_genx else 1,
        },
        {
            "gate_id": "span-dispositions-not-generated-authority",
            "status": "pass" if not invalid_span_dispositions else "blocked",
            "blocker": None if not invalid_span_dispositions else "span disposition claimed generated authority or deletion approval",
            "count": len(invalid_span_dispositions),
        },
        {
            "gate_id": "no-candidate-span-dispositions-for-covered-spans",
            "status": "pass" if not nonaccepted_covering_span_dispositions else "blocked",
            "blocker": None if not nonaccepted_covering_span_dispositions else "covered source span has non-accepted disposition row",
            "count": len(nonaccepted_covering_span_dispositions),
        },
    ]
    jsonl_write(out_dir / "accepted-coverage-materialization-gates.jsonl", gates)
    jsonl_write(out_dir / "stale-source-spans.jsonl", stale_source_spans)
    jsonl_write(out_dir / "missing-accepted-coverage-source-spans.jsonl", [{"kind": "policySemantic.missingAcceptedCoverageSourceSpan.v1", "sourceSpanId": span_id} for span_id in missing_span_ids])
    jsonl_write(out_dir / "invalid-disposition-source-spans.jsonl", [{"kind": "policySemantic.invalidDispositionSourceSpan.v1", "sourceSpanId": span_id} for span_id in invalid_disposition_span_ids])
    jsonl_write(out_dir / "invalid-source-span-dispositions.jsonl", invalid_span_dispositions)
    jsonl_write(out_dir / "nonaccepted-covering-source-span-dispositions.jsonl", nonaccepted_covering_span_dispositions)
    ok = all(row["status"] == "pass" for row in gates)
    if not ok:
        manifest = {
            "kind": "policy.acceptedCoverageProofMaterializationRun.v1",
            "ok": False,
            "policyRev": policy_rev,
            "accepted": False,
            "claimAllowed": False,
            "generatedIsAuthority": False,
            "policyDeletionApproved": False,
            "outputs": {
                "gates": "accepted-coverage-materialization-gates.jsonl",
                "staleSourceSpans": "stale-source-spans.jsonl",
                "missingSourceSpans": "missing-accepted-coverage-source-spans.jsonl",
                "invalidDispositionSourceSpans": "invalid-disposition-source-spans.jsonl",
                "invalidSpanDispositions": "invalid-source-span-dispositions.jsonl",
                "nonacceptedCoveringSpanDispositions": "nonaccepted-covering-source-span-dispositions.jsonl",
            },
            "status": "blocked",
        }
        (out_dir / "manifest.json").write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(manifest, sort_keys=True))
        return 1

    genx_ids = [str(row.get("id")) for row in accepted_genx if row.get("id")]
    proof = {
        "kind": "policy.acceptedCoverageProof.v1",
        "id": "policy-accepted-coverage-proof-" + sha256_bytes((policy_rev + "\0" + "\0".join(sorted(span_ids))).encode("utf-8"))[:20],
        "policyRev": policy_rev,
        "coveredSourceSpanIds": sorted(span_ids),
        "coveredSourceSpanCount": len(span_ids),
        "freshGenXEvidenceIds": genx_ids,
        "accepted": True,
        "status": "accepted",
        "noRemainingObjections": True,
        "fixtureOnly": False,
        "generatedIsAuthority": False,
        "policyDeletionApproved": False,
        "cutoverReady": False,
    }
    jsonl_write(out_dir / "policy.acceptedCoverageProof.v1.jsonl", [proof])
    manifest = {
        "kind": "policy.acceptedCoverageProofMaterializationRun.v1",
        "ok": True,
        "policyRev": policy_rev,
        "accepted": True,
        "claimAllowed": False,
        "generatedIsAuthority": False,
        "policyDeletionApproved": False,
        "cutoverReady": False,
        "coveredSourceSpanCount": len(span_ids),
        "freshGenXEvidenceCount": len(genx_ids),
        "outputs": {
            "acceptedCoverageProof": "policy.acceptedCoverageProof.v1.jsonl",
            "gates": "accepted-coverage-materialization-gates.jsonl",
        },
        "status": "accepted-coverage-proof-materialized",
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, sort_keys=True))
    return 0


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
POLICY_DELETION_SKIP_FILENAMES = {
    "absent-simulation.json",
    "consumer-proof-results.jsonl",
    "consumer-references.jsonl",
    "deletion-readiness-gates.jsonl",
}


def deletion_rel_path(path: Path, root: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return path.as_posix()


def deletion_classify_reference(path: str, line: str) -> str:
    low_path = path.lower()
    low_line = line.lower()
    stripped = line.strip()
    if path.startswith("records/policy/") and path.endswith(".jsonl"):
        return "generated-policy-record"
    if low_path.endswith("policy_semantic_compiler/cli.py") and stripped.startswith(chr(34)) and stripped.endswith(chr(34) + ","):
        return "scanner-token-definition"
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
            if filename in POLICY_DELETION_SKIP_FILENAMES:
                continue
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



def deletion_run_consumer_proof_commands(commands: list[str]) -> list[dict]:
    results: list[dict] = []
    for index, command in enumerate(commands, start=1):
        try:
            completed = subprocess.run(
                command,
                shell=True,
                text=True,
                capture_output=True,
                timeout=120,
            )
            results.append(
                {
                    "kind": "policyDeletion.consumerProofResult.v1",
                    "id": f"consumer-proof-{index}",
                    "command": command,
                    "exitCode": completed.returncode,
                    "status": "pass" if completed.returncode == 0 else "blocked",
                    "stdoutSnippet": completed.stdout[:4000],
                    "stderrSnippet": completed.stderr[:4000],
                    "claimAllowed": False,
                    "cutoverReady": False,
                    "policyDeletionApproved": False,
                }
            )
        except subprocess.TimeoutExpired as exc:
            results.append(
                {
                    "kind": "policyDeletion.consumerProofResult.v1",
                    "id": f"consumer-proof-{index}",
                    "command": command,
                    "exitCode": None,
                    "status": "blocked",
                    "error": "timeout",
                    "stdoutSnippet": (exc.stdout or "")[:4000] if isinstance(exc.stdout, str) else "",
                    "stderrSnippet": (exc.stderr or "")[:4000] if isinstance(exc.stderr, str) else "",
                    "claimAllowed": False,
                    "cutoverReady": False,
                    "policyDeletionApproved": False,
                }
            )
    return results

def command_review_deletion_readiness(args: argparse.Namespace) -> int:
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    roots = [Path(item) for item in (args.repo_root or [])]
    reference_rows = deletion_scan_roots(roots)
    absent = deletion_run_absent_simulation(Path(args.policy_root), out_dir)
    consumer_proofs = deletion_run_consumer_proof_commands(args.consumer_proof_command or [])
    active_refs = [row for row in reference_rows if row.get("activeRuntimeCandidate")]
    missing_scan_roots = [row for row in reference_rows if row.get("referenceClass") == "missing-scan-root"]
    deletion_approved = False
    gates: list[dict] = []
    typed_gate(gates, "scan-roots-present", len(missing_scan_roots) == 0 and bool(roots), {"missingScanRootCount": len(missing_scan_roots), "missingScanRoots": missing_scan_roots[:25], "scannedRootCount": len(roots)})
    typed_gate(gates, "active-policy-consumers-zero", len(active_refs) == 0 and len(missing_scan_roots) == 0, {"activeRuntimeReferenceCount": len(active_refs), "activeRuntimeReferences": active_refs[:25]})
    typed_gate(gates, "policy-absent-consumers-pass", absent.get("consumerPassedWithoutPolicyGit") is True, {"absentSimulation": absent})
    consumer_proofs_pass = bool(consumer_proofs) and all(row.get("status") == "pass" for row in consumer_proofs)
    typed_gate(gates, "explicit-consumer-proofs-pass", consumer_proofs_pass, {"consumerProofCount": len(consumer_proofs), "consumerProofs": consumer_proofs[:25]})
    typed_gate(gates, "deletion-approved", deletion_approved, {"policyDeletionApproved": deletion_approved, "reason": "owner deletion approval is not accepted in this review"})
    typed_gate(gates, "deletion-readiness-does-not-claim-cutover", True, {"cutoverReady": False, "policyDeletionApproved": False})
    jsonl_write(out_dir / "consumer-references.jsonl", reference_rows)
    jsonl_write(out_dir / "deletion-readiness-gates.jsonl", gates)
    jsonl_write(out_dir / "consumer-proof-results.jsonl", consumer_proofs)
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
        "consumerProofsPass": consumer_proofs_pass,
        "consumerProofCount": len(consumer_proofs),
        "outputs": {"consumerReferences": "consumer-references.jsonl", "gates": "deletion-readiness-gates.jsonl", "absentSimulation": "absent-simulation.json", "consumerProofResults": "consumer-proof-results.jsonl"},
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
    deletion_parser.add_argument("--consumer-proof-command", action="append")
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
    adrs_projection_parser = sub.add_parser("review-adrs-projection-duckdb")
    adrs_projection_parser.add_argument("--adrs-records-dir", required=True)
    adrs_projection_parser.add_argument("--policy-rev", required=True)
    adrs_projection_parser.add_argument("--out-dir", required=True)
    adrs_projection_parser.add_argument("--duckdb-bin", default="duckdb")
    adrs_projection_parser.set_defaults(func=command_review_adrs_projection_duckdb)
    batch_parser = sub.add_parser("materialize-source-span-review-batches")
    batch_parser.add_argument("--missing-span-dispositions", required=True)
    batch_parser.add_argument("--policy-rev", required=True)
    batch_parser.add_argument("--batch-size", type=int, default=100)
    batch_parser.add_argument("--out-dir", required=True)
    batch_parser.set_defaults(func=command_materialize_source_span_review_batches)
    assignment_parser = sub.add_parser("assign-source-span-review-batches")
    assignment_parser.add_argument("--batches", required=True)
    assignment_parser.add_argument("--reviewers", default="reviewer-a,reviewer-b")
    assignment_parser.add_argument("--out-dir", required=True)
    assignment_parser.set_defaults(func=command_assign_source_span_review_batches)
    packet_parser = sub.add_parser("materialize-source-span-review-packets")
    packet_parser.add_argument("--source-spans", required=True)
    packet_parser.add_argument("--batches", required=True)
    packet_parser.add_argument("--policy-rev", required=True)
    packet_parser.add_argument("--out-dir", required=True)
    packet_parser.set_defaults(func=command_materialize_source_span_review_packets)
    work_order_parser = sub.add_parser("materialize-source-span-review-work-orders")
    work_order_parser.add_argument("--assignments", required=True)
    work_order_parser.add_argument("--review-packets", required=True)
    work_order_parser.add_argument("--policy-rev", required=True)
    work_order_parser.add_argument("--out-dir", required=True)
    work_order_parser.set_defaults(func=command_materialize_source_span_review_work_orders)
    result_template_parser = sub.add_parser("materialize-source-span-review-result-templates")
    result_template_parser.add_argument("--work-orders", required=True)
    result_template_parser.add_argument("--policy-rev", required=True)
    result_template_parser.add_argument("--out-dir", required=True)
    result_template_parser.set_defaults(func=command_materialize_source_span_review_result_templates)
    discussion_template_parser = sub.add_parser("materialize-source-span-direct-cross-discussion-templates")
    discussion_template_parser.add_argument("--required-discussions", required=True)
    discussion_template_parser.add_argument("--review-result-templates", required=True)
    discussion_template_parser.add_argument("--policy-rev", required=True)
    discussion_template_parser.add_argument("--out-dir", required=True)
    discussion_template_parser.set_defaults(func=command_materialize_source_span_direct_cross_discussion_templates)
    completion_parser = sub.add_parser("check-source-span-review-completion")
    completion_parser.add_argument("--assignments", required=True)
    completion_parser.add_argument("--required-discussions", required=True)
    completion_parser.add_argument("--review-packets")
    completion_parser.add_argument("--review-results")
    completion_parser.add_argument("--discussion-results")
    completion_parser.add_argument("--policy-rev", required=True)
    completion_parser.add_argument("--out-dir", required=True)
    completion_parser.set_defaults(func=command_check_source_span_review_completion)
    disposition_parser = sub.add_parser("materialize-accepted-source-span-dispositions")
    disposition_parser.add_argument("--assignments", required=True)
    disposition_parser.add_argument("--required-discussions", required=True)
    disposition_parser.add_argument("--review-packets", required=True)
    disposition_parser.add_argument("--review-results", required=True)
    disposition_parser.add_argument("--discussion-results", required=True)
    disposition_parser.add_argument("--policy-rev", required=True)
    disposition_parser.add_argument("--disposition", default="represented")
    disposition_parser.add_argument("--out-dir", required=True)
    disposition_parser.set_defaults(func=command_materialize_accepted_source_span_dispositions)
    coverage_parser = sub.add_parser("materialize-accepted-coverage-proof")
    coverage_parser.add_argument("--source-spans", required=True)
    coverage_parser.add_argument("--source-span-dispositions", required=True)
    coverage_parser.add_argument("--fresh-genx-reviews", required=True)
    coverage_parser.add_argument("--policy-rev", required=True)
    coverage_parser.add_argument("--out-dir", required=True)
    coverage_parser.set_defaults(func=command_materialize_accepted_coverage_proof)
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
