#!/usr/bin/env python3
import argparse, hashlib, json, pathlib, subprocess

def digest(p):
    h = hashlib.sha256()
    with p.open('rb') as f:
        for c in iter(lambda: f.read(1024 * 1024), b''):
            h.update(c)
    return h.hexdigest()

def load(path):
    rows = [json.loads(x) for x in path.read_text().splitlines() if x.strip()]
    ids = [r['id'] for r in rows]
    if len(ids) != len(set(ids)):
        raise SystemExit(f'{path.name}: duplicate source id')
    return {r['id']: r for r in rows}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default='.')
    ap.add_argument('--work', required=True)
    a = ap.parse_args()
    root = pathlib.Path(a.root).resolve()
    work = pathlib.Path(a.work).resolve()
    lock = load(root / 'sources.lock.jsonl')
    receipt = load(work / 'source-receipt.jsonl')
    if set(lock) != set(receipt):
        raise SystemExit('source receipt closure mismatch')
    for ident, row in lock.items():
        rec = receipt[ident]
        if row['kind'] == 'git':
            got = subprocess.check_output(['git', '-C', str(work / 'sources' / ident), 'rev-parse', 'HEAD'], text=True).strip()
            if rec != {'id': ident, 'kind': 'git', 'revision': row['revision']} or got != row['revision']:
                raise SystemExit(f'{ident}: revision mismatch')
            continue
        if row['kind'] == 'url':
            p = work / 'cmake-deps' / row['filename']
            got_sha = digest(p)
            expected = {
                'id': ident, 'kind': 'url', 'url': row['url'],
                'filename': row['filename'], 'bytes': row['bytes'], 'sha256': got_sha
            }
            if rec != expected or p.stat().st_size != row['bytes']:
                raise SystemExit(f'{ident}: url receipt mismatch')
            if got_sha != row['sha256']:
                raise SystemExit(f'{ident}: sha256 mismatch')
            continue
        if row['kind'] != 'github-release-asset':
            raise SystemExit(f'{ident}: unsupported source kind')
        p = work / 'downloads' / row['name']
        got_sha = digest(p)
        expected = {
            'id': ident, 'kind': row['kind'], 'repo': row['repo'], 'tag': row['tag'],
            'assetId': row['assetId'], 'name': row['name'], 'bytes': row['bytes'], 'sha256': got_sha
        }
        if rec != expected or p.stat().st_size != row['bytes']:
            raise SystemExit(f'{ident}: release asset receipt mismatch')
        if row.get('sha256') and got_sha != row['sha256']:
            raise SystemExit(f'{ident}: sha256 mismatch')
    print((work / 'source-receipt.jsonl').read_text(), end='')
    print('sources: PASS')

if __name__ == '__main__':
    main()
