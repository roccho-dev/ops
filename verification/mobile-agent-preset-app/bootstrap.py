#!/usr/bin/env python3
from __future__ import annotations
import hashlib, json, pathlib, sys, urllib.parse, urllib.request

def invariant(value, message):
    if not value: raise RuntimeError(f'mobile-agent-preset-bootstrap: {message}')

def main(argv):
    invariant(len(argv)==5,'expected expected.json base out receipt')
    expected=json.load(open(argv[1],encoding='utf-8')); base=argv[2].rstrip('/')+'/'; out=pathlib.Path(argv[3]).resolve(); receipt=pathlib.Path(argv[4]).resolve()
    invariant(expected['schema']=='semantic-map-build-artifact/1','expected schema')
    invariant(not out.exists(),'out exists'); out.mkdir(parents=True)
    rows=[]
    for rel,spec in sorted(expected['files'].items()):
        invariant('..' not in pathlib.PurePosixPath(rel).parts and not rel.startswith('/'),f'unsafe path {rel}')
        url=urllib.parse.urljoin(base,rel)
        request=urllib.request.Request(url,headers={'User-Agent':'mobile-agent-preset-bootstrap/1','Cache-Control':'no-cache'})
        with urllib.request.urlopen(request,timeout=60) as response:
            data=response.read(); observed=response.geturl()
        invariant(len(data)==spec['bytes'],f'{rel}: bytes {len(data)} != {spec["bytes"]}')
        observed_sha=hashlib.sha256(data).hexdigest(); invariant(observed_sha==spec['sha256'],f'{rel}: sha {observed_sha} != {spec["sha256"]}')
        target=out/rel; target.parent.mkdir(parents=True,exist_ok=True); target.write_bytes(data)
        rows.append({'path':rel,'bytes':len(data),'sha256':observed_sha,'sourceUrl':observed})
    actual=sorted(p.relative_to(out).as_posix() for p in out.rglob('*') if p.is_file())
    invariant(actual==sorted(expected['files']),'inventory mismatch')
    canonical=json.dumps([{'path':r['path'],'bytes':r['bytes'],'sha256':r['sha256']} for r in rows],sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
    value={'schema':'ops.mobileAgentPresetBootstrapReceipt/1','status':'PASS','authority':False,'sourceBase':base,'distTreeDigest':'sha256:'+hashlib.sha256(canonical).hexdigest(),'files':rows}
    receipt.write_text(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n')
    print(json.dumps({'status':'PASS','files':len(rows),'distTreeDigest':value['distTreeDigest']}))
if __name__=='__main__': main(sys.argv)
