#!/usr/bin/env python3
import argparse, hashlib, json, pathlib, subprocess, urllib.request

UA = {'User-Agent': 'hayamimi-web-build/1', 'Accept': 'application/vnd.github+json'}

def sha256(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

def read_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA)) as src:
        return json.load(src)

def download(url, dst):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA['User-Agent']})) as src, dst.open('wb') as out:
        while True:
            chunk = src.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default='.')
    ap.add_argument('--work', required=True)
    a = ap.parse_args()
    root = pathlib.Path(a.root).resolve()
    work = pathlib.Path(a.work).resolve()
    (work / 'sources').mkdir(parents=True, exist_ok=True)
    (work / 'downloads').mkdir(parents=True, exist_ok=True)
    (work / 'cmake-deps').mkdir(parents=True, exist_ok=True)
    rows = [json.loads(x) for x in (root / 'sources.lock.jsonl').read_text().splitlines() if x.strip()]
    receipt = []
    for r in rows:
        if r['kind'] == 'git':
            dst = work / 'sources' / r['id']
            if not dst.exists():
                subprocess.run(['git', 'clone', '--filter=blob:none', '--no-checkout', r['repo'], str(dst)], check=True)
            subprocess.run(['git', '-C', str(dst), 'fetch', '--depth', '1', 'origin', r['revision']], check=True)
            subprocess.run(['git', '-C', str(dst), 'checkout', '--detach', r['revision']], check=True)
            got = subprocess.check_output(['git', '-C', str(dst), 'rev-parse', 'HEAD'], text=True).strip()
            if got != r['revision']:
                raise SystemExit(f"{r['id']}: revision mismatch")
            receipt.append({'id': r['id'], 'kind': 'git', 'revision': got})
            continue
        if r['kind'] == 'url':
            # Direct network input declared by identity. The mirror is a transport
            # fallback only: it must satisfy the same bytes and sha256, and the
            # receipt records the declared url so the closure stays byte-identical
            # regardless of which transport succeeded.
            dst = work / 'cmake-deps' / r['filename']
            if not dst.exists():
                last = None
                for source in [r['url']] + ([r['mirror']] if r.get('mirror') else []):
                    try:
                        download(source, dst)
                        break
                    except Exception as err:
                        last = err
                else:
                    raise SystemExit(f"{r['id']}: no transport succeeded: {last}")
            if dst.stat().st_size != r['bytes']:
                raise SystemExit(f"{r['id']}: byte size mismatch")
            got_sha = sha256(dst)
            if got_sha != r['sha256']:
                raise SystemExit(f"{r['id']}: sha256 mismatch")
            receipt.append({
                'id': r['id'], 'kind': 'url', 'url': r['url'],
                'filename': r['filename'], 'bytes': dst.stat().st_size, 'sha256': got_sha
            })
            continue
        if r['kind'] != 'github-release-asset':
            raise SystemExit(f"{r['id']}: unsupported source kind")
        meta = read_json(f"https://api.github.com/repos/{r['repo']}/releases/assets/{r['assetId']}")
        expected_url = f"https://github.com/{r['repo']}/releases/download/{r['tag']}/{r['name']}"
        if meta.get('id') != r['assetId'] or meta.get('name') != r['name'] or meta.get('size') != r['bytes'] or meta.get('browser_download_url') != expected_url:
            raise SystemExit(f"{r['id']}: release asset identity mismatch")
        dst = work / 'downloads' / r['name']
        if not dst.exists():
            download(meta['browser_download_url'], dst)
        if dst.stat().st_size != r['bytes']:
            raise SystemExit(f"{r['id']}: byte size mismatch")
        got_sha = sha256(dst)
        if r.get('sha256') and got_sha != r['sha256']:
            raise SystemExit(f"{r['id']}: sha256 mismatch")
        receipt.append({
            'id': r['id'], 'kind': r['kind'], 'repo': r['repo'], 'tag': r['tag'],
            'assetId': r['assetId'], 'name': r['name'], 'bytes': dst.stat().st_size, 'sha256': got_sha
        })
    (work / 'source-receipt.jsonl').write_text(''.join(json.dumps(x, sort_keys=True, separators=(',', ':')) + '\n' for x in receipt))

if __name__ == '__main__':
    main()
