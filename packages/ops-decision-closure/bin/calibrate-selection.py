#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import argparse
import hashlib
import json
import statistics


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')


def sha(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def read_jsonl(path):
    return [json.loads(x) for x in Path(path).read_text(encoding='utf-8').splitlines() if x.strip()]


def write_json(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + '\n', encoding='utf-8')


def write_jsonl(path, rows):
    Path(path).write_text(''.join(json.dumps(x, ensure_ascii=False, sort_keys=True, separators=(',', ':')) + '\n' for x in rows), encoding='utf-8')


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--proof-dir', required=True)
    p.add_argument('--package-root', required=True)
    args = p.parse_args()
    proof = Path(args.proof_dir)
    package = Path(args.package_root)

    parity = read_json(proof / 'engine-parity.json')
    receipt = read_json(proof / 'closure-receipt.json')
    workload = read_json(package / 'economics/families.json')['workload']
    queries = {x['queryId']: x for x in parity['queries']}
    local_ids = ['current_decisions', 'trace_decision', 'impact_by_fact', 'research_gaps', 'decision_timeline']
    trace_ratio = queries['trace_decision']['frozenDuckLake']['p95Milliseconds'] / max(queries['trace_decision']['sqlite']['p95Milliseconds'], 0.000001)
    impact_ratio = queries['impact_by_fact']['frozenDuckLake']['p95Milliseconds'] / max(queries['impact_by_fact']['sqlite']['p95Milliseconds'], 0.000001)
    local_share = workload['localQueries'] / workload['totalQueries']
    sqlite_local_shards = max(queries[x]['sqlite']['requiredShardOrFileCount'] for x in local_ids)
    sqlite_local_fetch = statistics.median(queries[x]['sqlite']['fetchBytes'] for x in local_ids)
    duck_local_fetch = statistics.median(queries[x]['frozenDuckLake']['fetchBytes'] for x in local_ids)
    sqlite_manifest = read_json(proof / 'checkpoint-2/sqlite/manifest.json')
    duck_catalog = read_json(proof / 'checkpoint-2/frozen-ducklake/catalog.json')

    checks = {
        'semanticMismatchCountZero': parity['semanticMismatchCount'] == 0,
        'failClosedMismatchCountZero': receipt['failClosedMismatchCount'] == 0,
        'normalLocalQueryShareAtLeast95Percent': local_share >= 0.95,
        'sqliteLocalShardCountAtMostOne': sqlite_local_shards <= 1,
        'duckdbTraceP95MoreThan2xSQLite': trace_ratio > 2.0,
        'duckdbImpactP95MoreThan2xSQLite': impact_ratio > 2.0,
        'sqliteAssetCountWithinBound': len(sqlite_manifest['assets']) <= 64,
        'fullHistoryIsMinorityWorkload': workload['aggregateQueries'] / workload['totalQueries'] <= 0.05,
    }
    if not all(checks.values()):
        raise SystemExit('engine selection blocked: ' + json.dumps(checks, sort_keys=True))

    selection_input = {
        'schema': 'ops.decisionEngineSelectionInput.v1',
        'workload': workload,
        'metrics': {
            'traceP95RatioDuckToSQLite': trace_ratio,
            'impactP95RatioDuckToSQLite': impact_ratio,
            'sqliteLocalShardCountP95': sqlite_local_shards,
            'sqliteLocalFetchBytesMedian': sqlite_local_fetch,
            'frozenDuckLakeLocalFetchBytesMedian': duck_local_fetch,
            'sqliteAssetCount': len(sqlite_manifest['assets']),
            'frozenDuckLakeAssetCount': len(duck_catalog['assets']),
            'duckdbRuntimeCarrierBytes': 82582200,
            'sqliteAdditionalRuntimeCarrierBytes': 0,
        },
        'checks': checks,
        'scope': 'ops decision ledger v1 only; no existing DuckDB path replacement',
    }
    selection_digest = sha(selection_input)
    selection = {
        'schema': 'ops.decisionEngineSelection.v1',
        'status': 'PASS_SQLITE_SHARDS',
        'selectedEngine': 'sqlite-shards',
        'selectionInputDigest': 'sha256:' + selection_digest,
        'selectionInput': selection_input,
        'rejectedEngine': 'frozen-ducklake',
        'rejectedReason': 'local trace and impact p95 exceed SQLite by more than 2x, normal workload is >=95% local, and the exact DuckDB runtime adds 82,582,200 Carrier bytes',
        'authority': False,
    }
    write_json(package / 'engine-selection.json', selection)

    facts_path = package / 'fixtures/facts/segment-001.jsonl'
    facts = read_jsonl(facts_path)
    f = {x['id']: x for x in facts}
    ref = f'proof://ops-115/engine-selection/{selection_digest}'
    source_digest = 'sha256:' + selection_digest
    for key in ('f-lease-mismatch-demand', 'f-lease-reproposal-action', 'f-lease-applications', 'f-lease-contracts'):
        f[key]['source_ref'] = ref
        f[key]['source_digest'] = source_digest
        f[key]['confidence'] = 'verified'
    f['f-lease-mismatch-demand']['value'] = {'semanticMismatchCount': 0, 'failClosedMismatchCount': 0}
    f['f-lease-reproposal-action']['value'] = {'compared': ['sqlite-shards', 'frozen-ducklake'], 'queryCount': len(parity['queries']), 'repeatCount': 5}
    f['f-lease-applications']['value'] = {'normalLocalQueryShare': local_share, 'sqliteLocalShardCountP95': sqlite_local_shards, 'traceP95RatioDuckToSQLite': trace_ratio, 'impactP95RatioDuckToSQLite': impact_ratio}
    f['f-lease-contracts']['value'] = {'selectedEngine': 'sqlite-shards', 'duckdbRuntimeCarrierBytes': 82582200, 'sqliteAdditionalRuntimeCarrierBytes': 0}
    write_jsonl(facts_path, facts)

    claims_path = package / 'fixtures/claims/segment-001.jsonl'
    claims = read_jsonl(claims_path)
    c = {x['id']: x for x in claims}
    c['cl-lease-red-ocean']['value'] = 'Frozen DuckLake is materially heavier for the observed local point-query workload'
    c['cl-lease-red-ocean']['reason'] = f'trace p95 ratio={trace_ratio:.3f}; impact p95 ratio={impact_ratio:.3f}; runtime Carrier=82582200 bytes'
    c['cl-lease-redefined']['value'] = 'catalog.sqlite plus indexed immutable SQLite shards'
    c['cl-lease-redefined']['reason'] = 'all canonical results and failure boundaries match while one local shard serves >=95% of the observed workload'
    c['d-lease-current']['value'] = 'select SQLite catalog plus immutable shards for the public decision ledger v1'
    c['d-lease-current']['reason'] = 'the predeclared selection rule passed with semantic/fail-closed mismatch zero and materially lower local-query/runtime cost'
    c['d-lease-current']['selected_reason'] = 'smallest engine that satisfies the exact decision-ledger workload and replay contract'
    c['d-lease-current']['next_action'] = 'publish an immutable proof checkpoint and run independent clean-room takeover'
    c['d-lease-current']['success_conditions'] = ['semantic mismatch = 0', 'fail-closed mismatch = 0', 'old checkpoint replay PASS', 'independent takeover PASS']
    c['cl-lease-gap']['predicate'] = 'monitoring_note'
    c['cl-lease-gap']['value'] = 're-open engine selection if normal local-query share falls below 95% or full-history analysis becomes primary'
    c['cl-lease-gap']['reason'] = 'accepted reevaluation trigger, not a current gap'
    write_jsonl(claims_path, claims)

    print(json.dumps({'status': 'PASS_SQLITE_SHARDS', 'selectedEngine': 'sqlite-shards', 'selectionInputDigest': selection['selectionInputDigest']}, sort_keys=True))


if __name__ == '__main__':
    main()
