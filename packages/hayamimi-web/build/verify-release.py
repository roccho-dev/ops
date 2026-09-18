#!/usr/bin/env python3
import argparse, hashlib, pathlib, shutil, stat, zipfile

def sha256(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('archive')
    ap.add_argument('checksum')
    ap.add_argument('--out', required=True)
    a = ap.parse_args()

    archive = pathlib.Path(a.archive).resolve()
    checksum = pathlib.Path(a.checksum).resolve()
    out = pathlib.Path(a.out).resolve()

    parts = checksum.read_text().strip().split()
    if len(parts) != 2 or parts[1] != archive.name:
        raise SystemExit('checksum file shape mismatch')
    if sha256(archive) != parts[0]:
        raise SystemExit('release ZIP sha256 mismatch')

    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    with zipfile.ZipFile(archive) as z:
        files = []
        for info in z.infolist():
            path = pathlib.PurePosixPath(info.filename)
            if path.is_absolute() or '..' in path.parts:
                raise SystemExit(f'unsafe ZIP path: {info.filename}')
            mode = info.external_attr >> 16
            if stat.S_ISLNK(mode):
                raise SystemExit(f'ZIP symlink forbidden: {info.filename}')
            if not info.is_dir():
                files.append(path)
        if not files or any(not p.parts or p.parts[0] != 'hayamimi-web' for p in files):
            raise SystemExit('ZIP root must be exactly hayamimi-web/')
        z.extractall(out)

    roots = {p.name for p in out.iterdir()}
    if roots != {'hayamimi-web'}:
        raise SystemExit('extracted root closure mismatch')
    print('release ZIP: PASS')

if __name__ == '__main__':
    main()
