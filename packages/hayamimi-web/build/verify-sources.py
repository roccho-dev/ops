#!/usr/bin/env python3
import argparse, hashlib, json, pathlib, subprocess

def digest(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for c in iter(lambda:f.read(1024*1024),b''): h.update(c)
    return h.hexdigest()

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--root',default='.'); ap.add_argument('--work',required=True); a=ap.parse_args()
    root=pathlib.Path(a.root).resolve(); work=pathlib.Path(a.work).resolve()
    lock={r['id']:r for r in map(json.loads,(root/'sources.lock.jsonl').read_text().splitlines())}
    receipt={r['id']:r for r in map(json.loads,(work/'source-receipt.jsonl').read_text().splitlines())}
    if set(lock)!=set(receipt): raise SystemExit('source receipt closure mismatch')
    for ident,row in lock.items():
        rec=receipt[ident]
        if row['kind']=='git':
            got=subprocess.check_output(['git','-C',str(work/'sources'/ident),'rev-parse','HEAD'],text=True).strip()
            if got!=row['revision'] or rec['revision']!=row['revision']: raise SystemExit(f'{ident}: revision mismatch')
        else:
            p=work/'downloads'/row['url'].rsplit('/',1)[-1]
            if rec['url']!=row['url'] or rec['bytes']!=p.stat().st_size or rec['sha256']!=digest(p): raise SystemExit(f'{ident}: download receipt mismatch')
    print('sources: PASS')
if __name__=='__main__': main()
