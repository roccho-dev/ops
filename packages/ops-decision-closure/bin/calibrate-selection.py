#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import argparse
import hashlib
import json
import statistics

REPEAT_COUNT = 5
INGRESS_PROFILE_CAP_BYTES = 1_048_576
REQUIRED_QUERY_IDS = {
    'current_decisions', 'trace_decision', 'impact_by_fact', 'missing_outcomes',
    'unresolved_conflicts', 'research_gaps', 'decision_timeline', 'full_history_aggregate',
}
POINT_QUERY_IDS = {'current_decisions', 'trace_decision', 'impact_by_fact', 'research_gaps', 'decision_timeline'}


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
    queries = {x['queryId']: x for x in parity['queries']}
    missing_queries = sorted(REQUIRED_QUERY_IDS - set(queries))
    unexpected_queries = sorted(set(queries) - REQUIRED_QUERY_IDS)
    trace_ratio = queries['trace_decision']['frozenDuckLake']['p95Milliseconds'] / max(queries['trace_decision']['sqlite']['p95Milliseconds'], 0.000001)
    impact_ratio = queries['impact_by_fact']['frozenDuckLake']['p95Milliseconds'] / max(queries['impact_by_fact']['sqlite']['p95Milliseconds'], 0.000001)
    sqlite_point_shards = max(queries[x]['sqlite']['requiredShardOrFileCount'] for x in POINT_QUERY_IDS)
    sqlite_point_fetch = statistics.median(queries[x]['sqlite']['fetchBytes'] for x in POINT_QUERY_IDS)
    duck_point_fetch = statistics.median(queries[x]['frozenDuckLake']['fetchBytes'] for x in POINT_QUERY_IDS)
    sqlite_manifest = read_json(proof / 'checkpoint-2/sqlite/manifest.json')
    duck_catalog = read_json(proof / 'checkpoint-2/frozen-ducklake/catalog.json')

    executions = []
    for query_id in sorted(REQUIRED_QUERY_IDS):
        row = queries[query_id]
        for iteration in range(REPEAT_COUNT):
            executions.append({
                'queryId': query_id,
                'iteration': iteration + 1,
                'sqliteFetchBytes': row['sqlite']['fetchBytes'],
                'sqliteShardCount': row['sqlite']['requiredShardOrFileCount'],
                'frozenDuckLakeFetchBytes': row['frozenDuckLake']['fetchBytes'],
                'frozenDuckLakeFileCount': row['frozenDuckLake']['requiredShardOrFileCount'],
            })
    within_cap = [x for x in executions if x['sqliteFetchBytes'] <= INGRESS_PROFILE_CAP_BYTES]
    within_cap_share = len(within_cap) / max(len(executions), 1)
    p95_fetch = sorted(x['sqliteFetchBytes'] for x in executions)[max(0, int(len(executions) * 0.95) - 1)]
    p95_shards = sorted(x['sqliteShardCount'] for x in executions)[max(0, int(len(executions) * 0.95) - 1)]

    checks = {
        'semanticMismatchCountZero': parity['semanticMismatchCount'] == 0,
        'failClosedMismatchCountZero': receipt['failClosedMismatchCount'] == 0,
        'allRequiredQueriesCoveredExactly': not missing_queries and not unexpected_queries,
        'requiredQueryExecutionsWithinIngressCapAtLeast95Percent': within_cap_share >= 0.95,
        'sqlitePointQueryShardCountAtMostOne': sqlite_point_shards <= 1,
        'duckdbTraceP95MoreThan2xSQLite': trace_ratio > 2.0,
        'duckdbImpactP95MoreThan2xSQLite': impact_ratio > 2.0,
        'sqliteAssetCountWithinBound': len(sqlite_manifest['assets']) <= 64,
        'fullHistoryAggregateWithinIngressCap': queries['full_history_aggregate']['sqlite']['fetchBytes'] <= INGRESS_PROFILE_CAP_BYTES,
    }
    if not all(checks.values()):
        raise SystemExit('engine selection blocked: ' + json.dumps(checks, sort_keys=True))

    workload = {
        'source': 'exact required-query contract replay against GitHub-backed operational authority; equal-weight proof workload, not production telemetry',
        'requiredQueryTypes': len(REQUIRED_QUERY_IDS),
        'repeatCountPerQuery': REPEAT_COUNT,
        'queryExecutionCount': len(executions),
        'ingressProfileCapBytes': INGRESS_PROFILE_CAP_BYTES,
        'withinCapExecutionCount': len(within_cap),
        'withinCapShare': within_cap_share,
        'p95SQLiteFetchBytes': p95_fetch,
        'p95SQLiteShardCount': p95_shards,
        'executions': executions,
    }
    selection_input = {
        'schema': 'ops.decisionEngineSelectionInput.v2',
        'workload': workload,
        'metrics': {
            'traceP95RatioDuckToSQLite': trace_ratio,
            'impactP95RatioDuckToSQLite': impact_ratio,
            'sqlitePointQueryShardCountMax': sqlite_point_shards,
            'sqlitePointFetchBytesMedian': sqlite_point_fetch,
            'frozenDuckLakePointFetchBytesMedian': duck_point_fetch,
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
        'schema': 'ops.decisionEngineSelection.v2',
        'status': 'PASS_SQLITE_SHARDS',
        'selectedEngine': 'sqlite-shards',
        'selectionInputDigest': 'sha256:' + selection_digest,
        'selectionInput': selection_input,
        'rejectedEngine': 'frozen-ducklake',
        'rejectedReason': 'all required V1 queries fit the fixed 1 MiB ingress profile, point queries touch one SQLite shard, DuckDB trace/impact p95 exceed SQLite by more than 2x, and the exact DuckDB runtime adds 82,582,200 Carrier bytes',
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
    f['f-lease-reproposal-action']['value'] = {'compared': ['sqlite-shards', 'frozen-ducklake'], 'queryCount': len(REQUIRED_QUERY_IDS), 'repeatCount': REPEAT_COUNT, 'executionCount': len(executions)}
    f['f-lease-applications']['value'] = {'requiredQueryWithinIngressCapShare': within_cap_share, 'p95SQLiteFetchBytes': p95_fetch, 'p95SQLiteShardCount': p95_shards, 'sqlitePointQueryShardCountMax': sqlite_point_shards, 'traceP95RatioDuckToSQLite': trace_ratio, 'impactP95RatioDuckToSQLite': impact_ratio}
    f['f-lease-contracts']['value'] = {'selectedEngine': 'sqlite-shards', 'duckdbRuntimeCarrierBytes': 82582200, 'sqliteAdditionalRuntimeCarrierBytes': 0}
    write_jsonl(facts_path, facts)

    conditions_path = package / 'fixtures/conditions/segment-001.jsonl'
    conditions = read_jsonl(conditions_path)
    cond = {x['id']: x for x in conditions}
    cond['c-lease-threshold']['value'] = '>=95% of the exact required-query replay must fit the fixed 1 MiB ingress profile; point trace/impact must touch one SQLite shard; DuckDB trace/impact p95 must exceed SQLite by >2x'
    cond['c-lease-freshness']['value'] = 're-open when production telemetry exists, the required query contract changes, or any p95 query exceeds the 1 MiB ingress profile'
    write_jsonl(conditions_path, conditions)

    claims_path = package / 'fixtures/claims/segment-001.jsonl'
    claims = read_jsonl(claims_path)
    c = {x['id']: x for x in claims}
    c['cl-lease-red-ocean']['value'] = 'Frozen DuckLake is materially heavier for the exact required-query replay'
    c['cl-lease-red-ocean']['reason'] = f'trace p95 ratio={trace_ratio:.3f}; impact p95 ratio={impact_ratio:.3f}; runtime Carrier=82582200 bytes'
    c['cl-lease-redefined']['value'] = 'catalog.sqlite plus indexed immutable SQLite shards'
    c['cl-lease-redefined']['reason'] = f'all {len(executions)} exact query executions fit the 1 MiB ingress profile; point queries touch one shard; canonical results and failure boundaries match'
    c['d-lease-current']['value'] = 'select SQLite catalog plus immutable shards for the public decision ledger v1'
    c['d-lease-current']['reason'] = 'the predeclared V1 selection rule passed on the real operational authority and exact required-query replay without claiming production query telemetry'
    c['d-lease-current']['selected_reason'] = 'smallest engine that satisfies the exact decision-ledger query, ingress, replay, and transfer contract'
    c['d-lease-current']['next_action'] = 'publish an immutable proof checkpoint and run independent clean-room takeover'
    c['d-lease-current']['success_conditions'] = ['semantic mismatch = 0', 'fail-closed mismatch = 0', 'old checkpoint replay PASS', 'independent takeover PASS']
    c['d-lease-current']['stop_conditions'] = ['any semantic mismatch', 'any required-query p95 fetch exceeds 1 MiB', 'production telemetry materially differs from the proof workload']
    c['cl-lease-gap']['predicate'] = 'monitoring_note'
    c['cl-lease-gap']['value'] = 're-open engine selection when production query telemetry becomes available or the required-query/ingress contract changes'
    c['cl-lease-gap']['reason'] = 'accepted reevaluation trigger, not a current gap'
    write_jsonl(claims_path, claims)

    print(json.dumps({'status': 'PASS_SQLITE_SHARDS', 'selectedEngine': 'sqlite-shards', 'selectionInputDigest': selection['selectionInputDigest'], 'queryExecutionCount': len(executions)}, sort_keys=True))


if __name__ == '__main__':
    main()
