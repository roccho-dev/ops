#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import argparse
import hashlib
import importlib.util
import json
import sys

def fail(code: str, message: str) -> None:
    raise SystemExit(json.dumps({'schema':'ops.selectedQueryFailure.v1','status':'FAILED','code':code,'message':message},sort_keys=True))

def read_json(path: Path):
    return json.loads(path.read_text(encoding='utf-8'))

def sha256_file(path: Path) -> str:
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()

def load_core(path: Path):
    spec=importlib.util.spec_from_file_location('ops_decision_selected_core',path)
    if spec is None or spec.loader is None: fail('CORE_LOAD','cannot load selected query core')
    module=importlib.util.module_from_spec(spec)
    sys.modules[spec.name]=module
    spec.loader.exec_module(module)
    return module

def main() -> int:
    p=argparse.ArgumentParser()
    p.add_argument('--projection',required=True)
    p.add_argument('--query',required=True)
    p.add_argument('--params-json',default='{}')
    args=p.parse_args()
    projection=Path(args.projection).resolve()
    manifest_path=projection/'manifest.json'
    if not manifest_path.is_file(): fail('MANIFEST_MISSING',str(manifest_path))
    manifest=read_json(manifest_path)
    if manifest.get('schema')!='ops.sqliteShardProjection.v1' or manifest.get('projectionKind')!='sqlite-shards':
        fail('PROJECTION_KIND','selected query accepts SQLite shards only')
    expected={x['name']:x for x in manifest.get('assets',[])}
    actual={x.name for x in projection.iterdir() if x.is_file() and x.suffix=='.sqlite'}
    if actual!=set(expected): fail('ASSET_SET_MISMATCH',json.dumps({'expected':sorted(expected),'actual':sorted(actual)}))
    for name,row in expected.items():
        path=projection/name
        if path.stat().st_size!=row['bytes'] or sha256_file(path)!=row['sha256']:
            fail('ASSET_IDENTITY_MISMATCH',name)
    try: params=json.loads(args.params_json)
    except json.JSONDecodeError as exc: fail('PARAMS_JSON',str(exc))
    if not isinstance(params,dict) or any(not isinstance(k,str) or not isinstance(v,str) for k,v in params.items()):
        fail('PARAMS_SHAPE','params must be a string-to-string JSON object')
    core=load_core(Path(__file__).with_name('ops-decision-closure.py'))
    rows,metrics=core.query_sqlite(projection,args.query,params)
    result={
        'schema':'ops.selectedSQLiteQueryResult.v1','status':'PASS',
        'projectionKind':'sqlite-shards','checkpointId':manifest['checkpointId'],
        'authorityRootDigest':manifest['authorityRootDigest'],'queryId':args.query,
        'params':params,'rows':rows,'semanticDigest':hashlib.sha256(core.canonical(rows)).hexdigest(),
        'metrics':metrics,
    }
    print(json.dumps(result,ensure_ascii=False,sort_keys=True,separators=(',',':')))
    return 0

if __name__=='__main__': raise SystemExit(main())
