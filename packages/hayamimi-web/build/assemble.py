#!/usr/bin/env python3
import argparse, hashlib, json, pathlib, shutil

def sha(p):
    h=hashlib.sha256(); h.update(p.read_bytes()); return h.hexdigest()
def cp_tree(src,dst):
    if dst.exists(): shutil.rmtree(dst)
    shutil.copytree(src,dst)
def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--root',default='.'); ap.add_argument('--work',required=True); ap.add_argument('--out',required=True); a=ap.parse_args()
    root=pathlib.Path(a.root).resolve(); work=pathlib.Path(a.work).resolve(); out=pathlib.Path(a.out).resolve()
    if out.exists(): shutil.rmtree(out)
    out.mkdir(parents=True)
    for f in ('index.html','chat.mjs','chat.css'): shutil.copy2(root/'web'/f,out/f)
    cp_tree(root/'src',out/'runtime')
    cp_tree(work/'generated'/'sherpa',out/'sherpa'); cp_tree(work/'generated'/'sherpa-pja',out/'sherpa-pja')
    shutil.copy2(root/'THIRD_PARTY_NOTICES.md',out/'THIRD_PARTY_NOTICES.md')
    files=[]
    for p in sorted(x for x in out.rglob('*') if x.is_file()):
        rel=p.relative_to(out).as_posix(); files.append({'path':rel,'bytes':p.stat().st_size,'sha256':sha(p)})
    (out/'manifest.json').write_text(json.dumps({'schema':'roccho.hayamimi-web.dist/1','files':files},ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n')
if __name__=='__main__': main()
