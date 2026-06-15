#!/usr/bin/env python3
from __future__ import annotations
import argparse, collections, hashlib, json, pathlib, sys

EXPECTED_MIGRATION_CASES = 14
EXPECTED_PERMANENT_CASES = 16


def read_jsonl(path: pathlib.Path):
    rows=[]
    for i,line in enumerate(path.read_text(encoding='utf-8').splitlines(),1):
        if not line.strip():
            continue
        try:
            rows.append(json.loads(line))
        except Exception as e:
            raise SystemExit(f"FAIL: JSONL parse failed {path}:{i}: {e}")
    return rows

def read_json(path: pathlib.Path):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except Exception as e:
        raise SystemExit(f"FAIL: JSON parse failed {path}: {e}")

def canon(obj):
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')

def sha(obj):
    return hashlib.sha256(canon(obj)).hexdigest()

def fail(msg):
    raise SystemExit('FAIL: '+msg)

def check(cond, msg):
    if not cond:
        fail(msg)

def no_dups(vals, name):
    c=collections.Counter(vals)
    d=[k for k,v in c.items() if v>1]
    check(not d, f'duplicate {name}: {d[:10]}')

def parse_everything(root: pathlib.Path):
    for p in root.rglob('*.json'):
        if '.git' in p.parts:
            continue
        read_json(p)
    for p in root.rglob('*.jsonl'):
        if '.git' in p.parts:
            continue
        read_jsonl(p)

def projection_payload(package, edges):
    d=package['definition']
    return {
        'packageId': package['packageId'],
        'specId': package['specId'],
        'status': package['status'],
        'successorRepoId': d.get('successorRepoId'),
        'repoSourceUri': d.get('repoSourceUri'),
        'officialOutput': d.get('officialOutput'),
        'requiredOutputs': d.get('requiredOutputs') or [],
        'requiredChecks': d.get('requiredChecks') or [],
        'requiredCheckPackages': d.get('requiredCheckPackages') or [],
        'requiredCommands': d.get('requiredCommands') or [],
        'allowedPaths': d.get('allowedPaths') or [],
        'forbiddenPaths': d.get('forbiddenPaths') or [],
        'runtimeRequirements': d.get('runtimeRequirements'),
        'preflightRequiredTools': d.get('preflightRequiredTools') or [],
        'dependencyLock': edges,
        'recordDigest': package['recordDigest'],
    }



def derive_feat_inputs(packages, by_edge):
    rows = []
    for package in packages:
        pd = sha(projection_payload(package, by_edge.get(package['packageId'], [])))

        if package.get('status') == 'accepted':
            status = 'ready'
        elif package.get('status') == 'planned':
            status = 'planned-blocked'
        elif package.get('status') == 'deprecated':
            status = 'deprecated-decision-needed'
        else:
            status = 'unsupported-status'

        definition = package.get('definition') or {}
        rows.append({
            'kind': 'feat.input.v1',
            'packageId': package['packageId'],
            'status': status,
            'projectionDigest': pd,
            'rawAdrDirectAuthority': False,
            'sourceAuthority': 'governance-records-main/records/specs/package-contract.v1.jsonl',
            'environmentBuildDefinition': {
                'officialOutput': definition.get('officialOutput'),
                'requiredOutputs': definition.get('requiredOutputs') or [],
                'requiredChecks': definition.get('requiredChecks') or [],
                'requiredCommands': definition.get('requiredCommands') or [],
                'runtimeRequirements': definition.get('runtimeRequirements'),
                'preflightRequiredTools': definition.get('preflightRequiredTools') or [],
            },
            'repoOperation': {
                'allowedPaths': definition.get('allowedPaths') or [],
                'forbiddenPaths': definition.get('forbiddenPaths') or [],
            },
        })
    return rows

def load_feat_rows(root: pathlib.Path, packages, by_edge):
    generated = root/'governance-records-main/generated/feat-inputs.v1.jsonl'
    if generated.exists():
        return {f['packageId']: f for f in read_jsonl(generated)}, 'generated-artifact'
    if (root/'governance-records-main/generated').exists():
        fail('generated directory exists without canonical feat-inputs projection')
    return {f['packageId']: f for f in derive_feat_inputs(packages, by_edge)}, 'derived-from-records-no-generated-artifact'

def run(root: pathlib.Path, mode: str):
    parse_everything(root)
    provenance=read_json(root/'governance-records-main/records/provenance/source-canonical.v1.json')
    expected_packages=provenance['packageCountAfterProposalContract']
    check(provenance['baseHash']=='9a55d2ad8b53', 'unexpected base hash')

    final_manifest=read_json(root/'governance-records-main/records/migration/final-state-manifest.v1.json')
    check(final_manifest['finalState']['activeSpecsRepoPresent'] is False, 'final state must require no active specs repo')
    if mode == 'final':
        check(not (root/'specs-main').exists(), 'final mode forbids active specs-main')
    else:
        check((root/'specs-main/packages/specsless-canonical-cutover/default.nix').is_file(), 'proposal mode requires specs contract')
        check((root/'ops-main/packages/ops-specsless-readiness/bin/ops-specsless-readiness.py').is_file(), 'ops implementation missing')

    adrs=read_jsonl(root/'adrs-main/records/raw/adr.v1.jsonl')
    adr=[a for a in adrs if (a.get('id') or a.get('adrId'))=='adr-20260604-specsless-canonical-cutover-proposal']
    check(len(adr)==1, 'canonical cutover ADR missing')
    check(adr[0]['rawAdrOperatingModel']['directRepoOperationFromRawAdrAllowed'] is False, 'raw ADR direct operation must be false')

    purposes=read_jsonl(root/'governance-records-main/records/purpose/purpose-generation.v1.jsonl')
    check([p['generation'] for p in purposes]==list(range(11)), 'purpose generations 0..10 missing or unordered')
    check(purposes[-1]['purpose']=='retained earnings (assumption)', 'meta^10 must be retained earnings assumption')

    packages=read_jsonl(root/'governance-records-main/records/specs/package-contract.v1.jsonl')
    check(len(packages)==expected_packages, f'package contract count mismatch: {len(packages)} != {expected_packages}')
    allowed_statuses={'accepted','planned','deprecated'}
    bad_statuses=[(p['packageId'], p.get('status')) for p in packages if p.get('status') not in allowed_statuses]
    check(not bad_statuses, f'unsupported package statuses: {bad_statuses[:10]}')
    bad_definition_statuses=[
        (p['packageId'], p['definition'].get('status'))
        for p in packages
        if p['definition'].get('status') is not None and p['definition'].get('status') not in allowed_statuses
    ]
    check(not bad_definition_statuses, f'unsupported package definition statuses: {bad_definition_statuses[:10]}')
    no_dups([p['packageId'] for p in packages], 'packageId')
    no_dups([p['specId'] for p in packages], 'specId')
    no_dups([p['definition'].get('officialOutput') for p in packages if p['definition'].get('officialOutput')], 'officialOutput')
    check(any(p['packageId']=='specsless-canonical-cutover' for p in packages), 'specsless package contract not materialized')
    check(all(p['definition'].get('successorRepoId') not in ('specs','spec') for p in packages), 'successorRepoId must not be specs/spec')

    by_pkg={p['packageId']:p for p in packages}
    edges=read_jsonl(root/'governance-records-main/records/specs/dependency-edge.v1.jsonl')
    by_edge=collections.defaultdict(list)
    for e in edges:
        by_edge[e['fromPackageId']].append(e)
        if e['resolution']=='externalOrNotYetModeled':
            check(e['toPackageIds']==[], f'external dependency must not bind packages: {e}')
        else:
            check(len(e['toPackageIds'])==1, f'ambiguous dependency edge: {e}')
    feat_rows, feat_source = load_feat_rows(root, packages, by_edge)
    check(set(feat_rows)=={p['packageId'] for p in packages}, 'feat input package set mismatch')
    digest_rows={d['packageId']:d for d in read_jsonl(root/'governance-records-main/records/specs/projection-digest.v1.jsonl')}
    check(set(digest_rows)==set(feat_rows), 'projection digest set mismatch')
    for pid,p in by_pkg.items():
        pd=sha(projection_payload(p, by_edge[pid]))
        f=feat_rows[pid]
        check(f['projectionDigest']==pd, f'feat projection digest mismatch for {pid}')
        check(digest_rows[pid]['projectionDigest']==pd, f'projection digest row mismatch for {pid}')
        check(f['sourceAuthority']=='governance-records-main/records/specs/package-contract.v1.jsonl', f'bad source authority for {pid}')
        check(f['rawAdrDirectAuthority'] is False, f'raw ADR direct authority not false for {pid}')
        if p['status']=='accepted':
            check(f['status']=='ready', f'accepted package not ready: {pid}')
        if p['status']=='planned':
            check(f['status']=='planned-blocked', f'planned package not blocked: {pid}')
        if p['status']=='deprecated':
            check(f['status']=='deprecated-decision-needed', f'deprecated package not decision-needed: {pid}')

    allowances={a['capability'] for a in read_jsonl(root/'governance-records-main/records/specs/factorization-allowance.v1.jsonl')}
    provides=collections.defaultdict(list)
    for p in packages:
        for cap in p['definition'].get('provides') or []:
            if isinstance(cap,str):
                provides[cap].append(p['packageId'])
    for cap, owners in provides.items():
        if len(owners)>1:
            check(cap in allowances, f'duplicate provide without factorization allowance: {cap}')

    cases=read_jsonl(root/'repo-boundary-guard-main/records/destructive-cases/specs-retirement.v1.jsonl')
    runs=read_jsonl(root/'repo-boundary-guard-main/records/destructive-cases/specs-retirement-run.v1.jsonl')
    check(len(cases)==EXPECTED_MIGRATION_CASES+EXPECTED_PERMANENT_CASES, 'destructive case count mismatch')
    mig=sum(1 for c in cases if c['caseClass']=='migration-only')
    perm=sum(1 for c in cases if c['caseClass']=='post-migration-permanent-hardening')
    check(mig==EXPECTED_MIGRATION_CASES and perm==EXPECTED_PERMANENT_CASES, f'destructive case class mismatch: {mig}+{perm}')
    run_by={r['caseId']:r for r in runs}
    check(set(run_by)=={c['caseId'] for c in cases}, 'destructive case run set mismatch')
    check(all(r['status']=='pass' for r in runs), 'not all destructive case runs pass')

    issue_rows=read_jsonl(root/'issue-ledger-main/issues/issue-record.v1.jsonl')
    check(any(i['issueId']=='specsless-canonical-cutover-20260604' for i in issue_rows), 'issue-ledger-main cutover issue missing')
    check(all(i.get('targetRepo')!='specs' for i in issue_rows), 'successor issue ledger targetRepo must not be specs')

    check((root/'governance-nix-main/tools/make-feat-input.py').is_file(), 'governance-nix projection tool missing')
    check((root/'repo-boundary-guard-main/tools/specsless_ci.py').is_file(), 'repo-boundary-guard CI missing')
    accepted=sum(1 for p in packages if p['status']=='accepted')
    planned=sum(1 for p in packages if p['status']=='planned')
    deprecated=sum(1 for p in packages if p['status']=='deprecated')
    return {'status':'pass','mode':mode,'baseHash':provenance['baseHash'],'packages':len(packages),'acceptedPackages':accepted,'plannedPackages':planned,'deprecatedPackages':deprecated,'featInputs':len(feat_rows),'featInputSource':feat_source,'destructiveCases':len(cases),'migrationCases':mig,'permanentCases':perm,'purposeGenerations':len(purposes)}

def self_test():
    payload={'kind':'self-test','ok':True}
    return {'status':'pass','mode':'self-test','digest':sha(payload)}

def main(argv=None):
    ap=argparse.ArgumentParser()
    ap.add_argument('--root', default='.')
    ap.add_argument('--mode', choices=['proposal','final'], default='proposal')
    ap.add_argument('--self-test', action='store_true')
    ap.add_argument('--json', action='store_true')
    args=ap.parse_args(argv)
    result = self_test() if args.self_test else run(pathlib.Path(args.root).resolve(), args.mode)
    text=json.dumps(result, ensure_ascii=False, sort_keys=True)
    print(text if args.json else 'specsless-readiness:'+text)

if __name__=='__main__':
    main()
