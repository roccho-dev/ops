#!/usr/bin/env python3
from __future__ import annotations
import hashlib, json, os, pathlib, sys, urllib.request

def invariant(value, message):
    if not value: raise RuntimeError(f'mobile-agent-preset-readback: {message}')

def main(argv):
    invariant(len(argv)==6,'expected local_root public_base expected manifest source_sha')
    root=pathlib.Path(argv[1]).resolve(); base=argv[2].rstrip('/')+'/'
    expected=json.load(open(argv[3],encoding='utf-8')); app=json.load(open(argv[4],encoding='utf-8')); source_sha=argv[5]
    rows=[]
    for rel, spec in sorted(expected['files'].items()):
        local=(root/rel).read_bytes(); invariant(len(local)==spec['bytes'],f'local bytes {rel}'); invariant(hashlib.sha256(local).hexdigest()==spec['sha256'],f'local sha {rel}')
        request=urllib.request.Request(base+rel,headers={'User-Agent':'mobile-agent-preset-readback/1','Cache-Control':'no-cache'})
        with urllib.request.urlopen(request,timeout=45) as response:
            remote=response.read(); observed=response.geturl()
        invariant(remote==local,f'public bytes {rel}')
        rows.append({'path':rel,'bytes':len(remote),'sha256':spec['sha256'],'url':observed})
    actual=sorted(p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file())
    invariant(actual==sorted(expected['files']), 'local inventory')
    receipt={'schema':'ops.mobileAgentPresetPublicReadback/1','status':'PASS','authority':False,'opsCommit':source_sha,'project':app['provider']['project'],'base':base,'distTreeDigest':app['publication']['distTreeDigest'],'files':rows}
    out=pathlib.Path(os.environ['READBACK_RECEIPT']); out.write_text(json.dumps(receipt,sort_keys=True,separators=(',',':'))+'\n')
    print(json.dumps({'status':'PASS','files':len(rows),'base':base}))
if __name__=='__main__': main(sys.argv)
