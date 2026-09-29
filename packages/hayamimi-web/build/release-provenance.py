#!/usr/bin/env python3
"""Write and verify the hayamimi-web release record.

proof       merged-PR proof from GitHub API JSON (pull and its reviews)
provenance  provenance for the packaged zip
verify      check a release directory holds exactly the published set and
            that its digests, provenance and proof agree with one exact SHA
"""
import argparse, hashlib, json, pathlib, re

ZIP = 'hayamimi-web.zip'
ASSETS = {ZIP, ZIP + '.sha256', 'provenance.json', 'merged-pr-proof.json'}
DIGEST = re.compile(r'[0-9a-f]{64}')


def sha256(path):
    h = hashlib.sha256()
    with pathlib.Path(path).open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def locator(repository, sha):
    return f'https://github.com/{repository}/releases/download/hayamimi-web-{sha}/{ZIP}'


def write(path, value):
    pathlib.Path(path).write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')


def proof(a):
    pr = json.loads(pathlib.Path(a.pr).read_text())
    reviews = json.loads(pathlib.Path(a.reviews).read_text())
    head = pr['head']['sha']
    if not pr.get('merged_at') or pr['base']['ref'] != 'proposals' or pr.get('merge_commit_sha') != a.merge_sha:
        raise SystemExit('source is not an exact merged proposals PR for this SHA')
    verdicts = [r for r in reviews if r.get('commit_id') == head and r.get('html_url')]
    if not verdicts:
        raise SystemExit('no review recorded on the exact reviewed head')
    if a.head_tree != a.merge_tree:
        raise SystemExit('reviewed tree differs from merge tree; an R re-review of the merge SHA is required')
    write(a.out, {
        'pr_number': pr['number'],
        'r_exact_head_verdict_ref': max(verdicts, key=lambda r: r.get('submitted_at') or '')['html_url'],
        'merged_at': pr['merged_at'],
        'base': 'proposals',
        'reviewed_head': head,
        'reviewed_tree': a.head_tree,
        'merge_sha': a.merge_sha,
        'merge_tree': a.merge_tree,
    })


def provenance(a):
    root = pathlib.Path(a.root)
    z = pathlib.Path(a.zip)
    write(a.out, {
        'schema': 'roccho.hayamimi-web.release-provenance/1',
        'producer': {'repository': a.repository, 'workflow_ref': a.workflow_ref, 'run_id': a.run_id, 'run_attempt': a.run_attempt},
        'source': {'repository': a.repository, 'commit': a.sha, 'tree': a.tree},
        'input_digests': {
            'flake.lock': sha256(root / 'flake.lock'),
            'packages/hayamimi-web/sources.lock.jsonl': sha256(root / 'packages/hayamimi-web/sources.lock.jsonl'),
        },
        'artifact': {'name': ZIP, 'bytes': z.stat().st_size, 'sha256': sha256(z)},
        'locator': locator(a.repository, a.sha),
        'cross_host_bytes_reproducible': False,
    })


def verify(a):
    d = pathlib.Path(a.dir)
    names = {p.name for p in d.iterdir()}
    if names != ASSETS:
        raise SystemExit(f'release set must be exactly {sorted(ASSETS)}, found {sorted(names)}')
    digest = sha256(d / ZIP)
    if (d / (ZIP + '.sha256')).read_text().split() != [digest, ZIP]:
        raise SystemExit('zip sha256 file does not match the zip')
    p = json.loads((d / 'provenance.json').read_text())
    q = json.loads((d / 'merged-pr-proof.json').read_text())
    checks = {
        'provenance source commit': p['source']['commit'] == a.sha,
        'provenance repository': p['source']['repository'] == a.repository,
        'provenance digest': p['artifact'] == {'name': ZIP, 'bytes': (d / ZIP).stat().st_size, 'sha256': digest},
        'provenance locator': p['locator'] == locator(a.repository, a.sha),
        'not cross-host reproducible': p['cross_host_bytes_reproducible'] is False,
        'input digests': len(p['input_digests']) == 2 and all(DIGEST.fullmatch(v) for v in p['input_digests'].values()),
        'proof merge sha': q['merge_sha'] == a.sha,
        'proof base': q['base'] == 'proposals',
        'proof trees equal': q['reviewed_tree'] == q['merge_tree'],
        'proof complete': all(q.get(k) for k in ('pr_number', 'r_exact_head_verdict_ref', 'merged_at', 'reviewed_head', 'reviewed_tree', 'merge_tree')),
    }
    failed = [k for k, ok in checks.items() if not ok]
    if failed:
        raise SystemExit('release record mismatch: ' + ', '.join(failed))
    print(f'release set {a.sha}: PASS')


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('proof')
    for k in ('--pr', '--reviews', '--head-tree', '--merge-sha', '--merge-tree', '--out'):
        p.add_argument(k, required=True)
    p = sub.add_parser('provenance')
    for k in ('--zip', '--root', '--repository', '--sha', '--tree', '--workflow-ref', '--run-id', '--run-attempt', '--out'):
        p.add_argument(k, required=True)
    p = sub.add_parser('verify')
    p.add_argument('dir')
    for k in ('--sha', '--repository'):
        p.add_argument(k, required=True)
    a = ap.parse_args()
    {'proof': proof, 'provenance': provenance, 'verify': verify}[a.cmd](a)


if __name__ == '__main__':
    main()
