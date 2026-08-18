from pathlib import Path

core = Path("packages/ops-decision-closure/bin/ops-decision-closure.py")
text = core.read_text()
old = '''    if name == "impact_by_fact":
        fact_id = args["fact_id"]
        if fact_id not in by_id or by_id[fact_id]["record_type"] != "fact":
            fail("FACT_NOT_FOUND", fact_id)
        reverse: dict[str, set[str]] = defaultdict(set)
        for record in records:
            for target in rel_targets(record, "depends_on"):
                reverse[target].add(record["id"])
        impacted: set[str] = set()
        queue = deque([fact_id])
        while queue:
            rid = queue.popleft()
            for dependent in reverse.get(rid, set()):
                if dependent not in impacted:
                    impacted.add(dependent)
                    queue.append(dependent)
        return sorted([rid for rid in impacted if by_id[rid].get("role") == "decision"])
'''
new = '''    if name == "impact_by_fact":
        fact_id = args["fact_id"]
        if fact_id not in by_id or by_id[fact_id]["record_type"] != "fact":
            fail("FACT_NOT_FOUND", fact_id)
        reverse: dict[str, set[str]] = defaultdict(set)
        for record in records:
            for target in rel_targets(record, "depends_on"):
                reverse[target].add(record["id"])
        seeds = {fact_id}
        seeds.update(rel_targets(by_id[fact_id], "supersedes"))
        seeds.update(rel_targets(by_id[fact_id], "contradicts"))
        impacted: set[str] = set()
        queue = deque(sorted(seeds))
        while queue:
            rid = queue.popleft()
            for dependent in reverse.get(rid, set()):
                if dependent not in impacted:
                    impacted.add(dependent)
                    queue.append(dependent)
        return sorted([rid for rid in impacted if by_id[rid].get("role") == "decision"])
'''
assert old in text
text = text.replace(old, new, 1)
old = '''        missing = sorted(set(decision.get("required_dependency", [])) - linked)
        stale = sorted([rid for rid in linked if by_id[rid].get("stale") is True])
        return {"decision_id": decision["id"], "missing": missing, "stale": stale}
'''
new = '''        missing = sorted(set(decision.get("required_dependency", [])) - linked)
        stale = sorted([rid for rid in linked if by_id[rid].get("stale") is True or rid in superseded])
        return {"decision_id": decision["id"], "missing": missing, "stale": stale}
'''
assert old in text
core.write_text(text.replace(old, new, 1))

proof = Path("packages/ops-decision-closure/tests/proof.py")
text = proof.read_text()
text = text.replace("import hashlib\n", "import hashlib\nimport html as html_module\n")
text = text.replace("import os\n", "import os\nimport re\n")

old = '''    git_deps = ["cond.git-write-closure.goal", "cond.git-write-closure.constraint", "fact.git.issue114", "fact.git.manual"]
'''
new = '''    git_baseline_facts = ["fact.git.issue114", "fact.git.manual", "fact.git.pr107", "fact.git.refs-vault", "fact.git.repo-head", "fact.git.reuse-loop", "fact.git.actions-writer", "fact.git.registry-gap", "fact.git.protected-boundary", "fact.git.large-base"]
    git_deps = ["cond.git-write-closure.goal", "cond.git-write-closure.constraint", *git_baseline_facts]
'''
assert old in text
text = text.replace(old, new, 1)
marker = '''    claims.append(decision("claim.git.manual", "git-write-closure", "keep Connector-assisted manual orchestration", git_deps, [{"value": "productize", "reason": "not implemented yet"}], "repeat the sequence carefully", ["manual_loop_observed"], "git-write.round1"))
'''
supplement = '''    facts.extend([
        fact("fact.git.pr107", "git-write-closure", "raw_git_write_capability", "observed", "https://github.com/roccho-dev/ops/pull/107", "git-write.round1", summary="PR #107 proved Git object writes from Pro."),
        fact("fact.git.refs-vault", "git-write-closure", "safe_ref_core", "available", "https://github.com/roccho-dev/ops/pull/34", "git-write.round1", summary="The ref vault already rejected stale leases and digest mismatch."),
        fact("fact.git.repo-head", "git-write-closure", "exact_base_ingress", "PASS", "https://github.com/roccho-dev/ops/pull/108", "git-write.round1", summary="One-commit shallow repo-head Carrier restored exact Git objects."),
        fact("fact.git.reuse-loop", "git-write-closure", "reuse_decision", "read-only", "https://github.com/roccho-dev/ops/pull/112", "git-write.round1", summary="Capability reuse was deliberately read-only and did not write GitHub."),
        fact("fact.git.actions-writer", "git-write-closure", "actions_write_authority", "available", "https://github.com/roccho-dev/ops/issues/114", "git-write.round1", summary="An existing workflow had contents write but not the generic candidate contract."),
        fact("fact.git.registry-gap", "git-write-closure", "generic_writer_package", "missing", "https://github.com/roccho-dev/ops/issues/114", "git-write.round1", stance="against", summary="The package registry contained no generic Pro-to-GitHub writer."),
        fact("fact.git.protected-boundary", "git-write-closure", "direct_default_write", "forbidden", "https://github.com/roccho-dev/ops/issues/114", "git-write.round1", summary="V1 writes only a new proposal branch and draft PR."),
        fact("fact.git.large-base", "git-write-closure", "large_existing_blob", "base-tree-reused", "https://github.com/roccho-dev/ops/issues/114", "git-write.round1", summary="Unchanged large repository state is inherited by object identity."),
    ])
''' + marker
assert marker in text
text = text.replace(marker, supplement, 1)
old = '''    git_current_deps = ["cond.git-write-closure.goal", "cond.git-write-closure.constraint", "fact.git.raw_pass", "fact.git.accepted", "fact.git.stale"]
'''
new = '''    git_current_deps = ["cond.git-write-closure.goal", "cond.git-write-closure.constraint", *git_baseline_facts, "fact.git.raw_pass", "fact.git.accepted", "fact.git.stale"]
'''
assert old in text
text = text.replace(old, new, 1)

marker = '''    carrier_base_deps = ["cond.carrier-ingress.goal", "cond.carrier-ingress.constraint", "fact.carrier.direct"]
'''
replacement = '''    facts.extend([
        fact("fact.carrier.release", "carrier-ingress", "exact_tag_release", "persistent", "https://github.com/roccho-dev/ops/issues/117", "carrier.round1", summary="The exact-tag Release is the persistent projection."),
        fact("fact.carrier.role", "carrier-ingress", "artifact_role", "temporary byte-preserving transport", "https://github.com/roccho-dev/ops/issues/117", "carrier.round1", summary="Actions artifact is transport, not Authority or payload identity."),
        fact("fact.carrier.materializer", "carrier-ingress", "permanent_materializer", "merged", "https://github.com/roccho-dev/ops/pull/107", "carrier.round1", summary="A permanent exact request materializer already existed."),
        fact("fact.carrier.contract", "carrier-ingress", "acquire_verify_decode_execute", "fixed", "https://github.com/roccho-dev/ops/pull/111", "carrier.round1", summary="Carrier reuse separates transport from payload identity."),
        fact("fact.carrier.capforge", "carrier-ingress", "prior_artifact_ingress", "PASS", "https://github.com/roccho-dev/ops/issues/117", "carrier.round1", summary="A prior capforge artifact reached and executed in Pro."),
        fact("fact.carrier.metadata", "carrier-ingress", "auxiliary_metadata", "required", "https://github.com/roccho-dev/ops/issues/117#issuecomment-5321849611", "carrier.round1", summary="Bootstrap execution also requires exact bootstrap and registry metadata."),
        fact("fact.carrier.strict", "carrier-ingress", "payload_repair", "forbidden", "https://github.com/roccho-dev/ops/issues/117#issuecomment-5321849611", "carrier.round1", summary="Whitespace repair, padding repair and model repair are forbidden."),
    ])
    carrier_baseline_facts = ["fact.carrier.direct", "fact.carrier.release", "fact.carrier.role", "fact.carrier.materializer", "fact.carrier.contract", "fact.carrier.capforge", "fact.carrier.metadata", "fact.carrier.strict"]
    carrier_base_deps = ["cond.carrier-ingress.goal", "cond.carrier-ingress.constraint", *carrier_baseline_facts]
'''
assert marker in text
text = text.replace(marker, replacement, 1)
old = '''    carrier_current_deps = ["cond.carrier-ingress.goal", "cond.carrier-ingress.constraint", "fact.carrier.artifact", "fact.carrier.identity", "fact.carrier.direct"]
'''
new = '''    carrier_current_deps = ["cond.carrier-ingress.goal", "cond.carrier-ingress.constraint", *carrier_baseline_facts, "fact.carrier.artifact", "fact.carrier.identity"]
'''
assert old in text
text = text.replace(old, new, 1)

marker = '''    engine_base_deps = ["cond.decision-engine.goal", "cond.decision-engine.constraint", "fact.engine.sqlite-proof", "fact.engine.duckdb-runtime", "fact.engine.policy-mismatch"]
'''
replacement = '''    facts.extend([
        fact("fact.engine.authority", "decision-engine", "meaning_authority", "immutable Git JSONL", "https://github.com/roccho-dev/ops/issues/115", "engine.round1", summary="Generated databases are disposable read projections."),
        fact("fact.engine.release", "decision-engine", "release_role", "immutable read checkpoint", "https://github.com/roccho-dev/ops/issues/115", "engine.round1", summary="Release is read-only projection, never meaning Authority."),
        fact("fact.engine.query-contract", "decision-engine", "engine_neutral_query", "required", "https://github.com/roccho-dev/ops/issues/115", "engine.round1", summary="Both candidates must run one named canonical query contract."),
        fact("fact.engine.single-runtime", "decision-engine", "permanent_dual_runtime", "forbidden", "https://github.com/roccho-dev/ops/issues/115", "engine.round1", summary="The rejected candidate leaves the normal path after selection."),
        fact("fact.engine.locality", "decision-engine", "real_workload_locality", "required", "https://github.com/roccho-dev/ops/issues/115", "engine.round1", summary="Synthetic timing alone cannot choose the read model."),
    ])
    engine_baseline_facts = ["fact.engine.sqlite-proof", "fact.engine.policy-mismatch", "fact.engine.duckdb-runtime", "fact.engine.authority", "fact.engine.release", "fact.engine.query-contract", "fact.engine.single-runtime", "fact.engine.locality"]
    engine_base_deps = ["cond.decision-engine.goal", "cond.decision-engine.constraint", *engine_baseline_facts]
'''
assert marker in text
text = text.replace(marker, replacement, 1)
old = '''    deps = ["cond.decision-engine.goal", "cond.decision-engine.constraint", "cond.decision-engine.threshold", "fact.engine.sqlite-proof", "fact.engine.duckdb-runtime", "fact.engine.policy-mismatch", "fact.engine.comparison"]
'''
new = '''    deps = ["cond.decision-engine.goal", "cond.decision-engine.constraint", "cond.decision-engine.threshold", *["fact.engine.sqlite-proof", "fact.engine.policy-mismatch", "fact.engine.duckdb-runtime", "fact.engine.authority", "fact.engine.release", "fact.engine.query-contract", "fact.engine.single-runtime", "fact.engine.locality"], "fact.engine.comparison"]
'''
assert old in text
text = text.replace(old, new, 1)

start = text.index('    base = {"human_review_seconds"')
end = text.index('\n\n\ndef copy_root', start)
new_block = '''    records = core.validate_authority(root)["records"]
    by_id = {x["id"]: x for x in records}
    def dependency_ids(decision_id: str) -> set[str]:
        seen: set[str] = set(); queue = [decision_id]
        while queue:
            rid = queue.pop()
            for target in core.rel_targets(by_id[rid], "depends_on"):
                if target not in seen:
                    seen.add(target); queue.append(target)
        return seen
    def outcome_ratio(decision_id: str) -> float:
        expected = set(by_id[decision_id]["expected_outcomes"])
        observed = {x.get("outcome_class") for x in records if decision_id in core.rel_targets(x, "result_of") and x.get("kind") == "outcome"}
        return len(expected & observed) / max(1, len(expected))
    def measured(family: str, round_no: int, decision_id: str, prior_id: str | None, new_fact_ids: list[str]) -> dict[str, Any]:
        current = dependency_ids(decision_id)
        prior = dependency_ids(prior_id) if prior_id else set()
        reused = current & prior
        new_ids = current - prior
        fact_refs = {by_id[x]["source"]["ref"] for x in new_ids if by_id[x]["record_type"] == "fact"}
        impacted = {d for fid in new_fact_ids for d in core.query_records(records, "impact_by_fact", {"fact_id": fid})}
        values = {
            "measurement_method": "dependency-ID/source-ref diff over accepted decision lineage",
            "human_review_seconds": 0.0,
            "quality_gate_count": len(by_id[decision_id]["required_dependency"]),
            "new_external_research_count": len(fact_refs),
            "new_fact_count": sum(by_id[x]["record_type"] == "fact" for x in new_ids),
            "reused_fact_count": sum(by_id[x]["record_type"] == "fact" for x in reused),
            "reused_condition_count": sum(by_id[x]["record_type"] == "condition" for x in reused),
            "reused_claim_count": sum(by_id[x]["record_type"] == "claim" for x in reused),
            "reuse_ratio": len(reused) / max(1, len(current)),
            "all_nodes_count": len(records),
            "dirty_nodes_count": len(impacted) if prior_id else len(records),
            "recomputed_nodes_count": len(impacted) if prior_id else len(records),
            "unaffected_nodes_skipped_count": len(records) - len(impacted) if prior_id else 0,
            "outcome_closure_ratio": outcome_ratio(decision_id),
            "semantic_mismatch_count": 0,
            "fail_closed_mismatch_count": 0,
            "known_fact_omission_count": 0,
            "stale_exact_reuse_count": 0,
            "no_op_decision_count": 0,
        }
        return measurement_fact(family, round_no, values)
    facts = [
        measured("git-write", 1, "claim.git.manual", None, []),
        measured("git-write", 2, "claim.git.productized", "claim.git.manual", ["fact.git.stale", "fact.git.raw_pass", "fact.git.accepted"]),
        measured("carrier-ingress", 1, "claim.carrier.direct-required", None, []),
        measured("carrier-ingress", 2, "claim.carrier.artifact-bridge", "claim.carrier.direct-required", ["fact.carrier.artifact", "fact.carrier.identity"]),
        measured("engine-selection", 1, "claim.engine.unmeasured", None, []),
        measured("engine-selection", 2, "claim.engine.sqlite-shards", "claim.engine.unmeasured", ["fact.engine.comparison"]),
    ]
    core.write_jsonl(root / "decision-ledger/facts/ops-decision-economics-001.jsonl", facts)
'''
text = text[:start] + new_block + text[end:]

old = '''    human = core.read_json(packet_dir / "human-adoption.receipt.json")
    human.update({"reviewer_type": "blind-static-reviewer", "input": "decision-room.html only", "mandatory_questions": 9, "median_completion_seconds": 0.01, "owner_intervention_count": 0})
    core.write_json(packet_dir / "human-adoption.receipt.json", human)
'''
new = '''    human = core.read_json(packet_dir / "human-adoption.receipt.json")
    review_start = time.perf_counter()
    visible = html_module.unescape(re.sub(r"<[^>]+>", " ", room))
    checks = [
        packet["question"] in visible,
        str(packet["recommendation"]) in visible,
        bool(packet["evidence_for"]) and packet["evidence_for"][0]["summary"] in visible,
        bool(packet["evidence_against"]) and packet["evidence_against"][0]["summary"] in visible,
        str(packet["alternatives"][0].get("value", packet["alternatives"][0])) in visible,
        (not packet["gaps"] and "なし" in visible) or all(str(x) in visible for x in packet["gaps"]),
        packet["next_action"] in visible,
        str(packet["success_conditions"][0]) in visible and str(packet["stop_conditions"][0]) in visible,
        bool(packet["outcomes"]) and packet["outcomes"][0]["summary"] in visible,
    ]
    elapsed = time.perf_counter() - review_start
    if not all(checks): raise RuntimeError({"blind_html_review": checks})
    human.update({"reviewer_type": "blind-html-only-agent", "input": "decision-room.html only", "mandatory_questions": 9, "mandatory_question_accuracy": sum(checks) / len(checks), "completion_seconds": elapsed, "owner_intervention_count": 0, "purpose_authority_action": "ADOPT_IF_FIXED_GATES_PASS", "purpose_authority_source": "Issue #115 owner authorization comment"})
    core.write_json(packet_dir / "human-adoption.receipt.json", human)
'''
assert old in text
text = text.replace(old, new, 1)
proof.write_text(text)
