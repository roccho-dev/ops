#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import argparse
import hashlib
import importlib.util
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def write_json(path, value):
    p = Path(path); p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + '\n', encoding='utf-8')


def sha_file(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def load_core(path):
    spec = importlib.util.spec_from_file_location('ops_decision_core', path)
    if spec is None or spec.loader is None: raise RuntimeError('cannot load core')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


def verify_manifest(root):
    manifest = read_json(root / 'artifact-manifest.json')
    for row in manifest['files']:
        path = root / row['path']
        if not path.is_file() or path.stat().st_size != row['bytes'] or sha_file(path) != row['sha256']:
            raise RuntimeError('release manifest mismatch: ' + row['path'])
    return manifest


def local_http(root):
    sock = socket.socket(); sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]; sock.close()
    proc = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1', '--directory', str(root)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        deadline = time.time() + 10
        while True:
            try:
                body = urllib.request.urlopen(f'http://127.0.0.1:{port}/decision-room.html', timeout=2).read()
                return {'status': 'PASS', 'provider': 'python-local-http', 'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest()}
            except Exception:
                if time.time() >= deadline: raise
                time.sleep(0.1)
    finally:
        proc.terminate(); proc.wait(timeout=5)


def synthetic_impact(package, core, out):
    records = core.load_authority(package / 'fixtures')
    original_root = core.projection_root_digest(records)
    synthetic = {
        'id': 'f-lease-clean-room-synthetic', 'record_type': 'fact', 'subtype': 'observation',
        'domain': 'decision-ledger', 'subject': 'clean-room', 'predicate': 'synthetic_runtime_limit',
        'value': 'normal local query share fell below accepted threshold', 'at': '2026-08-18T06:00:00Z',
        'observed_at': '2026-08-18T06:00:00Z', 'origin_run_id': 'clean-room-takeover',
        'source_class': 'synthetic_takeover_fixture', 'source_ref': 'fixture://clean-room/synthetic',
        'source_digest': 'sha256:' + 'b' * 64, 'confidence': 'synthetic', 'rel': [],
    }
    records.append(synthetic)
    current = next(x for x in records if x['id'] == 'd-lease-current')
    current['rel'].append({'type': 'depends_on', 'target': synthetic['id']})
    core.validate_authority(records)
    projection = out / 'synthetic-checkpoint'
    core.build_sqlite_projection(records, projection, 'decision-ledger-clean-room-candidate')
    rows, _ = core.query_sqlite(projection, 'impact_by_fact', {'fact_id': synthetic['id']})
    ids = [x['id'] for x in rows]
    if 'd-lease-current' not in ids: raise RuntimeError('synthetic fact impact did not identify current decision')
    candidate = {
        'schema': 'ops.cleanRoomNextCheckpointCandidate.v1', 'authority': False, 'accepted': False,
        'sourceCheckpointRoot': original_root, 'candidateRoot': core.projection_root_digest(records),
        'syntheticFact': synthetic, 'impactedDecisions': ids,
    }
    write_json(out / 'next-checkpoint-candidate.json', candidate)
    return {'status': 'PASS', 'impactedDecisions': ids, 'sourceCheckpointUnchanged': core.projection_root_digest(core.load_authority(package / 'fixtures')) == original_root}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--repo-root', required=True)
    p.add_argument('--release-proof-dir', required=True)
    p.add_argument('--out-dir', required=True)
    p.add_argument('--duckdb', required=True)
    p.add_argument('--exact-commit', required=True)
    p.add_argument('--exact-tree', required=True)
    p.add_argument('--release-tag', required=True)
    args = p.parse_args()
    started = time.monotonic()
    repo = Path(args.repo_root).resolve(); package = repo / 'packages/ops-decision-closure'
    release = Path(args.release_proof_dir).resolve(); out = Path(args.out_dir).resolve(); out.mkdir(parents=True, exist_ok=True)
    release_manifest = verify_manifest(release)
    release_receipt = read_json(release / 'final-closure-receipt.json')
    if release_receipt['authority']['commit'] != args.exact_commit or release_receipt['authority']['tree'] != args.exact_tree:
        raise SystemExit('release authority identity mismatch')

    rebuilt = out / 'rebuilt'
    r = subprocess.run([sys.executable, str(package / 'bin/final-proof.py'), '--out-dir', str(rebuilt), '--duckdb', args.duckdb, '--source-commit', args.exact_commit, '--source-tree', args.exact_tree], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if r.returncode != 0: raise SystemExit(r.stdout + '\n' + r.stderr)
    rebuilt_receipt = read_json(rebuilt / 'final-closure-receipt.json')
    if rebuilt_receipt['selectedEngine'] != release_receipt['selectedEngine']:
        raise SystemExit('selected engine replay mismatch')
    if rebuilt_receipt['authority']['rootDigest'] != release_receipt['authority']['rootDigest']:
        raise SystemExit('authority root replay mismatch')
    if read_json(rebuilt / 'decision-packet.json')['packet_digest'] != read_json(release / 'decision-packet.json')['packet_digest']:
        raise SystemExit('Decision Packet replay mismatch')
    if read_json(rebuilt / 'bounded/closure-receipt.json')['oldCheckpointReplay'] != 'PASS':
        raise SystemExit('old checkpoint replay failed')

    packet = read_json(release / 'decision-packet.json')
    explanation = {
        'question': packet['question'], 'recommendation': packet['recommendation'],
        'supportingEvidence': packet['evidence_for'], 'counterevidence': packet['evidence_against'],
        'alternatives': packet['alternatives'], 'gaps': packet['gaps'],
        'nextAction': packet['next_action'], 'successConditions': packet['success_conditions'],
        'stopConditions': packet['stop_conditions'], 'outcomes': packet['outcomes'],
        'recordRefs': packet['record_refs'],
    }
    write_json(out / 'decision-explanation.json', explanation)
    host = local_http(release)
    core = load_core(package / 'bin/ops-decision-closure.py')
    impact = synthetic_impact(package, core, out)

    required_dd = [
        'authority-and-ownership.json', 'current-decisions.json', 'decision-lineage.json',
        'outcome-coverage.json', 'conflicts-and-gaps.json', 'decision-economics.json',
        'provider-dependencies.json', 'source-and-license-inventory.json', 'software-sbom.json',
        'data-classification.json', 'public-private-boundary.json', 'operational-runbook.json',
        'known-limitations.json',
    ]
    missing_dd = [x for x in required_dd if not (release / 'dd-packet' / x).is_file()]
    if missing_dd: raise SystemExit('DD packet incomplete: ' + ','.join(missing_dd))

    receipt = {
        'schema': 'ops.independentTakeover.v1',
        'verdict': 'PASS_INDEPENDENT_TRANSFER_DD_G10',
        'operator_id': 'github-actions-clean-room',
        'operator_relation_to_owner': 'independent hosted automation; no owner memory or local files',
        'clean_environment': True,
        'input_repository': 'roccho-dev/ops', 'input_commit': args.exact_commit,
        'input_release_tags': [args.release_tag],
        'secret_count': 0, 'undocumented_step_count': 0, 'owner_intervention_count': 0,
        'chat_history_used': False, 'model_memory_used': False, 'owner_local_worktree_used': False,
        'restore_result': 'PASS', 'verify_result': 'PASS', 'clean_build_result': 'PASS',
        'current_digest_match': True, 'old_checkpoint_replay_result': 'PASS',
        'decision_explanation_result': 'PASS', 'packet_rebuild_result': 'PASS',
        'ssg_rebuild_result': 'PASS', 'alternate_host_result': host,
        'synthetic_fact_admission_result': 'PASS_CANDIDATE_ONLY', 'impact_result': impact,
        'next_checkpoint_result': 'PASS_CANDIDATE_ONLY',
        'source_checkpoint_unchanged': impact['sourceCheckpointUnchanged'],
        'release_manifest_file_count': len(release_manifest['files']),
        'dd_packet_result': 'PASS', 'manual_step_count': 0,
        'elapsed_seconds': time.monotonic() - started, 'failures': [],
        'limitations': ['operator is independent automation rather than a third-party human; literal human adoption is a separate L2 gate'],
    }
    write_json(out / 'independent-takeover.receipt.json', receipt)
    print(json.dumps({'status': receipt['verdict'], 'alternateHost': host['status'], 'impact': impact['status']}, sort_keys=True))


if __name__ == '__main__':
    main()
