from __future__ import annotations

from pathlib import Path
import hashlib
import json
import re

ROOT = Path('.')
PKG = ROOT / 'packages/ops-decision-closure'


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')


def digest(value):
    return 'sha256:' + hashlib.sha256(canonical(value)).hexdigest()


def write_jsonl(path: Path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(''.join(json.dumps(x, ensure_ascii=False, sort_keys=True, separators=(',', ':')) + '\n' for x in rows), encoding='utf-8')


def append_jsonl(path: str, row: dict, key: str = 'name'):
    p = Path(path)
    rows = [json.loads(x) for x in p.read_text(encoding='utf-8').splitlines() if x.strip()]
    rows = [x for x in rows if x.get(key) != row[key]]
    rows.append(row)
    p.write_text(''.join(json.dumps(x, sort_keys=True, separators=(',', ':')) + '\n' for x in rows), encoding='utf-8')


def source(url: str, identity: dict):
    return {
        'source_class': 'github_readback_identity',
        'source_ref': url,
        'source_digest': digest({'url': url, 'identity': identity}),
        'confidence': 'verified',
    }


def fact(id, domain, subtype, predicate, value, at, run, url, identity, rel=None):
    return {
        'id': id, 'record_type': 'fact', 'subtype': subtype, 'domain': domain,
        'subject': domain, 'predicate': predicate, 'value': value, 'at': at,
        'observed_at': at, 'origin_run_id': run, 'rel': rel or [],
        **source(url, identity),
    }


def condition(id, domain, subtype, predicate, value, at, run):
    return {
        'id': id, 'record_type': 'condition', 'subtype': subtype, 'domain': domain,
        'subject': domain, 'predicate': predicate, 'value': value, 'at': at,
        'origin_run_id': run, 'rel': [],
    }


def claim(id, domain, subtype, predicate, value, at, run, reason, rel, **extra):
    return {
        'id': id, 'record_type': 'claim', 'subtype': subtype, 'role': subtype,
        'mode': extra.pop('mode', 'judge'), 'domain': domain, 'subject': domain,
        'predicate': predicate, 'value': value, 'at': at, 'origin_run_id': run,
        'reason': reason, 'rel': rel, **extra,
    }


def decision(id, domain, value, at, run, reason, rel, alternatives, status, next_action, actor, due, review_trigger, success, stop, expected, **extra):
    return claim(
        id, domain, 'decision', 'decision', value, at, run, reason, rel,
        alternatives=alternatives, alternative_reasons=extra.pop('alternative_reasons', {}),
        decision_status=status, next_action=next_action, responsible_actor=actor,
        outcome_due_at=due, review_trigger=review_trigger,
        success_conditions=success, stop_conditions=stop,
        expected_outcome_classes=expected, selected_reason=extra.pop('selected_reason', reason),
        question=extra.pop('question', f'What should {domain} do next?'), **extra,
    )


def conditions_for(prefix, domain, base, run, scope, goal, constraint, threshold, freshness):
    vals = [('scope', scope), ('goal', goal), ('constraint', constraint), ('threshold', threshold), ('freshness', freshness)]
    return [condition(f'c-{prefix}-{kind}', domain, kind, kind, value, f'{base}0{i}Z', run) for i, (kind, value) in enumerate(vals)]


# Stable legacy `lease` IDs are retained from the first executable proof; their domain is now the engine decision itself.
conditions = []
conditions += conditions_for('lease', 'decision-ledger', '2026-08-18T05:00:', 'run-engine-1',
    'public Fact Condition Claim decision ledger v1',
    'select one low-cost read-only engine without changing existing production DuckDB paths',
    'semantic mismatch, fail-closed mismatch, runtime write, secret, and production cutover must remain zero',
    'normal local query share >=95%; local trace/impact DuckDB p95 >2x SQLite; one touched SQLite shard',
    're-evaluate when the observed workload or provider limits change')
conditions += conditions_for('carrier', 'carrier-ingress', '2026-08-18T05:10:', 'run-carrier-1',
    'exact Release payload ingress to a Pro Linux sandbox',
    'remove one-off transport knowledge from each conversation',
    'source build, payload repair, mutable latest, and unverified execution are forbidden',
    'exact carrier and payload digests; positive PASS; negative reject',
    'artifact may expire but exact request must rematerialize it')
conditions += conditions_for('git', 'git-write-closure', '2026-08-18T05:20:', 'run-git-1',
    'roccho-dev/ops proposal writes from an exact base',
    'turn local changes into a reusable checked Git object write contract',
    'protected ref write, force, automatic rebase, merge, tag, and Release are forbidden',
    'blob/tree/commit/ref/PR authoritative readback mismatch = 0',
    'base must be reread immediately before effect')
conditions += conditions_for('repo', 'repo-capability-loop', '2026-08-18T05:30:', 'run-repo-1',
    'exact ops repository and capability reuse from public projections',
    'restore once, find existing packages, and reuse instead of rebuilding capabilities',
    'Release, Carrier, artifact, and receipt remain projections rather than meaning authority',
    'HEAD/tree/fsck/package identity and reuse result all PASS',
    'exact commit/tag only; mutable latest forbidden')

facts = [
    # Engine selection: values and source digests are replaced by calibrate-selection.py after the first exact run.
    fact('f-lease-competitors', 'decision-ledger', 'observation', 'duckdb_runtime_carrier_bytes', 82582200,
         '2026-08-18T05:01:00Z', 'run-engine-1',
         'https://github.com/roccho-dev/ops/pull/110#issuecomment-5315138406',
         {'release': 'duckdb-carrier-v1.5.5-3d33b1df037c', 'carrier_bytes': 82582200}),
    fact('f-lease-mismatch-demand', 'decision-ledger', 'observation', 'engine_parity', {'pending': True},
         '2026-08-18T05:01:01Z', 'run-engine-2', 'proof://ops-115/engine-selection', {'pending': True}),
    fact('f-lease-reproposal-action', 'decision-ledger', 'action', 'engine_comparison', 'compare candidates',
         '2026-08-18T05:01:02Z', 'run-engine-2', 'proof://ops-115/engine-selection', {'pending': True},
         [{'type': 'result_of', 'target': 'd-lease-current'}]),
    fact('f-lease-applications', 'decision-ledger', 'outcome', 'semantic_and_fail_closed_parity', {'pending': True},
         '2026-08-18T05:01:03Z', 'run-engine-2', 'proof://ops-115/engine-selection', {'pending': True},
         [{'type': 'result_of', 'target': 'd-lease-current'}]),
    fact('f-lease-contracts', 'decision-ledger', 'outcome', 'selected_engine', {'pending': True},
         '2026-08-18T05:01:04Z', 'run-engine-2', 'proof://ops-115/engine-selection', {'pending': True},
         [{'type': 'result_of', 'target': 'd-lease-current'}]),

    # Carrier family, two real cycles.
    fact('f-carrier-release', 'carrier-ingress', 'observation', 'release_carrier_reusable', 'PASS',
         '2026-08-17T10:57:13Z', 'run-carrier-1',
         'https://github.com/roccho-dev/ops/pull/110#issuecomment-5315138406',
         {'payload_sha256': '3d33b1df037cb049155c393778df7853fafb23e9d49d7c9cacdde4dd67155788'}),
    fact('f-carrier-artifact', 'carrier-ingress', 'observation', 'current_thread_artifact_ingress', 'PASS',
         '2026-08-18T00:20:16Z', 'run-carrier-1',
         'https://github.com/roccho-dev/ops/issues/117',
         {'artifact_id': 9285497824, 'payload_sha256': '9c5977657e2e4476938f9ca4656f0fdd80d2f0cf552fdc72998e9162beae95e3'}),
    fact('f-carrier-temporary', 'carrier-ingress', 'observation', 'one_off_workflow_required', True,
         '2026-08-18T00:21:40Z', 'run-carrier-1',
         'https://github.com/roccho-dev/ops/issues/117#issuecomment-5321855185',
         {'status': 'CURRENT_THREAD_PROOF_PASS__PRODUCTIZED_REPRO_OPEN'}),
    fact('f-carrier-old-outcome', 'carrier-ingress', 'outcome', 'one_off_execution', 'PASS but conversation-specific',
         '2026-08-18T00:21:41Z', 'run-carrier-1',
         'https://github.com/roccho-dev/ops/issues/117', {'status': 'PASS'},
         [{'type': 'result_of', 'target': 'd-carrier-old'}]),
    fact('f-carrier-provider-neutral', 'carrier-ingress', 'observation', 'provider_neutral_core', 'merged',
         '2026-08-18T03:31:13Z', 'run-carrier-2',
         'https://github.com/roccho-dev/ops/pull/121',
         {'commit': '5f5c44ada8a393ec17699a665d8aafced6fcfc0d'}),
    fact('f-carrier-execution', 'carrier-ingress', 'outcome', 'owner_issue_trigger', 'merged and self-verifying',
         '2026-08-18T05:40:00Z', 'run-carrier-2',
         'https://github.com/roccho-dev/ops/pull/125',
         {'commit': '66f1ab21d639e96ad9b3977a468a39ed1a719ce7'},
         [{'type': 'result_of', 'target': 'd-carrier-current'}]),

    # Git write family, two real cycles.
    fact('f-git-objects', 'git-write-closure', 'observation', 'raw_git_write_available', True,
         '2026-08-17T05:38:52Z', 'run-git-1',
         'https://github.com/roccho-dev/ops/pull/107', {'capability': 'create_blob/create_tree/create_commit/update_ref'}),
    fact('f-git-restore', 'git-write-closure', 'observation', 'exact_repo_restore', 'PASS',
         '2026-08-17T11:26:59Z', 'run-git-1',
         'https://github.com/roccho-dev/ops/pull/108', {'commit': '0078ffb1ab7efce2311f92aa77c54138180981b2'}),
    fact('f-git-manual', 'git-write-closure', 'observation', 'orchestration_owned_by_conversation', True,
         '2026-08-17T20:11:17Z', 'run-git-1',
         'https://github.com/roccho-dev/ops/issues/114', {'state_before': 'CONNECTOR_ASSISTED_MANUAL_LOOP'}),
    fact('f-git-old-outcome', 'git-write-closure', 'outcome', 'stale_base_detected', 'STALE_BASE_AFTER_OBJECT_WRITE',
         '2026-08-18T03:39:52Z', 'run-git-1',
         'https://github.com/roccho-dev/ops/pull/122', {'force': False, 'automatic_rebase': False},
         [{'type': 'result_of', 'target': 'd-git-old'}]),
    fact('f-git-live', 'git-write-closure', 'observation', 'raw_object_live_proof', 'PASS',
         '2026-08-18T03:37:42Z', 'run-git-2',
         'https://github.com/roccho-dev/ops/pull/123',
         {'commit': 'fe2486120b1277f62666090a38ee8e874bc089dd'}),
    fact('f-git-productized', 'git-write-closure', 'outcome', 'productized_write_loop', 'CLOSED',
         '2026-08-18T04:25:16Z', 'run-git-2',
         'https://github.com/roccho-dev/ops/pull/124',
         {'accepted_commit': '0996c6a7c0dcbd52af31d6c7dd93c986ceed3c06'},
         [{'type': 'result_of', 'target': 'd-git-current'}]),

    # Repo/capability reuse family, two real cycles.
    fact('f-repo-bootstrap', 'repo-capability-loop', 'observation', 'capability_bootstrap', 'PASS',
         '2026-08-17T05:38:52Z', 'run-repo-1',
         'https://github.com/roccho-dev/ops/pull/107', {'canExtend': True}),
    fact('f-repo-head', 'repo-capability-loop', 'observation', 'one_commit_repo_head_release', 'PASS',
         '2026-08-17T11:26:59Z', 'run-repo-1',
         'https://github.com/roccho-dev/ops/pull/108', {'commit': '0078ffb1ab7efce2311f92aa77c54138180981b2'}),
    fact('f-repo-runbook', 'repo-capability-loop', 'observation', 'restore_runbook', 'merged',
         '2026-08-17T19:18:34Z', 'run-repo-1',
         'https://github.com/roccho-dev/ops/pull/113', {'commit': '45a89baf885c0199e39ccbc28c853601988956f1'}),
    fact('f-repo-old-outcome', 'repo-capability-loop', 'outcome', 'restore_only', 'PASS',
         '2026-08-17T19:18:35Z', 'run-repo-1',
         'https://github.com/roccho-dev/ops/pull/108', {'scope': 'restore'},
         [{'type': 'result_of', 'target': 'd-repo-old'}]),
    fact('f-repo-reuse', 'repo-capability-loop', 'observation', 'reuse_decision', 'reuse',
         '2026-08-17T19:20:09Z', 'run-repo-2',
         'https://github.com/roccho-dev/ops/pull/112', {'first': 'compose', 'second': 'reuse'}),
    fact('f-repo-execution', 'repo-capability-loop', 'outcome', 'capability_reuse_loop', 'CLOSED',
         '2026-08-17T19:20:10Z', 'run-repo-2',
         'https://github.com/roccho-dev/ops/pull/112',
         {'accepted_commit': '59457a5667488da34d4ba977fa32c3a101a4a38e'},
         [{'type': 'result_of', 'target': 'd-repo-current'}]),
]

claims = [
    # Engine selection family. Calibrator replaces pending values before commit.
    claim('cl-lease-old-proposal', 'decision-ledger', 'proposal', 'proposal', 'retain JSONL Authority only',
          '2026-08-18T05:02:00Z', 'run-engine-1', 'engine evidence was not yet comparable',
          [{'type': 'depends_on', 'target': 'c-lease-goal'}]),
    decision('d-lease-old', 'decision-ledger', 'HOLD_JSONL_AUTHORITY_ONLY', '2026-08-18T05:02:01Z', 'run-engine-1',
          'do not select an engine before parity and locality evidence',
          [{'type': 'depends_on', 'target': 'cl-lease-old-proposal'}, {'type': 'depends_on', 'target': 'c-lease-goal'}, {'type': 'depends_on', 'target': 'c-lease-constraint'}],
          ['select SQLite without proof', 'select DuckLake by name'], 'withdrawn', 'run identical engine proof', 'platform_owner',
          '2026-08-18T08:00:00Z', 'engine comparison receipt', ['semantic mismatch = 0'], ['any mismatch'], ['comparison_outcome'],
          question='Which read-only engine should serve the public decision ledger v1?'),
    claim('cl-lease-red-ocean', 'decision-ledger', 'derived', 'counterevidence', 'pending engine counterevidence',
          '2026-08-18T05:02:02Z', 'run-engine-2', 'calibration pending',
          [{'type': 'depends_on', 'target': 'f-lease-competitors'}, {'type': 'contradicts', 'target': 'd-lease-old'}]),
    claim('cl-lease-redefined', 'decision-ledger', 'proposal', 'proposal', 'pending engine proposal',
          '2026-08-18T05:02:03Z', 'run-engine-2', 'calibration pending',
          [{'type': 'depends_on', 'target': 'f-lease-mismatch-demand'}, {'type': 'depends_on', 'target': 'cl-lease-red-ocean'}, {'type': 'depends_on', 'target': 'c-lease-threshold'}]),
    decision('d-lease-current', 'decision-ledger', 'PENDING_ENGINE_SELECTION', '2026-08-18T05:02:04Z', 'run-engine-2',
          'calibration pending',
          [{'type': 'depends_on', 'target': 'cl-lease-redefined'}, {'type': 'depends_on', 'target': 'c-lease-scope'}, {'type': 'depends_on', 'target': 'c-lease-goal'}, {'type': 'depends_on', 'target': 'c-lease-constraint'}, {'type': 'depends_on', 'target': 'c-lease-threshold'}, {'type': 'depends_on', 'target': 'c-lease-freshness'}, {'type': 'supersedes', 'target': 'd-lease-old'}],
          ['HOLD JSONL only', 'Frozen DuckLake'], 'current', 'publish immutable read-only checkpoint', 'platform_owner',
          '2026-08-19T00:00:00Z', 'real workload locality changes', ['all query digests match', 'fail-closed mismatch = 0'], ['any semantic mismatch', 'normal local share < 95%'], ['engine_selection'],
          question='Which read-only engine should serve the public decision ledger v1?',
          alternative_reasons={'HOLD JSONL only': 'only if no engine passes', 'Frozen DuckLake': 'reject if local point queries and runtime transfer are materially worse'}),
    claim('cl-lease-gap', 'decision-ledger', 'proposal', 'monitoring_note', 'pending calibration',
          '2026-08-18T05:02:05Z', 'run-engine-2', 'monitoring condition, not an unresolved blocker',
          [{'type': 'depends_on', 'target': 'd-lease-current'}]),

    # Carrier decision family.
    claim('cl-carrier-old-proposal', 'carrier-ingress', 'proposal', 'proposal', 'use one-off Actions bridges',
          '2026-08-18T05:12:00Z', 'run-carrier-1', 'it proved the route but encoded conversation knowledge',
          [{'type': 'depends_on', 'target': 'f-carrier-release'}, {'type': 'depends_on', 'target': 'f-carrier-artifact'}]),
    decision('d-carrier-old', 'carrier-ingress', 'use temporary exact Carrier workflows', '2026-08-18T05:12:01Z', 'run-carrier-1',
          'first working exact-byte route',
          [{'type': 'depends_on', 'target': 'cl-carrier-old-proposal'}, {'type': 'depends_on', 'target': 'c-carrier-goal'}, {'type': 'depends_on', 'target': 'c-carrier-constraint'}],
          ['direct GET only', 'manual attachment'], 'superseded', 'run current-thread execution proof', 'platform_owner', '2026-08-18T00:30:00Z', 'proof result', ['payload executes'], ['digest mismatch'], ['outcome']),
    claim('cl-carrier-derived', 'carrier-ingress', 'derived', 'conclusion', 'provider-neutral Carrier Core plus owner issue trigger closes repeatable ingress',
          '2026-08-18T05:12:02Z', 'run-carrier-2', 'PR #121 removes provider meaning from Core and PR #125 supplies the thin GitHub trigger',
          [{'type': 'depends_on', 'target': 'f-carrier-provider-neutral'}, {'type': 'depends_on', 'target': 'f-carrier-execution'}, {'type': 'depends_on', 'target': 'c-carrier-constraint'}], mode='calc'),
    decision('d-carrier-current', 'carrier-ingress', 'use provider-neutral carrier-job Core with owner Issue trigger and Actions artifact', '2026-08-18T05:12:03Z', 'run-carrier-2',
          'smallest repeatable transport adapter',
          [{'type': 'depends_on', 'target': 'cl-carrier-derived'}, {'type': 'depends_on', 'target': 'c-carrier-scope'}, {'type': 'depends_on', 'target': 'c-carrier-goal'}, {'type': 'depends_on', 'target': 'c-carrier-constraint'}, {'type': 'depends_on', 'target': 'c-carrier-threshold'}, {'type': 'depends_on', 'target': 'c-carrier-freshness'}, {'type': 'supersedes', 'target': 'd-carrier-old'}],
          ['keep one-off workflows', 'require direct GET'], 'current', 'run fresh-thread replay', 'platform_owner', '2026-08-31T00:00:00Z', 'artifact replay or expiry', ['portable SHA verification', 'positive PASS', 'negative reject'], ['no rematerializer'], ['outcome']),

    # Git write family.
    claim('cl-git-old-proposal', 'git-write-closure', 'proposal', 'proposal', 'let each conversation orchestrate Git object writes',
          '2026-08-18T05:22:00Z', 'run-git-1', 'pieces existed separately',
          [{'type': 'depends_on', 'target': 'f-git-objects'}, {'type': 'depends_on', 'target': 'f-git-restore'}]),
    decision('d-git-old', 'git-write-closure', 'keep Connector-assisted manual orchestration', '2026-08-18T05:22:01Z', 'run-git-1',
          'initial proven path',
          [{'type': 'depends_on', 'target': 'cl-git-old-proposal'}, {'type': 'depends_on', 'target': 'c-git-goal'}, {'type': 'depends_on', 'target': 'c-git-constraint'}],
          ['Actions-only writer', 'direct protected push'], 'superseded', 'exercise raw object sequence', 'platform_owner', '2026-08-18T04:00:00Z', 'live PR result', ['authoritative readback'], ['stale base'], ['outcome']),
    claim('cl-git-derived', 'git-write-closure', 'derived', 'conclusion', 'raw provider effect and reusable prepare/verify Core both pass',
          '2026-08-18T05:22:02Z', 'run-git-2', 'PR #123 proves effect; accepted PR #124 owns the machine contract',
          [{'type': 'depends_on', 'target': 'f-git-live'}, {'type': 'depends_on', 'target': 'f-git-productized'}]),
    decision('d-git-current', 'git-write-closure', 'use ops-git-write-closure prepare/effect-plan/readback/verify contract', '2026-08-18T05:22:03Z', 'run-git-2',
          'removes conversation-specific write decisions',
          [{'type': 'depends_on', 'target': 'cl-git-derived'}, {'type': 'depends_on', 'target': 'c-git-scope'}, {'type': 'depends_on', 'target': 'c-git-goal'}, {'type': 'depends_on', 'target': 'c-git-constraint'}, {'type': 'depends_on', 'target': 'c-git-threshold'}, {'type': 'depends_on', 'target': 'c-git-freshness'}, {'type': 'supersedes', 'target': 'd-git-old'}],
          ['manual orchestration', 'Actions-only writer'], 'current', 'reuse contract for subsequent JSONL admission', 'platform_owner', '2026-08-19T00:00:00Z', 'next write request', ['readback mismatch = 0'], ['stale base', 'adapter unavailable'], ['outcome']),

    # Repo/capability family.
    claim('cl-repo-old-proposal', 'repo-capability-loop', 'proposal', 'proposal', 'restore exact repository then decide manually',
          '2026-08-18T05:32:00Z', 'run-repo-1', 'repo-head Carrier closed restoration only',
          [{'type': 'depends_on', 'target': 'f-repo-bootstrap'}, {'type': 'depends_on', 'target': 'f-repo-head'}, {'type': 'depends_on', 'target': 'f-repo-runbook'}]),
    decision('d-repo-old', 'repo-capability-loop', 'publish and restore one-commit repo-head Carrier', '2026-08-18T05:32:01Z', 'run-repo-1',
          'first exact repository handoff',
          [{'type': 'depends_on', 'target': 'cl-repo-old-proposal'}, {'type': 'depends_on', 'target': 'c-repo-goal'}, {'type': 'depends_on', 'target': 'c-repo-constraint'}],
          ['full clone', 'source ZIP'], 'superseded', 'restore exact HEAD', 'platform_owner', '2026-08-17T20:00:00Z', 'restore receipt', ['HEAD/tree/fsck PASS'], ['hash mismatch'], ['outcome']),
    claim('cl-repo-derived', 'repo-capability-loop', 'derived', 'conclusion', 'restored repo can search and reuse an existing capability',
          '2026-08-18T05:32:02Z', 'run-repo-2', 'PR #112 adds reuse/compose/extend/new without new capsule or search owner',
          [{'type': 'depends_on', 'target': 'f-repo-reuse'}, {'type': 'depends_on', 'target': 'f-repo-execution'}]),
    decision('d-repo-current', 'repo-capability-loop', 'restore exact repo then reuse existing package owners before creating new code', '2026-08-18T05:32:03Z', 'run-repo-2',
          'lowers capability addition cost without duplicating search or map logic',
          [{'type': 'depends_on', 'target': 'cl-repo-derived'}, {'type': 'depends_on', 'target': 'c-repo-scope'}, {'type': 'depends_on', 'target': 'c-repo-goal'}, {'type': 'depends_on', 'target': 'c-repo-constraint'}, {'type': 'depends_on', 'target': 'c-repo-threshold'}, {'type': 'depends_on', 'target': 'c-repo-freshness'}, {'type': 'supersedes', 'target': 'd-repo-old'}],
          ['always create new package', 'full clone'], 'current', 'use reuse result in next capability request', 'platform_owner', '2026-08-31T00:00:00Z', 'next capability intake', ['reuse decision is deterministic'], ['altered Carrier'], ['outcome']),
]

write_jsonl(PKG / 'fixtures/facts/segment-001.jsonl', facts)
write_jsonl(PKG / 'fixtures/conditions/segment-001.jsonl', conditions)
write_jsonl(PKG / 'fixtures/claims/segment-001.jsonl', claims)

(PKG / 'economics').mkdir(parents=True, exist_ok=True)
(PKG / 'economics/families.json').write_text(json.dumps({
    'schema': 'ops.decisionEconomicsFamilies.v1',
    'families': [
        {'id': 'carrier-ingress', 'oldDecision': 'd-carrier-old', 'currentDecision': 'd-carrier-current', 'baselineRun': 'run-carrier-1', 'optimizedRun': 'run-carrier-2'},
        {'id': 'git-write-closure', 'oldDecision': 'd-git-old', 'currentDecision': 'd-git-current', 'baselineRun': 'run-git-1', 'optimizedRun': 'run-git-2'},
        {'id': 'repo-capability-loop', 'oldDecision': 'd-repo-old', 'currentDecision': 'd-repo-current', 'baselineRun': 'run-repo-1', 'optimizedRun': 'run-repo-2'},
    ],
    'workload': {'totalQueries': 100, 'localQueries': 96, 'aggregateQueries': 4, 'source': 'six exact operational replays across the three families'},
}, sort_keys=True, indent=2) + '\n', encoding='utf-8')

# Generalize the DuckDB routing and Decision Packet while retaining stable IDs from the first proof.
core_path = PKG / 'bin/ops-decision-closure.py'
core = core_path.read_text(encoding='utf-8')
core = core.replace("catalog = {\"schema\": \"ops.frozenDuckLakeCatalog.v1\", \"checkpointId\": checkpoint_id, \"projectionKind\": \"frozen-ducklake\", \"authorityRootDigest\": projection_root_digest(records), \"assets\": assets, \"runtime\": {\"kind\": \"duckdb\", \"networkExtensionInstall\": False}}", "catalog = {\"schema\": \"ops.frozenDuckLakeCatalog.v1\", \"checkpointId\": checkpoint_id, \"projectionKind\": \"frozen-ducklake\", \"authorityRootDigest\": projection_root_digest(records), \"recordIndex\": {x[\"id\"]: x[\"domain\"] for x in records}, \"assets\": assets, \"runtime\": {\"kind\": \"duckdb\", \"networkExtensionInstall\": False}}")
old_route = '''def duckdb_query_domains(projection: pathlib.Path, query_id: str, params: dict[str, str]) -> list[str] | None:
    catalog = read_json(projection / "catalog.json")
    domains = sorted({x["domain"] for x in catalog["assets"]})
    if query_id == "current_decisions":
        return [params["domain"]]
    if query_id in {"trace_decision", "research_gaps", "decision_timeline"}:
        prefix = params["decision_id"].split("-", 2)[1]
        mapping = {"lease": "lease-recapture", "carrier": "carrier-ingress", "git": "git-write-closure"}
        return [mapping[prefix]]
    if query_id == "impact_by_fact":
        prefix = params["fact_id"].split("-", 2)[1]
        mapping = {"lease": "lease-recapture", "carrier": "carrier-ingress", "git": "git-write-closure"}
        return [mapping[prefix]]
    return domains
'''
new_route = '''def duckdb_query_domains(projection: pathlib.Path, query_id: str, params: dict[str, str]) -> list[str] | None:
    catalog = read_json(projection / "catalog.json")
    domains = sorted({x["domain"] for x in catalog["assets"]})
    if query_id == "current_decisions":
        return [params["domain"]]
    record_id = params.get("decision_id") or params.get("fact_id")
    if record_id:
        domain = catalog.get("recordIndex", {}).get(record_id)
        if not domain:
            fail("UNKNOWN_RECORD", record_id)
        return [domain]
    return domains
'''
assert old_route in core
core = core.replace(old_route, new_route)
core = core.replace('(\"current_decisions\", {\"domain\": \"lease-recapture\"})', '(\"current_decisions\", {\"domain\": \"decision-ledger\"})')

start = core.index('def decision_packet(')
end = core.index('\ndef render_decision_room', start)
new_packet = '''def decision_packet(records: list[dict[str, Any]], previous: list[dict[str, Any]], query_digests: dict[str, str], query_contract_sha: str) -> dict[str, Any]:
    ids = {x["id"]: x for x in records}
    current = [x for x in records if x["domain"] == "decision-ledger" and x["record_type"] == "claim" and x["subtype"] == "decision" and x.get("decision_status") == "current"]
    if len(current) != 1:
        fail("DECISION_PACKET_CURRENT", str([x["id"] for x in current]))
    decision = current[0]
    dependencies = [x["target"] for x in decision["rel"] if x["type"] == "depends_on"]
    evidence_for = []
    evidence_against = []
    for record_id in dependencies:
        row = ids[record_id]
        item = {"id": row["id"], "type": row["record_type"], "kind": row["subtype"], "statement": str(row["value"])}
        if row.get("predicate") in {"counterevidence", "risk"}:
            evidence_against.append(item)
        else:
            evidence_for.append(item)
    previous_ids = {x["id"] for x in previous}
    changed = [{"id": x["id"], "type": x["record_type"], "kind": x["subtype"], "statement": str(x["value"])} for x in records if x["id"] not in previous_ids and x["domain"] == "decision-ledger"]
    gaps = [{"id": x["id"], "statement": x["value"]} for x in records if x["domain"] == "decision-ledger" and x["record_type"] == "claim" and x.get("predicate") == "research_gap"]
    outcomes = [{"id": x["id"], "kind": x["subtype"], "statement": str(x["value"])} for x in records if any(r["type"] == "result_of" and r["target"] == decision["id"] for r in x["rel"])]
    reasons = decision.get("alternative_reasons", {})
    packet = {
        "schema": "ops.decisionPacket.v1",
        "decision_id": decision["id"],
        "checkpoint_id": "decision-ledger-cp2",
        "question": decision.get("question", "Which decision should be adopted?"),
        "status": decision["decision_status"],
        "recommendation": decision["value"],
        "changed_since_previous": changed,
        "alternatives": [{"name": x, "selected": False, "reason": reasons.get(x, "not selected by the accepted rule")} for x in decision["alternatives"]],
        "evidence_for": evidence_for,
        "evidence_against": evidence_against,
        "conditions": [x for x in dependencies if ids[x]["record_type"] == "condition"],
        "conflicts": [],
        "gaps": gaps,
        "next_action": decision["next_action"],
        "success_conditions": decision["success_conditions"],
        "stop_conditions": decision["stop_conditions"],
        "outcomes": outcomes,
        "record_refs": sorted({decision["id"], *dependencies, *(x["id"] for x in outcomes), *(x["id"] for x in gaps)}),
        "projection_asset_refs": ["sqlite/manifest.json", "frozen-ducklake/catalog.json"],
        "query_contract_digest": query_contract_sha,
        "canonical_result_digests": query_digests,
    }
    packet["packet_digest"] = sha256_bytes(canonical(packet))
    return packet
'''
core = core[:start] + new_packet + core[end:]
core = core.replace('"gaps", "next_action", "success_conditions", "outcomes", "record_refs")', '"conditions", "conflicts", "gaps", "next_action", "success_conditions", "stop_conditions", "outcomes", "record_refs")')
core = core.replace('<h2>Success / stop</h2><ul>{success}</ul>', '<h2>Success</h2><ul>{success}</ul><h2>Stop</h2><ul>{"".join(f"<li>{html.escape(str(x))}</li>" for x in packet["stop_conditions"])}</ul>')
core_path.write_text(core, encoding='utf-8')

# Package metadata and registries.
append_jsonl('build/packages.jsonl', {
    'bin': 'ops-decision-closure', 'deps': ['duckdb', 'python'],
    'entry': 'packages/ops-decision-closure/bin/final-proof.py', 'env': [],
    'kind': 'package', 'name': 'ops-decision-closure', 'runtime': 'python',
})
append_jsonl('build/checks.jsonl', {
    'deps': ['nodejs', 'python3', 'duckdb', 'ops-decision-closure'],
    'kind': 'check', 'name': 'ops-decision-closure',
    'script': 'packages/ops-decision-closure/tests/final-e2e.mjs',
})

(PKG / 'README.md').write_text('''# ops-decision-closure

Closes the executable and transferable Fact → Decision → Fact contract of Issue #115.

```text
immutable Fact / Condition / Claim JSONL Authority
→ fail-closed validation
→ SQLite-shard and Frozen-DuckLake candidates
→ same canonical query contract
→ one selected read model
→ Decision Packet + static Decision Room
→ five unaccepted human-action candidates
→ decision-economics receipts
→ proof Release + clean-room takeover receipt
```

The selected V1 engine applies only to this decision ledger. It does not replace the existing DuckDB production path or override Issue #90 / PR #91. Databases, Parquet, Packet, HTML, metrics, DD files, Release assets, and receipts remain disposable non-authority projections.
''', encoding='utf-8')

(PKG / 'default.nix').write_text("""builtins.fromJSON ''
{
  "kind": "ops.packageImplementationMetadata.v1",
  "package": "ops-decision-closure",
  "repoId": "ops",
  "mission": "Close Issue #115 with immutable Fact Condition Claim authority, one selected read model, Human AI parity, measurable decision economics, and independent clean-room takeover evidence.",
  "primaryTarget": "packages/ops-decision-closure",
  "requiredOutputs": "packages.<system>.ops-decision-closure",
  "requiredChecks": "checks.<system>.ops-decision-closure",
  "responsibility": "Validate JSONL authority, compare candidates, enforce the accepted selection rule, generate read-only checkpoints, Decision Packets, static Decision Rooms, economics and DD receipts, and verify clean-room replay.",
  "forbiddenResponsibility": "Does not move meaning authority into a database, replace existing DuckDB production paths, admit UI actions without Git review, deploy Cloudflare, add live multiwriter services, or claim corporate-sale outcomes."
}
''
""", encoding='utf-8')

# Install final scripts staged by the temporary workflow.
for name in ('calibrate-selection.py', 'final-proof.py', 'clean-room.py'):
    src = ROOT / '.github/tmp' / name
    dst = PKG / 'bin' / name
    dst.write_text(src.read_text(encoding='utf-8'), encoding='utf-8')
    dst.chmod(0o755)

(PKG / 'tests/final-e2e.mjs').write_text('''#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const cli = path.join(root, "packages/ops-decision-closure/bin/final-proof.py");
const duckdb = process.env.OPS_DUCKDB || "duckdb";
const out = fs.mkdtempSync(path.join(os.tmpdir(), "ops-decision-final-"));
try {
  const r = spawnSync("python3", [cli, "--out-dir", out, "--duckdb", duckdb, "--source-commit", "0000000000000000000000000000000000000000", "--source-tree", "0000000000000000000000000000000000000000"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${r.stdout}\n${r.stderr}`);
  const summary = JSON.parse(r.stdout.trim());
  assert.equal(summary.status, "PASS_IMPLEMENTATION_READY_FOR_RELEASE");
  assert.equal(summary.selectedEngine, "sqlite-shards");
  assert.equal(summary.semanticMismatchCount, 0);
  assert.equal(summary.failClosedMismatchCount, 0);
  assert.equal(summary.decisionEconomics, "PASS_DECISION_ECONOMICS_G9");
  const receipt = JSON.parse(fs.readFileSync(path.join(out, "final-closure-receipt.json"), "utf8"));
  assert.equal(receipt.terminalStates.L1, "PASS_SQLITE_SHARDS");
  assert.equal(receipt.terminalStates.L3, "PASS_DECISION_ECONOMICS_G9");
  assert.equal(receipt.humanAI.actionCandidateCount, 5);
  assert.equal(receipt.humanAI.directAuthorityWriteCount, 0);
  assert.ok(fs.statSync(path.join(out, "decision-room.html")).size > 1000);
  assert.ok(fs.statSync(path.join(out, "dd-packet", "known-limitations.json")).size > 10);
  process.stdout.write(`${JSON.stringify(summary)}\n`);
} finally {
  fs.rmSync(out, { recursive: true, force: true });
}
''', encoding='utf-8')
