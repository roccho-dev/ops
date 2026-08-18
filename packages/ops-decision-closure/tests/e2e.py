#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import shutil
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CORE = ROOT / "packages/ops-decision-closure/bin/ops-decision-closure.py"
spec = importlib.util.spec_from_file_location("ops_decision_closure", CORE)
core = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(core)

EVIDENCE = ROOT / "evidence/ops-115"
CURRENT = EVIDENCE / "checkpoints/ops115-current"
OLD = EVIDENCE / "checkpoints/ops115-old"
PACKET_DIR = EVIDENCE / "decision-room"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    ledger = core.validate_authority(ROOT)
    summary = core.read_json(EVIDENCE / "proof-summary.json")
    comparison = core.read_json(EVIDENCE / "engine-comparison.receipt.json")
    negative = core.read_json(EVIDENCE / "negative-proof.receipt.json")
    economics = core.read_json(EVIDENCE / "decision-economics.receipt.json")
    replay = core.read_json(EVIDENCE / "incremental-replay.receipt.json")
    human = core.read_json(PACKET_DIR / "human-adoption.receipt.json")
    packet = core.read_json(PACKET_DIR / "decision-packet.json")
    room = (PACKET_DIR / "decision-room.html").read_text(encoding="utf-8")

    require(summary["status"] == "PASS", "proof summary")
    require(summary["authority_root_digest"] == ledger["authority_root_digest"], "authority digest")
    require(summary["engine"] == "sqlite-shards", "selected engine")
    require(comparison["semantic_mismatch_count"] == 0, "semantic mismatch")
    require(comparison["fail_closed_mismatch_count"] == 0, "fail-closed mismatch")
    require(comparison["selection"]["selected_engine"] == "sqlite-shards", "selection receipt")
    require(comparison["selection"]["dual_runtime_normal_path"] is False, "dual runtime")
    require(negative["case_count"] >= 42 and negative["fail_closed_mismatch_count"] == 0, "negative proof")
    require(economics["verdict"] == "PASS_DECISION_ECONOMICS_G9", "G9")
    require(replay["status"] == "PASS" and replay["old_checkpoint_replay"] and replay["current_checkpoint_replay"], "replay")
    require(human["status"] == "PASS" and human["javascript_required"] is False and human["sql_jsonl_direct_operation"] == 0, "human projection")
    require(core.verify_packet_room(packet, room)["status"] == "PASS", "packet/room parity")

    current_records, _, _ = core.sqlite_load(CURRENT)
    require({x["id"] for x in current_records} == {x["id"] for x in ledger["records"]}, "projection-only or missing meaning")
    core.sqlite_load(OLD)

    queries = core.read_json(ROOT / "decision-ledger/query-contract/v1.json")["queries"]
    args = {
        "current_decisions": {"domain": "git-write-closure"},
        "trace_decision": {"decision_id": "claim.engine.sqlite-shards"},
        "impact_by_fact": {"fact_id": "fact.engine.comparison"},
        "missing_outcomes": {},
        "unresolved_conflicts": {},
        "research_gaps": {"decision_id": "claim.engine.sqlite-shards"},
        "decision_timeline": {"decision_id": "claim.engine.sqlite-shards"},
        "full_history_aggregate": {},
    }
    require({x["name"] for x in queries} == set(args), "query inventory")
    for name, value in args.items():
        raw = core.query_records(ledger["records"], name, value)
        projected, _ = core.sqlite_query(CURRENT, name, value)
        require(core.sha256(core.canonical(raw)) == core.sha256(core.canonical(projected)), f"query parity {name}")

    for action in sorted(core.HUMAN_ACTIONS):
        candidate = core.action_candidate(packet, action, "accepted-e2e-reviewer", "2026-08-18T00:00:00Z")
        require(candidate["accepted"] is False and candidate["status"] == "candidate", f"candidate boundary {action}")

    with tempfile.TemporaryDirectory() as td:
        rebuilt = Path(td) / "checkpoint"
        manifest = core.sqlite_build(ROOT, rebuilt, "ops115-current", "ops115-old")
        accepted = core.checkpoint_manifest(CURRENT)
        require(manifest["authority_root_digest"] == accepted["authority_root_digest"], "clean rebuild authority digest")
        require(manifest["schema_digest"] == accepted["schema_digest"], "clean rebuild schema digest")
        require(manifest["query_contract_digest"] == accepted["query_contract_digest"], "clean rebuild query digest")
        rebuilt_records, _, _ = core.sqlite_load(rebuilt)
        require(core.sha256(core.canonical(rebuilt_records)) == core.sha256(core.canonical(current_records)), "clean rebuild records")

    dd_manifest = core.read_json(EVIDENCE / "dd-packet/manifest.json")
    require(dd_manifest["status"] == "PASS" and len(dd_manifest["assets"]) >= 10, "DD packet")
    package_row = [json.loads(x) for x in (ROOT / "build/packages.jsonl").read_text().splitlines() if x.strip() and json.loads(x).get("name") == "ops-decision-closure"]
    check_row = [json.loads(x) for x in (ROOT / "build/checks.jsonl").read_text().splitlines() if x.strip() and json.loads(x).get("name") == "ops-decision-closure"]
    require(len(package_row) == 1 and len(check_row) == 1, "registry")
    require("duckdb" not in package_row[0].get("deps", []) and "duckdb" not in check_row[0].get("deps", []), "DuckDB in normal runtime")

    print(json.dumps({"status": "PASS", "queries": len(args), "negative": negative["case_count"], "engine": "sqlite-shards", "economics": economics["verdict"], "human": human["status"], "replay": replay["status"]}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
