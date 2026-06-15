#!/usr/bin/env bash
set -euo pipefail
HERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
. "$HERE/_common.sh"
ROOT="$(resolve_root "${1:-}")"
ensure_aliases "$ROOT"
python3 - "$ROOT" <<'PY'
import json, pathlib, sys, hashlib
root=pathlib.Path(sys.argv[1])
files=0; rows=0; checked=[]
for p in [root/'governance-records-main/records/specs/package-contract.v1.jsonl', root/'adrs-main/records/raw/adr.v1.jsonl']:
    if not p.exists():
        raise SystemExit('missing JSONL authority input: '+str(p))
    for i,line in enumerate(p.read_text(encoding='utf-8').splitlines(),1):
        if line.strip():
            json.loads(line); rows+=1
    files+=1; checked.append(str(p.relative_to(root)))
try:
    import duckdb
except Exception as exc:
    payload={'kind':'canonicalCore.jsonlDatamodelingDuckdbCiV2.v1','status':'external-tool-missing','missing':['python-module:duckdb'],'requiredForFinal':True,'missingRequiredStatus':'blocked','jsonlStaticParse':'pass','jsonlFiles':files,'rowsParsed':rows,'checked':checked,'duckdbRole':'mandatory PyPI duckdb runtime gate for final; static JSONL parse is not final green','falseGreenPrevented':True,'importError':str(exc)}
    payload['digest']=hashlib.sha256(json.dumps(payload,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    print(json.dumps(payload, sort_keys=True)); raise SystemExit(78)
try:
    rows_out = duckdb.sql('select 1 as ok').fetchall()
except Exception as exc:
    payload={'kind':'canonicalCore.jsonlDatamodelingDuckdbCiV2.v1','status':'fail','duckdbRuntime':'pypi-module','stderr':str(exc)[-4000:],'jsonlStaticParse':'pass','jsonlFiles':files,'rowsParsed':rows}
    print(json.dumps(payload, sort_keys=True)); raise SystemExit(1)
payload={'kind':'canonicalCore.jsonlDatamodelingDuckdbCiV2.v1','status':'pass','jsonlFiles':files,'rowsParsed':rows,'checked':checked,'duckdbRuntime':'pypi-module','duckdbVersion':getattr(duckdb,'__version__','unknown'),'duckdbRuntimeSmoke':'pass','duckdbSmokeRows':rows_out,'duckdbRole':'mandatory PyPI duckdb runtime gate for final'}
payload['digest']=hashlib.sha256(json.dumps(payload,sort_keys=True,separators=(',',':')).encode()).hexdigest()
print(json.dumps(payload, sort_keys=True))
PY
