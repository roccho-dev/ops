#!/usr/bin/env python3
import argparse
import hashlib
import json
import re
from pathlib import Path


TEXT_SUFFIXES = {".md", ".json", ".jsonl", ".txt", ".yaml", ".yml", ".toml", ".nix"}
SKIP_PARTS = {".git", "node_modules", "dist", "build", ".direnv"}
VERSION = "coverage-first-hardened-hybrid-v0"

MODAL_RE = re.compile(r"\b(must|shall|required|requires|require|should|may not|must not|shall not|cannot|forbidden|deny|block|gate|approval|cutover|retire|delete|ssot|canonical|authority|owner|gen0|gen1|gen2|chatgpt|claude|codex)\b", re.I)
DENY_RE = re.compile(r"\b(must not|shall not|do not|forbidden|not allowed|cannot|deny|block)\b", re.I)
OBLIGATION_RE = re.compile(r"\b(must|shall|required|requires|require|need to|needs to)\b", re.I)
ACTIVATION_RE = re.compile(r"\b(if|when|only when|after|before|until|unless)\b", re.I)
AUTHORITY_RE = re.compile(r"\b(authority|canonical|ssot|source of truth|owner|approval|cutover|retire|delete|deletion|adoption)\b", re.I)
CONSUMER_RE = re.compile(r"\b(gen0|gen1|gen2|chatgpt|claude|codex|agent|consumer|role)\b", re.I)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write_json(path: Path, payload) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def write_jsonl(path: Path, rows) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")


def read_jsonl(path: Path):
    rows = []
    if not path or not path.exists():
        return rows
    with path.open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def iter_files(root: Path):
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(root)
        if any(part in SKIP_PARTS for part in rel.parts):
            continue
        if path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        yield path


def source_class(rel: str) -> str:
    if rel.startswith("projections/") or rel.startswith("generated/"):
        return "generated"
    if "/evidence/" in rel or rel.startswith("evidence/"):
        return "evidence"
    if rel.startswith("examples/") or rel.startswith("example/"):
        return "example"
    if rel.startswith("compat/") or rel.startswith("legacy/"):
        return "legacy"
    if rel.endswith((".mjs", ".js")):
        return "code"
    if rel.startswith("kernel/") or rel.startswith("modules/") or rel in {"AGENTS.md", "ADOPTION_MANIFEST.md"}:
        return "policy-source"
    if rel.endswith((".jsonl", ".json")):
        return "ledger-or-config"
    return "policy-source"


def block_type(line: str, in_fence: bool) -> str:
    stripped = line.strip()
    if in_fence:
        return "codeFenceLine"
    if stripped.startswith("```") or stripped.startswith("~~~"):
        return "codeFenceBoundary"
    if stripped.startswith(">"):
        return "quote"
    if stripped.startswith("#"):
        return "heading"
    if stripped.startswith("|") and stripped.endswith("|"):
        return "tableRow"
    if re.match(r"^\s*[-*+]\s+", line) or re.match(r"^\s*\d+\.\s+", line):
        return "listItem"
    if not stripped:
        return "blank"
    return "paragraph"


def disposition_for(source_cls: str, btype: str, text: str, heading_path: list[str]) -> tuple[str, str, bool]:
    hay = " ".join(heading_path + [text]).lower()
    has_modal = bool(MODAL_RE.search(text))
    if btype in {"blank", "codeFenceBoundary"}:
        return "non_authority_structure", "blank or fence boundary", False
    if btype == "quote":
        return "quoted_or_imported_text", "quoted markdown block; cannot become authority without explicit promotion", has_modal
    if btype == "codeFenceLine":
        return "generated_or_example_code", "code fence line; cannot become authority without explicit promotion", has_modal
    if source_cls in {"generated", "evidence"}:
        return "generated_evidence", "generated/evidence source class", has_modal
    if source_cls == "example" or any(token in hay for token in ["example", "fixture", "demo", "sample"]):
        return "example_or_fixture", "example/fixture context", has_modal
    if source_cls == "legacy" or any(token in hay for token in ["legacy", "compat", "superseded", "deprecated"]):
        return "historical_or_superseded", "legacy/superseded context", has_modal
    if has_modal:
        return "normative_candidate", "modal/authority token in policy source context", True
    return "non_authority_prose", "no high-risk modal or authority token", False


def signal_kind(text: str) -> str:
    kinds = []
    if DENY_RE.search(text):
        kinds.append("deny")
    if OBLIGATION_RE.search(text):
        kinds.append("obligation")
    if ACTIVATION_RE.search(text):
        kinds.append("activation")
    if AUTHORITY_RE.search(text):
        kinds.append("authority")
    if CONSUMER_RE.search(text):
        kinds.append("consumer")
    return "+".join(kinds) if kinds else "signal"


def emit_blocks(source_file, text: str):
    rows = []
    headings = []
    in_fence = False
    lines = text.splitlines()
    for line_no, line in enumerate(lines, start=1):
        stripped = line.strip()
        btype = block_type(line, in_fence)
        if btype == "codeFenceBoundary":
            in_fence = not in_fence
        if btype == "heading":
            level = len(stripped) - len(stripped.lstrip("#"))
            title = stripped[level:].strip()
            headings = headings[: level - 1] + [title]
        row_id = "block:" + sha256_bytes(f"{source_file['path']}:{line_no}:{line}".encode())[:20]
        row = {
            "type": "policy.mdBlock.v0",
            "id": row_id,
            "sourceFileId": source_file["id"],
            "sourcePath": source_file["path"],
            "sourceHash": source_file["sha256"],
            "lineStart": line_no,
            "lineEnd": line_no,
            "blockType": btype,
            "headingPath": headings,
            "text": stripped[:1000],
            "schemaVersion": "mdBlock.v0",
            "extractorVersion": VERSION,
        }
        if btype == "tableRow":
            cells = [cell.strip() for cell in stripped.strip("|").split("|")]
            row["tableCells"] = cells
            row["tableCellCount"] = len(cells)
        rows.append(row)
    return rows


def build_regression_fixtures(paths: list[Path]):
    fixtures = []
    for path in paths:
        for index, row in enumerate(read_jsonl(path), start=1):
            fixture_id = "fixture:" + sha256_bytes(f"{path}:{index}:{json.dumps(row, sort_keys=True, ensure_ascii=False)}".encode())[:20]
            fixtures.append({
                "type": "policy.regressionFixture.v0",
                "id": fixture_id,
                "sourcePath": str(path),
                "sourceRow": index,
                "fixtureClass": row.get("caseClass") or row.get("class") or row.get("type") or "owner-adoption-validator-case",
                "expectedGateImpact": row.get("expectedGateImpact") or row.get("expected") or "preserve-detection",
                "raw": row,
                "schemaVersion": "regressionFixture.v0",
            })
    return fixtures


def gate(name: str, status: str, actual, expected, reason: str) -> dict:
    return {"name": name, "status": status, "actual": actual, "expected": expected, "reason": reason}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--policy-root", required=True)
    parser.add_argument("--policy-ref", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--regression-fixture", action="append", default=[])
    args = parser.parse_args()

    root = Path(args.policy_root).resolve()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    source_files = []
    blocks = []
    table_cell_blocks = []
    dispositions = []
    signals = []
    candidates = []
    accepted_records = []
    unresolved = []

    for path in iter_files(root):
        rel = path.relative_to(root).as_posix()
        raw = path.read_bytes()
        text = raw.decode("utf-8", errors="replace")
        sf = {
            "type": "policy.sourceFile.v0",
            "id": "source:" + sha256_bytes(rel.encode())[:20],
            "policyRef": args.policy_ref,
            "path": rel,
            "sha256": sha256_bytes(raw),
            "bytes": len(raw),
            "lineCount": len(text.splitlines()),
            "sourceClass": source_class(rel),
            "schemaVersion": "sourceFile.v0",
            "extractorVersion": VERSION,
        }
        source_files.append(sf)
        for block in emit_blocks(sf, text):
            blocks.append(block)
            disp, reason, authority_relevant = disposition_for(sf["sourceClass"], block["blockType"], block["text"], block["headingPath"])
            drow = {
                "type": "policy.blockDisposition.v0",
                "id": "disp:" + block["id"].split(":", 1)[1],
                "blockId": block["id"],
                "sourcePath": block["sourcePath"],
                "lineStart": block["lineStart"],
                "lineEnd": block["lineEnd"],
                "blockType": block["blockType"],
                "disposition": disp,
                "authorityRelevant": authority_relevant,
                "reason": reason,
                "schemaVersion": "blockDisposition.v0",
                "extractorVersion": VERSION,
            }
            dispositions.append(drow)
            if block["blockType"] == "tableRow":
                for col_index, cell in enumerate(block.get("tableCells", []), start=1):
                    table_cell_blocks.append({
                        "type": "policy.tableCellBlock.v0",
                        "id": "cell:" + sha256_bytes(f"{block['id']}:{col_index}:{cell}".encode())[:20],
                        "blockId": block["id"],
                        "sourceFileId": block["sourceFileId"],
                        "sourcePath": block["sourcePath"],
                        "sourceHash": block["sourceHash"],
                        "lineStart": block["lineStart"],
                        "lineEnd": block["lineEnd"],
                        "columnIndex": col_index,
                        "headingPath": block["headingPath"],
                        "cellText": cell[:1000],
                        "cellTextDigest": sha256_bytes(cell.encode()),
                        "schemaVersion": "tableCellBlock.v0",
                        "extractorVersion": VERSION,
                    })
            if authority_relevant and disp != "normative_candidate":
                unresolved.append({
                    "type": "policy.unresolvedRow.v0",
                    "id": "unresolved:" + block["id"].split(":", 1)[1],
                    "scope": "authorityRelevantDisposition",
                    "severity": "BLOCK",
                    "sourcePath": block["sourcePath"],
                    "lineStart": block["lineStart"],
                    "lineEnd": block["lineEnd"],
                    "reason": "high-risk modal or authority token appears in non-normative disposition",
                    "disposition": disp,
                    "schemaVersion": "unresolvedRow.v0",
                })
            if disp == "normative_candidate":
                sig = {
                    "type": "policy.normativeSignal.v0",
                    "id": "signal:" + block["id"].split(":", 1)[1],
                    "blockId": block["id"],
                    "sourcePath": block["sourcePath"],
                    "sourceHash": block["sourceHash"],
                    "lineStart": block["lineStart"],
                    "lineEnd": block["lineEnd"],
                    "signalKind": signal_kind(block["text"]),
                    "text": block["text"],
                    "schemaVersion": "normativeSignal.v0",
                    "extractorVersion": VERSION,
                }
                signals.append(sig)
                cand = {
                    "type": "policy.semanticCandidate.v0",
                    "id": "candidate:" + block["id"].split(":", 1)[1],
                    "signalId": sig["id"],
                    "sourcePath": block["sourcePath"],
                    "sourceHash": block["sourceHash"],
                    "lineStart": block["lineStart"],
                    "lineEnd": block["lineEnd"],
                    "candidateKind": sig["signalKind"],
                    "authorityDisposition": disp,
                    "promotionStatus": "candidate-only",
                    "text": block["text"],
                    "schemaVersion": "semanticCandidate.v0",
                    "extractorVersion": VERSION,
                }
                candidates.append(cand)

    regression_fixtures = build_regression_fixtures([Path(p).resolve() for p in args.regression_fixture])

    table_blocks = [row for row in blocks if row["blockType"] == "tableRow"]
    table_signals = [row for row in signals if any(b["id"] == row["blockId"] and b["blockType"] == "tableRow" for b in blocks)]
    table_cell_expected = sum(len(row.get("tableCells", [])) for row in table_blocks)
    source_span_ok = all(row.get("lineStart") and row.get("lineEnd") and row.get("sourceHash") for row in candidates)
    authority_unresolved_count = len([row for row in unresolved if row.get("severity") == "BLOCK"])
    conflict_count = None
    accepted_compiler_authority = False

    gates = [
        gate("sourceFile-inventory", "PASS" if source_files else "BLOCK", len(source_files), ">0", "policy corpus files inventoried"),
        gate("mdBlock-coverage", "PASS" if blocks else "BLOCK", len(blocks), ">0", "addressable block rows produced"),
        gate("table-first-class", "PASS" if table_blocks else "BLOCK", len(table_blocks), ">0", "table rows are first-class spans when present"),
        gate("tableCellBlock-coverage", "PASS" if (not table_blocks or len(table_cell_blocks) == table_cell_expected) else "BLOCK", len(table_cell_blocks), table_cell_expected, "table cells are addressable spans"),
        gate("disposition-before-semantics", "PASS" if len(dispositions) == len(blocks) else "BLOCK", len(dispositions), len(blocks), "every block has disposition before semantic promotion"),
        gate("source-span-integrity", "PASS" if source_span_ok else "BLOCK", source_span_ok, True, "semantic candidates have source hash and line spans"),
        gate("authorityRelevantUnresolved-zero", "PASS" if authority_unresolved_count == 0 else "BLOCK", authority_unresolved_count, 0, "authority-relevant unresolved rows must be zero for promotion"),
        gate("regression-fixtures-present", "PASS" if regression_fixtures else "BLOCK", len(regression_fixtures), ">0", "validator evidence converted to regression fixtures"),
        gate("accepted-compiler-authority", "PASS" if accepted_compiler_authority else "BLOCK", accepted_compiler_authority, True, "this proposal does not grant accepted compiler authority"),
        gate("conflictMatrix-evaluated", "BLOCK", "not evaluated", "implemented conflictMatrix and supersessionGraph", "placeholder conflict graph cannot pass"),
        gate("consumerCutoverGate", "BLOCK", "not evaluated", "all consumers use accepted projections and pass runtime/e2e checks", "consumer cutover is a later gate"),
    ]
    retirement_scopes = {"semanticPromotion", "ownerAdoptionForCorpus", "policyRetirement", "policyDeletion", "cutover", "canonicalWrite", "ssotAdoption"}
    gate_status = "BLOCK" if any(g["status"] == "BLOCK" for g in gates) else "PASS"
    gate_matrix = {
        "type": "policy.coverageFirstHardenedHybrid.gateMatrix.v0",
        "route": "COVERAGE_FIRST_HARDENED_HYBRID",
        "policyRef": args.policy_ref,
        "decision": gate_status,
        "retirementScopedGates": sorted(retirement_scopes),
        "reducerRule": "validatorPass may set regressionCoverage only; it cannot set retirement/cutover/canonical/SSOT gates to PASS and cannot reduce authorityRelevantUnresolved count.",
        "gates": gates,
        "noApprovalGranted": {
            "ownerApproval": False,
            "policyGitDeletionApproval": False,
            "policyGitRetirementApproval": False,
            "cutoverApproval": False,
            "canonicalWriteApproval": False,
            "ssotAdoptionApproval": False,
            "semanticCompletionApproval": False,
        },
    }

    coverage = {
        "type": "policy.coverageFirstHardenedHybrid.coverageReport.v0",
        "policyRef": args.policy_ref,
        "sourceFileCount": len(source_files),
        "mdBlockCount": len(blocks),
        "tableBlockCount": len(table_blocks),
        "tableCellBlockCount": len(table_cell_blocks),
        "tableSignalCount": len(table_signals),
        "blockDispositionCount": len(dispositions),
        "normativeSignalCount": len(signals),
        "semanticCandidateCount": len(candidates),
        "acceptedSemanticRecordCount": len(accepted_records),
        "authorityRelevantUnresolvedCount": authority_unresolved_count,
        "regressionFixtureCount": len(regression_fixtures),
        "metricsSeparated": ["spanCoverage", "tableCoverage", "signalCoverage", "semanticCoverage", "behaviorCoverage", "conflictCoverage", "consumerCoverage", "buyerProjectionCoverage"],
        "decision": gate_status,
    }

    authority_matrix = {
        "type": "policy.coverageFirstHardenedHybrid.authorityMatrix.v0",
        "routeAuthority": "proposal-evidence-only",
        "canonicalAuthority": "unchanged SSOT; no canonical merge or adoption implied",
        "validatorRole": "regression fixture or local lane evidence only",
        "corpusReadinessAuthority": "reducer gateMatrix only",
        "generatedArtifactsAuthority": "not independently editable authority",
        "ownerResetRoute": "out-of-scope unless owner/root explicitly accepts semantic loss and consumer breakage",
    }

    write_jsonl(out_dir / "source_files.jsonl", source_files)
    write_jsonl(out_dir / "md_blocks.jsonl", blocks)
    write_jsonl(out_dir / "table_cell_blocks.jsonl", table_cell_blocks)
    write_jsonl(out_dir / "block_dispositions.jsonl", dispositions)
    write_jsonl(out_dir / "normative_signals.jsonl", signals)
    write_jsonl(out_dir / "semantic_candidates.jsonl", candidates)
    write_jsonl(out_dir / "accepted_semantic_records.jsonl", accepted_records)
    write_jsonl(out_dir / "regression_fixtures.jsonl", regression_fixtures)
    write_jsonl(out_dir / "unresolved_rows.jsonl", unresolved)
    write_json(out_dir / "gate_matrix.json", gate_matrix)
    write_json(out_dir / "coverage_report.json", coverage)
    write_json(out_dir / "authority_matrix.json", authority_matrix)
    write_json(out_dir / "conflict_matrix.json", {"type":"policy.conflictMatrix.v0","status":"BLOCK","reason":"not evaluated in this proposal; placeholder must not pass","conflictCount":"not evaluated"})
    unresolved_matrix = {"type":"policy.unresolvedMatrix.v0","authorityRelevantUnresolvedCount":authority_unresolved_count,"byDisposition":{},"decision":"BLOCK" if authority_unresolved_count else "PASS"}
    for row in unresolved:
        key = row.get("disposition", "<missing>")
        unresolved_matrix["byDisposition"][key] = unresolved_matrix["byDisposition"].get(key, 0) + 1
    write_json(out_dir / "unresolved_matrix.json", unresolved_matrix)
    write_json(out_dir / "ontology.v0.schema.json", {"type":"policy.coverageFirstHardenedHybrid.ontologySchema.v0","records":["sourceFile.v0","mdBlock.v0","tableCellBlock.v0","blockDisposition.v0","normativeSignal.v0","semanticCandidate.v0","acceptedSemanticRecord.v0","regressionFixture.v0","unresolvedRow.v0","gateMatrix.v0","conflictMatrix.v0"],"ordering":["sourceFile","mdBlock/tableCellBlock","blockDisposition/currentness","normativeSignal","semanticCandidate","acceptedSemanticRecord"],"extractorVersion":VERSION})

    audit = [
        "# Coverage-first hardened hybrid audit",
        "",
        f"- route: `COVERAGE_FIRST_HARDENED_HYBRID`",
        f"- policyRef: `{args.policy_ref}`",
        f"- decision: `{gate_status}`",
        f"- source files: {len(source_files)}",
        f"- blocks: {len(blocks)}",
        f"- table blocks: {len(table_blocks)}",
        f"- table cell blocks: {len(table_cell_blocks)}",
        f"- normative signals: {len(signals)}",
        f"- semantic candidates: {len(candidates)}",
        f"- accepted semantic records: {len(accepted_records)}",
        f"- authority-relevant unresolved rows: {authority_unresolved_count}",
        f"- regression fixtures: {len(regression_fixtures)}",
        "",
        "## Conclusion",
        "",
        "This run makes the route reviewable, but it does not approve policy.git retirement.",
        "The corpus-level decision remains BLOCK because accepted compiler authority, conflict evaluation, consumer cutover, and retirement/adoption gates are not proven here.",
        "This is not final hardened-route completeness until conflictMatrix/supersessionGraph and consumer cutover are implemented and pass.",
        "",
        "## Non-compressed repo conclusion",
        "",
        "- `policy.git` remains the input corpus for this proof run only.",
        "- `ops` owns the executable extractor/reducer proposal.",
        "- `adrs` should receive evidence and decision records, not executable semantics.",
        "- Proposal validators are preserved as regression fixtures; they cannot override reducer BLOCK.",
        "- Generated JSONL/matrices are review products, not independent authority.",
        "",
        "## Review x2 checklist",
        "",
        "1. Verify source hashes and spans in `source_files.jsonl`, `md_blocks.jsonl`, and `semantic_candidates.jsonl`.",
        "2. Verify table rows are first-class rows in `md_blocks.jsonl` and cells are addressable in `table_cell_blocks.jsonl`.",
        "3. Verify high-risk modal text in non-authority contexts is present in `unresolved_rows.jsonl`.",
        "4. Verify `gate_matrix.json` keeps retirement/cutover/canonical/SSOT gates BLOCK and conflictMatrix BLOCK/NOT_EVALUATED.",
        "5. Verify `regression_fixtures.jsonl` imports validator cases without making them authority.",
        "6. Verify no artifact grants owner/deletion/retirement/cutover/canonical/SSOT approval.",
    ]
    (out_dir / "README.audit.md").write_text("\n".join(audit) + "\n", encoding="utf-8")

    matrix_md = ["# Authority matrix", "", "| Surface | Role | Authority |", "|---|---|---|"]
    matrix_md.extend([
        "| policy.git | source corpus input | existing authority, not deleted |",
        "| ops extractor | proposal implementation | no canonical authority |",
        "| adrs evidence | decision/evidence placement | proposal evidence only |",
        "| regression fixtures | destructive evidence | cannot override reducer BLOCK |",
        "| gate matrix | corpus readiness projection | only readiness surface, still BLOCK |",
        "| buyer projections | readable audit view | generated, not independently editable |",
    ])
    (out_dir / "authority_matrix.md").write_text("\n".join(matrix_md) + "\n", encoding="utf-8")

    gate_md = ["# Gate matrix", "", "| Gate | Status | Actual | Expected |", "|---|---|---|---|"]
    for g in gates:
        gate_md.append(f"| {g['name']} | {g['status']} | {g['actual']} | {g['expected']} |")
    (out_dir / "gate_matrix.md").write_text("\n".join(gate_md) + "\n", encoding="utf-8")

    unresolved_md = ["# Unresolved matrix", "", f"- authorityRelevantUnresolvedCount: {authority_unresolved_count}", "", "| Disposition | Count |", "|---|---:|"]
    for key, value in sorted(unresolved_matrix["byDisposition"].items()):
        unresolved_md.append(f"| {key} | {value} |")
    (out_dir / "unresolved_matrix.md").write_text("\n".join(unresolved_md) + "\n", encoding="utf-8")

    drilldown = ["# Source to rule drilldown", "", "Sampled semantic candidates for reviewer entry. Full replay is in semantic_candidates.jsonl.", "", "| Source | Lines | Kind | Text |", "|---|---:|---|---|"]
    for row in candidates[:200]:
        text = row.get("text", "").replace("|", "\\|")[:180]
        drilldown.append(f"| {row['sourcePath']} | {row['lineStart']}-{row['lineEnd']} | {row['candidateKind']} | {text} |")
    (out_dir / "source_to_rule_drilldown.md").write_text("\n".join(drilldown) + "\n", encoding="utf-8")

    manifest_files = []
    for file_path in sorted(out_dir.rglob("*")):
        if file_path.is_file():
            data = file_path.read_bytes()
            manifest_files.append({"path": file_path.relative_to(out_dir).as_posix(), "sha256": sha256_bytes(data), "bytes": len(data)})
    write_json(out_dir / "manifest.json", {"type":"policy.coverageFirstHardenedHybrid.manifest.v0","policyRef":args.policy_ref,"decision":gate_status,"files":manifest_files})

    print(json.dumps({"outDir": str(out_dir), "decision": gate_status, "sourceFileCount": len(source_files), "mdBlockCount": len(blocks), "tableCellBlockCount": len(table_cell_blocks), "normativeSignalCount": len(signals), "authorityRelevantUnresolvedCount": authority_unresolved_count, "regressionFixtureCount": len(regression_fixtures)}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
