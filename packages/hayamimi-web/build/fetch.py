#!/usr/bin/env python3
import argparse, hashlib, json, pathlib, subprocess, urllib.request

def sha256(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024), b''): h.update(chunk)
    return h.hexdigest()

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--root',default='.'); ap.add_argument('--work',required=True); a=ap.parse_args()
    root=pathlib.Path(a.root).resolve(); work=pathlib.Path(a.work).resolve(); (work/'sources').mkdir(parents=True,exist_ok=True); (work/'downloads').mkdir(parents=True,exist_ok=True)
    rows=[json.loads(x) for x in (root/'sources.lock.jsonl').read_text().splitlines() if x.strip()]
    receipt=[]
    for r in rows:
        if r['kind']=='git':
            dst=work/'sources'/r['id']
            if not dst.exists(): subprocess.run(['git','clone','--filter=blob:none','--no-checkout',r['repo'],str(dst)],check=True)
            subprocess.run(['git','-C',str(dst),'fetch','--depth','1','origin',r['revision']],check=True)
            subprocess.run(['git','-C',str(dst),'checkout','--detach',r['revision']],check=True)
            got=subprocess.check_output(['git','-C',str(dst),'rev-parse','HEAD'],text=True).strip()
            receipt.append({'id':r['id'],'kind':'git','revision':got})
        else:
            name=r['url'].rsplit('/',1)[-1]; dst=work/'downloads'/name
            if not dst.exists():
                req=urllib.request.Request(r['url'],headers={'User-Agent':'hayamimi-web-build/1'})
                with urllib.request.urlopen(req) as src, dst.open('wb') as out:
                    while True:
                        chunk=src.read(1024*1024)
                        if not chunk: break
                        out.write(chunk)
            receipt.append({'id':r['id'],'kind':'url','url':r['url'],'bytes':dst.stat().st_size,'sha256':sha256(dst)})
    (work/'source-receipt.jsonl').write_text(''.join(json.dumps(x,sort_keys=True,separators=(',',':'))+'\n' for x in receipt))
if __name__=='__main__': main()
