#!/usr/bin/env python3
"""Write and verify the hayamimi-web release record.

proof       merged-PR proof from GitHub API JSON (pull and its reviews); the
            latest non-dismissed review on the exact head must be Green
selftest    verdict-rule cases
provenance  provenance for the packaged zip
verify      check a release directory holds exactly the published set and
            that its digests, provenance and proof agree with one exact SHA
"""
import argparse, hashlib, json, pathlib, re

ZIP = 'hayamimi-web.zip'
ASSETS = {ZIP, ZIP + '.sha256', 'provenance.json', 'merged-pr-proof.json'}
DIGEST = re.compile(r'[0-9a-f]{64}')
GREEN = re.compile(r'\bROUND_\d+_GREEN\b')
CORRECTIONS = re.compile(r'\bROUND_\d+_CORRECTIONS\b')


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


def green_verdict(reviews, head):
    """URL of the latest non-dismissed review on the exact head, which must be Green.

    Green means the body has exactly one distinct ROUND_<n>_GREEN token and no
    ROUND_<n>_CORRECTIONS token, so a Corrections review that names the future
    Green token does not count. This is verdict evidence, not reviewer
    identity: the token is the only machine-readable signal, and a later
    non-Green review on the same head withdraws it.
    """
    on_head = sorted((r for r in reviews if r.get('commit_id') == head and r.get('submitted_at')
                      and r.get('state') != 'DISMISSED'), key=lambda r: r['submitted_at'])
    if not on_head:
        raise SystemExit('no non-dismissed review recorded on the exact reviewed head')
    latest = on_head[-1]
    body = latest.get('body') or ''
    if len(set(GREEN.findall(body))) != 1 or CORRECTIONS.search(body) or not latest.get('html_url'):
        raise SystemExit('latest review on the exact reviewed head is not a ROUND_n_GREEN verdict')
    return latest['html_url']


def selftest(a):
    head = 'a' * 40
    review = lambda body, at, commit=head, state='COMMENTED': {
        'commit_id': commit, 'submitted_at': at, 'body': body, 'html_url': f'u/{at}', 'state': state}
    good = [
        [review('Verdict: `ROUND_2_GREEN`.', 't2')],
        [review('ROUND_1_CORRECTIONS', 't1'), review('ROUND_2_GREEN', 't2')],
        [review('ROUND_1_GREEN', 't1', state='DISMISSED'), review('ROUND_2_GREEN', 't2')],
        [review('ROUND_2_GREEN', 't1'), review('ROUND_2_CORRECTIONS', 't2', state='DISMISSED')],
    ]
    for reviews in good:
        assert green_verdict(reviews, head) == [r for r in reviews if r['state'] != 'DISMISSED'][-1]['html_url'], reviews
    bad = [
        [review('Verdict: `ROUND_1_CORRECTIONS`.', 't1')],
        [review('ROUND_1_GREEN', 't1'), review('ROUND_2_CORRECTIONS', 't2')],
        [],
        [review('ROUND_1_GREEN', 't1', commit='b' * 40)],
        [review('green, looks fine', 't1')],
        [review('ROUND_2_CORRECTIONS; post ROUND_2_GREEN only after CI', 't1')],
        [review('ROUND_3_GREEN. The earlier ROUND_2_CORRECTIONS items are closed.', 't1')],
        [review('ROUND_2_GREEN', 't1', state='DISMISSED')],
        [review('ROUND_1_GREEN then ROUND_2_GREEN', 't1')],
        [review('round_2_green, ROUND_2_GREENISH, xROUND_2_GREEN', 't1')],
    ]
    for reviews in bad:
        try:
            green_verdict(reviews, head)
        except SystemExit:
            continue
        raise AssertionError(f'accepted a non-Green verdict: {reviews}')
    print(json.dumps({'verdict': {'positive': len(good), 'negative': len(bad)}}))


def proof(a):
    pr = json.loads(pathlib.Path(a.pr).read_text())
    reviews = json.loads(pathlib.Path(a.reviews).read_text())
    head = pr['head']['sha']
    if not pr.get('merged_at') or pr['base']['ref'] != 'proposals' or pr.get('merge_commit_sha') != a.merge_sha:
        raise SystemExit('source is not an exact merged proposals PR for this SHA')
    verdict = green_verdict(reviews, head)
    if a.head_tree != a.merge_tree:
        raise SystemExit('reviewed tree differs from merge tree; an R re-review of the merge SHA is required')
    write(a.out, {
        'pr_number': pr['number'],
        'r_exact_head_verdict_ref': verdict,
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
    sub.add_parser('selftest')
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
    {'selftest': selftest, 'proof': proof, 'provenance': provenance, 'verify': verify}[a.cmd](a)


if __name__ == '__main__':
    main()
