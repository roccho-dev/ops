#!/usr/bin/env python3
import argparse, hashlib, json, pathlib

ALLOW = {
    'index.html',
    'runtime/api/hayamimi.mjs',
    'runtime/audio/history.js', 'runtime/audio/microphone.mjs', 'runtime/audio/pcm.worklet.mjs',
    'runtime/asr/client.mjs', 'runtime/asr/primary.worker.js', 'runtime/asr/second.worker.js',
    'runtime/model/manifest.mjs',
    'sherpa/sherpa-onnx-asr.js', 'sherpa/sherpa-onnx-vad.js',
    'sherpa/sherpa-onnx-wasm-main-vad-asr.js', 'sherpa/sherpa-onnx-wasm-main-vad-asr.wasm',
    'sherpa/sherpa-onnx-wasm-main-vad-asr.data',
    'sherpa-pja/sherpa-onnx-asr.js', 'sherpa-pja/sherpa-onnx-vad.js',
    'sherpa-pja/sherpa-onnx-wasm-main-vad-asr.js', 'sherpa-pja/sherpa-onnx-wasm-main-vad-asr.wasm',
    'sherpa-pja/sherpa-onnx-wasm-main-vad-asr.data',
    'THIRD_PARTY_NOTICES.md', 'manifest.json',
}

def sha(p):
    h = hashlib.sha256()
    with p.open('rb') as f:
        for c in iter(lambda: f.read(1024 * 1024), b''):
            h.update(c)
    return h.hexdigest()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('dist')
    a = ap.parse_args()
    root = pathlib.Path(a.dist).resolve()
    actual = {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()}
    missing = ALLOW - actual
    extra = actual - ALLOW
    if missing:
        raise SystemExit('missing: ' + ', '.join(sorted(missing)))
    if extra:
        raise SystemExit('unexpected runtime files: ' + ', '.join(sorted(extra)))
    m = json.loads((root / 'manifest.json').read_text())
    if m.get('schema') != 'roccho.hayamimi-web.dist/1':
        raise SystemExit('manifest schema mismatch')
    rows = {x['path']: x for x in m['files']}
    expected = ALLOW - {'manifest.json'}
    if set(rows) != expected:
        raise SystemExit('manifest closure mismatch')
    for rel, r in rows.items():
        p = root / rel
        if p.stat().st_size != r['bytes'] or sha(p) != r['sha256']:
            raise SystemExit(f'manifest mismatch: {rel}')
    print('dist: PASS')

if __name__ == '__main__':
    main()
