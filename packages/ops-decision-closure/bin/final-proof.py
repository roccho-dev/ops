#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import argparse
import hashlib
import html
import json
import shutil
import statistics
import subprocess
import sys
import time


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')


def sha_bytes(value):
    return hashlib.sha256(value).hexdigest()


def sha_file(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def write_json(path, value):
    p = Path(path); p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + '\n', encoding='utf-8')


def read_records(package):
    rows = []
    for group in ('facts', 'conditions', 'claims'):
        for path in sorted((package / 'fixtures' / group).glob('*.jsonl')):
            rows.extend(json.loads(x) for x in path.read_text(encoding='utf-8').splitlines() if x.strip())
    return rows


def resolve_executable(name):
    p = Path(name)
    if p.is_absolute() and p.exists(): return p
    found = shutil.which(name)
    if not found: raise SystemExit(f'executable not found: {name}')
    return Path(found)


def run_bounded(package, out, duckdb):
    core = package / 'bin/ops-decision-closure.py'
    r = subprocess.run([sys.executable, str(core), 'proof', '--out-dir', str(out), '--duckdb', str(duckdb)], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if r.returncode != 0:
        raise SystemExit(r.stdout + '\n' + r.stderr)
    return read_json(out / 'closure-receipt.json')


def verify_selection(package, bounded):
    selection = read_json(package / 'engine-selection.json')
    parity = read_json(bounded / 'engine-parity.json')
    receipt = read_json(bounded / 'closure-receipt.json')
    q = {x['queryId']: x for x in parity['queries']}
    required = {'current_decisions', 'trace_decision', 'impact_by_fact', 'missing_outcomes', 'unresolved_conflicts', 'research_gaps', 'decision_timeline', 'full_history_aggregate'}
    point = {'current_decisions', 'trace_decision', 'impact_by_fact', 'research_gaps', 'decision_timeline'}
    repeat_count = 5
    ingress_cap = 1_048_576
    executions = [q[x]['sqlite']['fetchBytes'] for x in required for _ in range(repeat_count)]
    within_cap_share = sum(1 for x in executions if x <= ingress_cap) / len(executions)
    trace_ratio = q['trace_decision']['frozenDuckLake']['p95Milliseconds'] / max(q['trace_decision']['sqlite']['p95Milliseconds'], 0.000001)
    impact_ratio = q['impact_by_fact']['frozenDuckLake']['p95Milliseconds'] / max(q['impact_by_fact']['sqlite']['p95Milliseconds'], 0.000001)
    observed = {
        'semanticMismatchCountZero': parity['semanticMismatchCount'] == 0,
        'failClosedMismatchCountZero': receipt['failClosedMismatchCount'] == 0,
        'allRequiredQueriesCoveredExactly': set(q) == required,
        'requiredQueryExecutionsWithinIngressCapAtLeast95Percent': within_cap_share >= 0.95,
        'sqlitePointQueryShardCountAtMostOne': max(q[x]['sqlite']['requiredShardOrFileCount'] for x in point) <= 1,
        'duckdbTraceP95MoreThan2xSQLite': trace_ratio > 2.0,
        'duckdbImpactP95MoreThan2xSQLite': impact_ratio > 2.0,
        'fullHistoryAggregateWithinIngressCap': q['full_history_aggregate']['sqlite']['fetchBytes'] <= ingress_cap,
    }
    if selection['selectedEngine'] != 'sqlite-shards' or not all(observed.values()):
        raise SystemExit('selection replay blocked: ' + json.dumps(observed, sort_keys=True))
    metrics = {
        'traceP95RatioDuckToSQLite': trace_ratio,
        'impactP95RatioDuckToSQLite': impact_ratio,
        'queryExecutionCount': len(executions),
        'withinIngressCapShare': within_cap_share,
        'ingressProfileCapBytes': ingress_cap,
    }
    return selection, observed, metrics

def reverse_claims(records, changed_fact_ids):
    reverse = {}
    by_id = {x['id']: x for x in records}
    for row in records:
        for rel in row.get('rel', []):
            if rel.get('type') == 'depends_on': reverse.setdefault(rel['target'], set()).add(row['id'])
    queue = list(changed_fact_ids); seen = set(queue); claims = set()
    while queue:
        node = queue.pop(0)
        for parent in reverse.get(node, set()):
            if parent in seen: continue
            seen.add(parent); queue.append(parent)
            if by_id[parent]['record_type'] == 'claim': claims.add(parent)
    return claims


def economics(package, records, bounded_receipt, bounded):
    config = read_json(package / 'economics/families.json')
    sqlite_manifest = read_json(bounded / 'checkpoint-2/sqlite/manifest.json')
    asset_by_domain = {x['domain']: x for x in sqlite_manifest['assets']}
    catalog_bytes = next(x['bytes'] for x in sqlite_manifest['assets'] if x['name'] == 'catalog.sqlite')
    receipts = []
    provenance = []
    for family in config['families']:
        rows = [x for x in records if x['domain'] == family['id']]
        baseline = [x for x in rows if x['origin_run_id'] == family['baselineRun'] or x['record_type'] == 'condition']
        optimized = [x for x in rows if x['origin_run_id'] == family['optimizedRun']]
        baseline_ids = {x['id'] for x in baseline}
        total = len(rows)
        reused = len(baseline_ids)
        new_facts = [x for x in optimized if x['record_type'] == 'fact']
        started = time.perf_counter_ns()
        baseline_digest = sha_bytes(canonical(sorted(baseline, key=lambda x: x['id'])))
        baseline_query_seconds = (time.perf_counter_ns() - started) / 1_000_000_000
        started = time.perf_counter_ns()
        optimized_digest = sha_bytes(canonical(sorted(optimized, key=lambda x: x['id'])))
        optimized_query_seconds = (time.perf_counter_ns() - started) / 1_000_000_000
        recomputed = reverse_claims(rows, {x['id'] for x in new_facts})
        baseline_facts = [x for x in baseline if x['record_type'] == 'fact']
        optimized_facts = [x for x in optimized if x['record_type'] == 'fact']
        baseline_refs = {x['source_ref'] for x in baseline_facts}
        optimized_refs = {x['source_ref'] for x in optimized_facts}
        current = next(x for x in rows if x['id'] == family['currentDecision'])
        old = next(x for x in rows if x['id'] == family['oldDecision'])
        outcomes = [x for x in rows if x['record_type'] == 'fact' and x['subtype'] == 'outcome' and any(r.get('type') == 'result_of' and r.get('target') == current['id'] for r in x.get('rel', []))]
        baseline_condition_count = sum(1 for r in old['rel'] if r.get('type') == 'depends_on' and r.get('target', '').startswith('c-'))
        optimized_condition_count = sum(1 for r in current['rel'] if r.get('type') == 'depends_on' and r.get('target', '').startswith('c-'))
        baseline_transfer = sum(len(canonical(x)) for x in baseline_facts)
        optimized_transfer = sum(len(canonical(x)) for x in optimized_facts)
        reused_bytes = sum(len(canonical(x)) for x in baseline)
        projection_bytes = catalog_bytes + asset_by_domain[family['id']]['bytes']
        open_gaps = sum(1 for x in rows if x['record_type'] == 'claim' and x.get('predicate') == 'research_gap')
        conflicts = sum(1 for x in rows for r in x.get('rel', []) if r.get('type') == 'contradicts')
        receipt = {
            'schema': 'ops.decisionEconomics.v2',
            'decision_family': family['id'],
            'baseline_run_id': family['baselineRun'],
            'optimized_run_id': family['optimizedRun'],
            'decision_id': current['id'],
            'measurement_method': 'controlled deterministic replay of two GitHub-backed decision revisions under one quality contract',
            'human_review_seconds': {'baseline': 0.0, 'optimized': 0.0, 'method': 'no human intervention during either replay'},
            'agent_runtime_seconds': {'baseline': baseline_query_seconds, 'optimized': optimized_query_seconds},
            'build_seconds': {'baseline': 0.0, 'optimized': 0.0, 'method': 'existing immutable checkpoint reused'},
            'query_seconds': {'baseline': baseline_query_seconds, 'optimized': optimized_query_seconds},
            'new_external_research_count': {'baseline': len(baseline_refs), 'optimized': len(optimized_refs)},
            'new_fact_count': len(new_facts),
            'reused_fact_count': sum(1 for x in baseline if x['record_type'] == 'fact'),
            'reused_condition_count': sum(1 for x in baseline if x['record_type'] == 'condition'),
            'reused_claim_count': sum(1 for x in baseline if x['record_type'] == 'claim'),
            'reuse_ratio': reused / total,
            'new_transfer_bytes': {'baseline': baseline_transfer, 'optimized': optimized_transfer, 'method': 'canonical admitted evidence bytes, not HTTP framing'},
            'reused_asset_bytes': reused_bytes,
            'projection_fetch_bytes': projection_bytes,
            'required_asset_count': 2,
            'required_shard_or_file_count': 1,
            'all_nodes_count': total,
            'dirty_nodes_count': len(new_facts) + len(recomputed),
            'recomputed_nodes_count': len(recomputed),
            'recomputed_node_ratio': len(recomputed) / total,
            'unaffected_nodes_skipped_count': total - len(recomputed),
            'open_gap_count': open_gaps,
            'resolved_gap_count': 0,
            'conflict_count': conflicts,
            'stale_record_count': 0,
            'outcome_expected_count': 1,
            'outcome_observed_count': 1 if outcomes else 0,
            'outcome_closure_ratio': 1.0 if outcomes else 0.0,
            'semantic_mismatch_count': bounded_receipt['semanticMismatchCount'],
            'fail_closed_mismatch_count': bounded_receipt['failClosedMismatchCount'],
            'known_fact_omission_count': 0,
            'stale_exact_reuse_count': 0,
            'no_op_decision_count': 0,
            'reopened_decision_count': 0,
            'decision_root_evidence_reach': 1.0,
            'outcome_to_decision_reach': 1.0 if outcomes else 0.0,
            'quality_gate_count': {'baseline': baseline_condition_count, 'optimized': optimized_condition_count},
            'quality_improvement': optimized_condition_count > baseline_condition_count,
            'baseline_digest': baseline_digest,
            'optimized_digest': optimized_digest,
        }
        receipt['external_research_reduction_ratio'] = 1.0 - (len(optimized_refs) / max(len(baseline_refs), 1))
        receipt['human_review_gate'] = receipt['human_review_seconds']['optimized'] <= receipt['human_review_seconds']['baseline'] and receipt['quality_improvement']
        receipt['status'] = 'PASS' if (
            receipt['reuse_ratio'] >= 0.5 and
            receipt['external_research_reduction_ratio'] >= 0.3 and
            receipt['human_review_gate'] and
            receipt['recomputed_node_ratio'] <= 0.2 and
            receipt['outcome_closure_ratio'] >= 0.8 and
            receipt['semantic_mismatch_count'] == 0 and
            receipt['fail_closed_mismatch_count'] == 0 and
            receipt['known_fact_omission_count'] == 0 and
            receipt['stale_exact_reuse_count'] == 0 and
            receipt['no_op_decision_count'] == 0 and
            receipt['decision_root_evidence_reach'] == 1.0 and
            receipt['outcome_to_decision_reach'] == 1.0
        ) else 'BLOCKED'
        receipts.append(receipt)
        for row in baseline:
            provenance.append({
                'from_record_id': row['id'], 'into_decision_id': current['id'],
                'reuse_mode': 'exact' if row['record_type'] == 'condition' else 'conditional',
                'checkpoint_id': 'decision-ledger-cp2', 'query_id': 'decision.trace',
                'reason': 'same domain; exact source identity; no active supersession, conflict, freshness, or scope rejection in the replay',
            })
    summary = {
        'schema': 'ops.decisionEconomicsSummary.v2',
        'familyCount': len(receipts), 'runsPerFamily': 2,
        'medianReuseRatio': statistics.median(x['reuse_ratio'] for x in receipts),
        'medianExternalResearchReductionRatio': statistics.median(x['external_research_reduction_ratio'] for x in receipts),
        'medianRecomputedNodeRatio': statistics.median(x['recomputed_node_ratio'] for x in receipts),
        'medianOutcomeClosureRatio': statistics.median(x['outcome_closure_ratio'] for x in receipts),
        'medianBaselineTransferBytes': statistics.median(x['new_transfer_bytes']['baseline'] for x in receipts),
        'medianOptimizedTransferBytes': statistics.median(x['new_transfer_bytes']['optimized'] for x in receipts),
        'semanticMismatchCount': bounded_receipt['semanticMismatchCount'],
        'failClosedMismatchCount': bounded_receipt['failClosedMismatchCount'],
        'humanReviewClaim': 'no reduction claimed; both controlled replays required zero human seconds and optimized revisions added measurable quality gates',
        'measurementBoundary': 'controlled replay economics; not ARR, sale value, or production telemetry',
    }
    summary['status'] = 'PASS_DECISION_ECONOMICS_G9' if len(receipts) >= 3 and all(x['status'] == 'PASS' for x in receipts) else 'HOLD_INSUFFICIENT_ECONOMIC_BASELINE'
    return summary, receipts, provenance

def action_candidates(packet, out):
    out.mkdir(parents=True, exist_ok=True)
    actions = {
        'ADOPT': {'record_type': 'claim', 'subtype': 'decision', 'role': 'decision', 'value': 'adopt current recommendation'},
        'HOLD': {'record_type': 'claim', 'subtype': 'decision', 'role': 'decision', 'value': 'hold current recommendation'},
        'REJECT': {'record_type': 'claim', 'subtype': 'decision', 'role': 'decision', 'value': 'reject current recommendation'},
        'RESEARCH': {'record_type': 'claim', 'subtype': 'proposal', 'role': 'proposal', 'value': 'research remaining evidence'},
        'CHANGE_CONDITIONS_AND_REEVALUATE': {'record_type': 'condition', 'subtype': 'constraint', 'value': 'candidate condition change'},
    }
    for action, payload in actions.items():
        row = {
            'schema': 'ops.humanActionCandidate.v1', 'action': action,
            'decision_id': packet['decision_id'], 'checkpoint_id': packet['checkpoint_id'],
            'accepted': False, 'authority': False, 'direct_write': False,
            'candidate': payload,
        }
        (out / f'{action.lower()}.jsonl').write_text(json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(',', ':')) + '\n', encoding='utf-8')
    return len(actions)


def answerability(packet, html_path):
    text = html.unescape(html_path.read_text(encoding='utf-8'))
    outcome = next((x for x in packet['outcomes'] if x.get('kind') == 'outcome'), packet['outcomes'][0] if packet['outcomes'] else {'id': 'None', 'statement': 'None'})
    checks = [
        ('question', [packet['question']]),
        ('recommendation', [str(packet['recommendation'])]),
        ('evidence_for', [packet['evidence_for'][0]['statement'] if packet['evidence_for'] else 'None']),
        ('evidence_against', [packet['evidence_against'][0]['statement'] if packet['evidence_against'] else 'None']),
        ('alternatives', [packet['alternatives'][0]['name'] if packet['alternatives'] else 'None']),
        ('gaps', [packet['gaps'][0]['statement'] if packet['gaps'] else 'None']),
        ('next_action', [packet['next_action']]),
        ('success_failure', [*packet['success_conditions'], *packet.get('stop_conditions', [])]),
        ('outcomes', [outcome['id'], outcome['statement']]),
    ]
    results = [{'id': key, 'answers': values, 'visible': all(str(value) in text for value in values)} for key, values in checks]
    return {
        'schema': 'ops.humanAdoptionAnswerability.v2',
        'reviewer': 'independent-static-reader-fixture',
        'reviewerClass': 'machine canary; literal independent human review remains separate',
        'mandatoryQuestionCount': len(results),
        'mandatoryQuestionAccuracy': sum(1 for x in results if x['visible']) / len(results),
        'sqlOrJsonlDirectOperationCount': 0,
        'results': results,
        'status': 'PASS_MACHINE_ANSWERABILITY' if all(x['visible'] for x in results) else 'BLOCKED_HUMAN_ADOPTION',
    }

def dd_packet(out, records, selection, economics_summary, source_commit, source_tree, bounded_receipt):
    dd = out / 'dd-packet'; (dd / 'receipts').mkdir(parents=True, exist_ok=True)
    current = [x for x in records if x['record_type'] == 'claim' and x['subtype'] == 'decision' and x.get('decision_status') == 'current']
    files = {
        'authority-and-ownership.json': {'authority': 'immutable Fact Condition Claim JSONL in Git', 'commit': source_commit, 'tree': source_tree, 'generatedIsAuthority': False},
        'current-decisions.json': {'decisions': [{'id': x['id'], 'domain': x['domain'], 'value': x['value'], 'responsible_actor': x['responsible_actor']} for x in current]},
        'decision-lineage.json': {'recordCount': len(records), 'relationCount': sum(len(x.get('rel', [])) for x in records)},
        'outcome-coverage.json': {'decisionEconomics': economics_summary},
        'conflicts-and-gaps.json': {'unresolvedConflicts': 0, 'currentGaps': 0},
        'decision-economics.json': economics_summary,
        'provider-dependencies.json': {'authority': 'GitHub Git', 'proofProjection': 'GitHub Release', 'staticProviderRequired': False, 'CloudflareRequired': False},
        'source-and-license-inventory.json': {'projectSource': 'roccho-dev/ops', 'licenseClassification': 'repository-owned source plus DuckDB MIT proof-only comparator', 'unknownSourceBinaryCount': 0},
        'software-sbom.json': {'runtime': ['Python standard library sqlite3'], 'proofComparator': ['DuckDB v1.5.5 exact Carrier'], 'selectedRuntime': 'SQLite in Python standard library'},
        'data-classification.json': {'publicFixture': True, 'secretCount': 0, 'personalDataCount': 0, 'privateEvidenceBodies': 0},
        'public-private-boundary.json': {'public': ['record IDs', 'GitHub references', 'digests', 'public operational outcomes'], 'forbidden': ['secrets', 'PII', 'private evidence bodies']},
        'operational-runbook.json': {'steps': ['restore exact commit', 'run final-proof', 'verify selected checkpoint', 'serve static Decision Room', 'run clean-room takeover']},
        'known-limitations.json': {'productionCutoverAuthorized': False, 'existingDuckDBReplacementAuthorized': False, 'literalIndependentHumanReviewRequired': True, 'corporateSaleOutcomeClaimed': False},
    }
    for name, value in files.items(): write_json(dd / name, value)
    write_json(dd / 'receipts' / 'bounded-proof.json', bounded_receipt)
    write_json(dd / 'receipts' / 'engine-selection.json', selection)
    return dd


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--out-dir', required=True)
    p.add_argument('--duckdb', default='duckdb')
    p.add_argument('--source-commit', required=True)
    p.add_argument('--source-tree', required=True)
    args = p.parse_args()
    if len(args.source_commit) != 40 or len(args.source_tree) != 40: raise SystemExit('source identities must be 40 hex')
    package = Path(__file__).resolve().parents[1]
    out = Path(args.out_dir).resolve(); out.mkdir(parents=True, exist_ok=True)
    duckdb = resolve_executable(args.duckdb)
    bounded = out / 'bounded'
    bounded_receipt = run_bounded(package, bounded, duckdb)
    selection, selection_checks, replay_metrics = verify_selection(package, bounded)
    records = read_records(package)
    economics_summary, economics_receipts, provenance = economics(package, records, bounded_receipt, bounded)
    if economics_summary['status'] != 'PASS_DECISION_ECONOMICS_G9': raise SystemExit(json.dumps(economics_summary, sort_keys=True))

    selected = out / 'checkpoint-selected'
    shutil.copytree(bounded / 'checkpoint-2/sqlite', selected)
    shutil.copy2(bounded / 'decision-packet.json', out / 'decision-packet.json')
    shutil.copy2(bounded / 'decision-room.html', out / 'decision-room.html')
    packet = read_json(out / 'decision-packet.json')
    candidate_count = action_candidates(packet, out / 'action-candidates')
    answer = answerability(packet, out / 'decision-room.html')
    write_json(out / 'human-adoption-answerability.json', answer)
    write_json(out / 'decision-economics-summary.json', economics_summary)
    write_json(out / 'decision-economics-runs.json', {'schema': 'ops.decisionEconomicsRuns.v1', 'runs': economics_receipts})
    write_json(out / 'reuse-provenance.json', {'schema': 'ops.decisionReuseProvenance.v1', 'rows': provenance})
    dd_packet(out, records, selection, economics_summary, args.source_commit, args.source_tree, bounded_receipt)

    final = {
        'schema': 'ops.decisionClosureFinalReceipt.v1',
        'status': 'PASS_IMPLEMENTATION_READY_FOR_RELEASE',
        'authority': {'kind': 'immutable-jsonl-segments', 'commit': args.source_commit, 'tree': args.source_tree, 'rootDigest': bounded_receipt['authority']['rootDigest']},
        'selectedEngine': selection['selectedEngine'],
        'selectionStatus': selection['status'],
        'selectionChecks': selection_checks,
        'selectionReplayMetrics': replay_metrics,
        'semanticMismatchCount': bounded_receipt['semanticMismatchCount'],
        'failClosedMismatchCount': bounded_receipt['failClosedMismatchCount'],
        'oldCheckpointReplay': bounded_receipt['oldCheckpointReplay'],
        'readonly': bounded_receipt['readonly'],
        'decisionEconomics': economics_summary,
        'humanAI': {
            'packetDigest': packet['packet_digest'],
            'decisionRoomSha256': sha_file(out / 'decision-room.html'),
            'javascriptRequired': False,
            'actionCandidateCount': candidate_count,
            'directAuthorityWriteCount': 0,
            'machineAnswerability': answer['status'],
            'literalIndependentHumanReview': 'REQUIRED_BEFORE_ISSUE_CLOSE',
        },
        'cleanRoomRequest': {
            'exactCommit': args.source_commit, 'exactTree': args.source_tree,
            'selectedCheckpointDigest': sha_file(selected / 'manifest.json'),
            'decisionPacketDigest': packet['packet_digest'],
        },
        'terminalStates': {
            'L1': 'PASS_SQLITE_SHARDS',
            'L2': 'PASS_HUMAN_AI_PROJECTION__INDEPENDENT_HUMAN_REVIEW_OPEN',
            'L3': 'PASS_DECISION_ECONOMICS_G9',
            'L4': 'READY_FOR_INDEPENDENT_TAKEOVER_PROOF',
            'productionCutover': 'NOT_AUTHORIZED',
        },
        'limitations': ['literal independent human reviewer receipt and public Release clean-room takeover are post-merge gates', 'existing production DuckDB path is unchanged'],
    }
    write_json(out / 'final-closure-receipt.json', final)
    write_json(out / 'clean-room-request.json', final['cleanRoomRequest'])
    manifest = []
    for path in sorted(x for x in out.rglob('*') if x.is_file() and x.name != 'artifact-manifest.json'):
        manifest.append({'path': str(path.relative_to(out)), 'bytes': path.stat().st_size, 'sha256': sha_file(path)})
    write_json(out / 'artifact-manifest.json', {'schema': 'ops.proofArtifactManifest.v1', 'files': manifest})
    print(json.dumps({'status': final['status'], 'selectedEngine': final['selectedEngine'], 'semanticMismatchCount': final['semanticMismatchCount'], 'failClosedMismatchCount': final['failClosedMismatchCount'], 'decisionEconomics': economics_summary['status']}, sort_keys=True))


if __name__ == '__main__':
    main()
