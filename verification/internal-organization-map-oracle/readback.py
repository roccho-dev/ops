#!/usr/bin/env python3
from __future__ import annotations
import argparse, hashlib, json, pathlib, time, urllib.request

def sha(data: bytes) -> str: return hashlib.sha256(data).hexdigest()
def fetch(url: str, accept: str) -> tuple[bytes, str]:
    request=urllib.request.Request(url,headers={"Accept":accept,"Cache-Control":"no-cache","User-Agent":"roccho-ops-map-readback/1"})
    with urllib.request.urlopen(request,timeout=60) as response:
        if response.status != 200: raise RuntimeError(f"HTTP {response.status}: {url}")
        return response.read(), response.headers.get_content_type()

def main() -> int:
    p=argparse.ArgumentParser();p.add_argument('dist',type=pathlib.Path);p.add_argument('base');p.add_argument('output',type=pathlib.Path);p.add_argument('--attempts',type=int,default=30);args=p.parse_args()
    base=args.base.rstrip('/')+'/'
    expected={name:(args.dist/name).read_bytes() for name in ('index.html','organization-current.jsonl')}
    last=None
    for attempt in range(1,args.attempts+1):
        try:
            html,html_type=fetch(base,'text/html')
            rows,rows_type=fetch(base+'organization-current.jsonl','application/x-ndjson')
            if html != expected['index.html']: raise RuntimeError(f"HTML bytes differ {sha(html)} != {sha(expected['index.html'])}")
            if rows != expected['organization-current.jsonl']: raise RuntimeError(f"JSONL bytes differ {sha(rows)} != {sha(expected['organization-current.jsonl'])}")
            receipt={"schema":"ops.internalOrganizationMapReadback/1","status":"PASS","authority":False,"url":base,"attempt":attempt,"files":{"index.html":{"bytes":len(html),"sha256":sha(html),"contentType":html_type},"organization-current.jsonl":{"bytes":len(rows),"sha256":sha(rows),"contentType":rows_type}}}
            args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(receipt,ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n')
            print(json.dumps(receipt,sort_keys=True));return 0
        except Exception as exc:
            last=exc
            if attempt < args.attempts: time.sleep(min(10,1+attempt/3))
    raise RuntimeError(f"readback failed after {args.attempts} attempts: {last}")
if __name__=='__main__': raise SystemExit(main())
