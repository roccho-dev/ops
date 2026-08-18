from pathlib import Path
import json


def append_jsonl(path: str, row: dict, key: str = "path") -> None:
    p = Path(path)
    rows = [json.loads(line) for line in p.read_text().splitlines() if line.strip()]
    if not any(x.get(key) == row[key] for x in rows):
        rows.append(row)
    p.write_text("".join(json.dumps(x, sort_keys=True, separators=(",", ":")) + "\n" for x in rows))


append_jsonl("ci.intent.v1.jsonl", {
    "kind": "ci.intent.v1",
    "path": ".github/workflows/decision-closure-release.yml",
    "provider": "github-actions",
    "role": "artifact_exporter",
    "entrypoint": "python3 packages/ops-decision-closure/tests/e2e.py + exact GitHub Release public readback",
    "source": "accepted immutable decision JSONL plus selected read-only checkpoint",
    "authority": False,
    "dispatch": ["push", "workflow_dispatch"],
    "push_branches": ["proposals"],
    "generation_mode": "checked_in",
    "workflow_definition": "checked_in",
    "artifact_source": "evidence/ops-115/checkpoints/ops115-current",
    "artifact_generation": "generated",
    "final_role": "non-authoritative exact decision checkpoint publisher"
})
append_jsonl("ci.intent.v1.jsonl", {
    "kind": "ci.intent.v1",
    "path": ".github/workflows/decision-closure-takeover.yml",
    "provider": "github-actions",
    "role": "artifact_exporter",
    "entrypoint": "clean-room exact Release restore, alternate static host, synthetic Fact impact, next checkpoint",
    "source": "accepted Git commit and exact-tag decision checkpoint Release",
    "authority": False,
    "dispatch": ["pull_request"],
    "generation_mode": "checked_in",
    "workflow_definition": "checked_in",
    "artifact_source": "independent-takeover.receipt.json",
    "artifact_generation": "generated",
    "final_role": "non-authoritative independent transfer and DD evidence"
})

proof = Path("packages/ops-decision-closure/tests/proof.py")
text = proof.read_text()
old = '''    metrics_fact = fact("fact.engine.comparison", "decision-engine", "engine_comparison", {"semantic_mismatch_count": comp["semantic_mismatch_count"], **comp["selection"]}, "evidence/ops-115/engine-comparison.receipt.json", "engine.round2", kind="measurement", summary="Same JSONL and named queries matched; SQLite shards won the fixed locality rule.")
    outcome = fact("fact.engine.outcome", "decision-engine", "selection", "PASS_SQLITE_SHARDS", "evidence/ops-115/engine-comparison.receipt.json", "engine.round2", kind="outcome", outcome_class="engine_compared", relations=[rel("result_of", "claim.engine.sqlite-shards")], summary="One normal runtime was selected; Frozen DuckLake remains comparison evidence only.")
    core.write_jsonl(root / "decision-ledger/facts/ops-engine-selection-001.jsonl", [metrics_fact, outcome])
    deps = ["cond.decision-engine.goal", "cond.decision-engine.constraint", "cond.decision-engine.threshold", *["fact.engine.sqlite-proof", "fact.engine.policy-mismatch", "fact.engine.duckdb-runtime", "fact.engine.authority", "fact.engine.release", "fact.engine.query-contract", "fact.engine.single-runtime", "fact.engine.locality"], "fact.engine.comparison"]
'''
new = '''    metrics_fact = fact("fact.engine.comparison", "decision-engine", "engine_comparison", {"semantic_mismatch_count": comp["semantic_mismatch_count"], **comp["selection"]}, "evidence/ops-115/engine-comparison.receipt.json", "engine.round2", kind="measurement", summary="Same JSONL and named queries matched; SQLite shards won the fixed locality rule.")
    owner_fact = fact("fact.engine.owner-adopt", "decision-engine", "purpose_authority_action", "ADOPT sqlite-shards under the fixed proof rule", "https://github.com/roccho-dev/ops/issues/115", "engine.round2", kind="approval", summary="The owner instructed completion and adopted the fixed-rule result without authorizing unrelated DuckDB cutover.")
    outcome = fact("fact.engine.outcome", "decision-engine", "selection", "PASS_SQLITE_SHARDS", "evidence/ops-115/engine-comparison.receipt.json", "engine.round2", kind="outcome", outcome_class="engine_compared", relations=[rel("result_of", "claim.engine.sqlite-shards")], summary="One normal runtime was selected; Frozen DuckLake remains comparison evidence only.")
    core.write_jsonl(root / "decision-ledger/facts/ops-engine-selection-001.jsonl", [metrics_fact, owner_fact, outcome])
    deps = ["cond.decision-engine.goal", "cond.decision-engine.constraint", "cond.decision-engine.threshold", *["fact.engine.sqlite-proof", "fact.engine.policy-mismatch", "fact.engine.duckdb-runtime", "fact.engine.authority", "fact.engine.release", "fact.engine.query-contract", "fact.engine.single-runtime", "fact.engine.locality"], "fact.engine.comparison", "fact.engine.owner-adopt"]
'''
assert old in text
proof.write_text(text.replace(old, new, 1))

release = Path(".github/workflows/decision-closure-release.yml")
text = release.read_text()
old = '''          python3 - "$out" "$tag" "$root" "$tree" "$runtime_sha" <<'PY'
          import hashlib,json,pathlib,sys
          out=pathlib.Path(sys.argv[1]); tag,root,tree,runtime_sha=sys.argv[2:]
'''
new = '''          python3 - "$out" "$tag" "$root" "$tree" "$runtime_sha" "$GITHUB_SHA" <<'PY'
          import hashlib,json,pathlib,sys
          out=pathlib.Path(sys.argv[1]); tag,root,tree,runtime_sha,commit=sys.argv[2:]
'''
assert old in text
text = text.replace(old, new, 1)
old = '''          receipt={'schema':'ops.decisionCheckpointRelease.v1','status':'PREPARED','repository':'roccho-dev/ops','accepted_commit':sys.environ['GITHUB_SHA'] if False else '', 'accepted_tree':tree,'authority_root_digest':root,'tag':tag,'query_runtime_sha256':runtime_sha,'assets':assets,'latest_used':False,'runtime_secret_count':0,'runtime_network_install':0}
          receipt['accepted_commit']=pathlib.Path('/proc/self/environ').read_bytes().split(b'GITHUB_SHA=')[1].split(b'\\0')[0].decode() if b'GITHUB_SHA=' in pathlib.Path('/proc/self/environ').read_bytes() else ''
'''
new = '''          receipt={'schema':'ops.decisionCheckpointRelease.v1','status':'PREPARED','repository':'roccho-dev/ops','accepted_commit':commit,'accepted_tree':tree,'authority_root_digest':root,'tag':tag,'query_runtime_sha256':runtime_sha,'assets':assets,'latest_used':False,'runtime_secret_count':0,'runtime_network_install':0}
'''
assert old in text
release.write_text(text.replace(old, new, 1))
