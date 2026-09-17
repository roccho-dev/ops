#!/usr/bin/env python3
import argparse, hashlib, json, pathlib
REQ={'index.html','chat.mjs','chat.css','runtime/api/hayamimi.mjs','runtime/audio/microphone.mjs','runtime/audio/pcm.worklet.mjs','runtime/asr/client.mjs','runtime/asr/primary.worker.js','runtime/asr/second.worker.js','runtime/model/manifest.mjs','sherpa/sherpa-onnx-wasm-main-vad-asr.js','sherpa/sherpa-onnx-wasm-main-vad-asr.wasm','sherpa/sherpa-onnx-wasm-main-vad-asr.data','sherpa-pja/sherpa-onnx-wasm-main-vad-asr.js','sherpa-pja/sherpa-onnx-wasm-main-vad-asr.wasm','sherpa-pja/sherpa-onnx-wasm-main-vad-asr.data','THIRD_PARTY_NOTICES.md','manifest.json'}
FORBID={'.py','.sh','.dart','.ps1','.bat','.command'}
def sha(p):
    h=hashlib.sha256(); h.update(p.read_bytes()); return h.hexdigest()
def main():
    ap=argparse.ArgumentParser(); ap.add_argument('dist'); a=ap.parse_args(); root=pathlib.Path(a.dist).resolve()
    actual={p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()}
    miss=REQ-actual
    if miss: raise SystemExit('missing: '+', '.join(sorted(miss)))
    bad=[p for p in actual if pathlib.Path(p).suffix in FORBID]
    if bad: raise SystemExit('forbidden runtime files: '+', '.join(sorted(bad)))
    m=json.loads((root/'manifest.json').read_text()); rows={x['path']:x for x in m['files']}
    expected=actual-{'manifest.json'}
    if set(rows)!=expected: raise SystemExit('manifest closure mismatch')
    for rel,r in rows.items():
        p=root/rel
        if p.stat().st_size!=r['bytes'] or sha(p)!=r['sha256']: raise SystemExit(f'manifest mismatch: {rel}')
    print('dist: PASS')
if __name__=='__main__': main()
