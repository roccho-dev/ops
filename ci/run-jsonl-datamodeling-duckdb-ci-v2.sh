#!/usr/bin/env bash
set -euo pipefail
HERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
. "$HERE/_common.sh"
ROOT="$(resolve_root "${1:-}")"
ensure_aliases "$ROOT"
python3 - "$ROOT" <<'PY'
import json, pathlib, sys, hashlib, shutil, subprocess
root=pathlib.Path(sys.argv[1])
files=0; rows=0; checked=[]
for p in [root/'governance-records-main/records/specs/package-contract.v1.jsonl', root/'adrs-main/records/raw/adr.v1.jsonl']:
    if not p.exists():
        raise SystemExit('missing JSONL authority input: '+str(p))
    for i,line in enumerate(p.read_text(encoding='utf-8').splitlines(),1):
        if line.strip():
            json.loads(line); rows+=1
    files+=1; checked.append(str(p.relative_to(root)))
duckdb=shutil.which('duckdb')
if not duckdb:
    payload={'kind':'canonicalCore.jsonlDatamodelingDuckdbCiV2.v1','status':'external-tool-missing','missing':['duckdb'],'requiredForFinal':True,'missingRequiredStatus':'blocked','jsonlStaticParse':'pass','jsonlFiles':files,'rowsParsed':rows,'checked':checked,'duckdbRole':'mandatory runtime gate for final; static JSONL parse is not final green','falseGreenPrevented':True}
    payload['digest']=hashlib.sha256(json.dumps(payload,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    print(json.dumps(payload, sort_keys=True)); raise SystemExit(78)
proc=subprocess.run([duckdb, '-json', '-c', 'select 1 as ok;'], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
if proc.returncode != 0:
    payload={'kind':'canonicalCore.jsonlDatamodelingDuckdbCiV2.v1','status':'fail','duckdbPath':duckdb,'stderr':proc.stderr[-4000:],'jsonlStaticParse':'pass','jsonlFiles':files,'rowsParsed':rows}
    print(json.dumps(payload, sort_keys=True)); raise SystemExit(proc.returncode)
payload={'kind':'canonicalCore.jsonlDatamodelingDuckdbCiV2.v1','status':'pass','jsonlFiles':files,'rowsParsed':rows,'checked':checked,'duckdbPath':duckdb,'duckdbRuntimeSmoke':'pass','duckdbRole':'mandatory runtime gate for final'}
payload['digest']=hashlib.sha256(json.dumps(payload,sort_keys=True,separators=(',',':')).encode()).hexdigest()
print(json.dumps(payload, sort_keys=True))
PY
