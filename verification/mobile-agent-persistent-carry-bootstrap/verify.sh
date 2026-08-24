#!/usr/bin/env bash
set -euo pipefail

root="${1:?usage: verify.sh OUT_DIR}"
archive_sha="f0781226a3c302269a0507d3947867f8a5d2ef3a72ad1054454fed18598416ec"
archive_bytes=428316
carrier_sha="63e73cdbbe14a14ac01a013fe92feb5686e392333e696e0b3a850028604fea24"
carrier_bytes=571088
app_sha="3a8db8703aeb78ed2aded4292c554930daf16e6825dd1ccde83fd9bf680408d6"
app_bytes=2412388
asset="mobile-agent-min-app-carrier.${archive_sha}.tar.xz.b64.txt"
archive="mobile-agent-min-app-carrier.${archive_sha}.tar.xz"
mkdir -p "$root/source" "$root/extracted"

python3 verification/mobile-agent-persistent-carry-bootstrap/restore_app.py \
  "$root/source/$asset" > "$root/ingress.json"
test "$(wc -c < "$root/source/$asset")" -eq "$carrier_bytes"
test "$(sha256sum "$root/source/$asset" | cut -d' ' -f1)" = "$carrier_sha"
base64 --decode "$root/source/$asset" > "$root/$archive"
test "$(wc -c < "$root/$archive")" -eq "$archive_bytes"
test "$(sha256sum "$root/$archive" | cut -d' ' -f1)" = "$archive_sha"

node packages/chatgpt-capability/ingress/carrier-publish.mjs selftest
node packages/chatgpt-capability/ingress/carrier-publish.mjs prepare \
  --payload "$root/$archive" --payload-sha256 "$archive_sha" \
  --carrier "$root/prepared.b64.txt" --receipt "$root/prepare-receipt.json"
cmp "$root/source/$asset" "$root/prepared.b64.txt"
node packages/chatgpt-capability/ingress/carrier-publish.mjs verify \
  --payload "$root/$archive" --payload-sha256 "$archive_sha" \
  --carrier "$root/source/$asset" --receipt "$root/prepare-receipt.json"

python3 - "$root/prepare-receipt.json" "$root/request.json" "$asset" <<'PY'
import json, pathlib, sys
receipt=json.load(open(sys.argv[1],encoding='utf-8'))
request={
  'schema':'carrier-job/1',
  'request_id':'mobile-agent-min-app-carrier-publish-proof',
  'sources':[{
    'name':sys.argv[3],
    'url':'https://github.invalid/audited-local-source/'+sys.argv[3],
    'sha256':receipt['carrier']['sha256'],
  }],
  'carrier_name':sys.argv[3],
  'payload_sha256':receipt['payload']['sha256'],
}
pathlib.Path(sys.argv[2]).write_text(json.dumps(request,sort_keys=True,separators=(',',':'))+'\n',encoding='utf-8')
PY

node packages/chatgpt-capability/ingress/carrier-job.mjs materialize \
  --request "$root/request.json" --out "$root/materialized" --source-dir "$root/source"
node packages/chatgpt-capability/ingress/carrier-job.mjs verify \
  --input "$root/materialized" --receipt "$root/materialized-receipt.json"
cmp "$root/$archive" "$root/materialized/payload.bin"

python3 - "$root/materialized/payload.bin" "$root/extracted" "$root/archive-inventory.json" "$root/app-path.txt" <<'PY'
import hashlib,json,pathlib,sys,tarfile
archive=pathlib.Path(sys.argv[1]); out=pathlib.Path(sys.argv[2]); inventory=pathlib.Path(sys.argv[3]); app_path=pathlib.Path(sys.argv[4])
app_bytes=2_412_388
app_sha='3a8db8703aeb78ed2aded4292c554930daf16e6825dd1ccde83fd9bf680408d6'
rows=[]; matches=[]
with tarfile.open(archive,mode='r:xz') as source:
    for member in source.getmembers():
        p=pathlib.PurePosixPath(member.name)
        if p.is_absolute() or '..' in p.parts:
            raise SystemExit(f'unsafe archive path: {member.name}')
        if member.issym() or member.islnk() or member.isdev():
            raise SystemExit(f'unsafe archive member: {member.name}')
        if not member.isfile():
            continue
        handle=source.extractfile(member)
        if handle is None:
            raise SystemExit(f'unreadable archive member: {member.name}')
        data=handle.read(); digest=hashlib.sha256(data).hexdigest()
        target=out.joinpath(*p.parts); target.parent.mkdir(parents=True,exist_ok=True); target.write_bytes(data)
        rows.append({'path':p.as_posix(),'bytes':len(data),'sha256':digest})
        if len(data)==app_bytes and digest==app_sha:
            matches.append(p.as_posix())
if len(matches)!=1:
    raise SystemExit(f'exact App match count must be one: {matches}')
text=(out/pathlib.PurePosixPath(matches[0])).read_text(encoding='utf-8')
for token in ('graph/1','map/1','seq/1'):
    if token not in text:
        raise SystemExit(f'App token missing: {token}')
if 'maxgraph' not in text.lower():
    raise SystemExit('maxGraph token missing')
paths={row['path'] for row in rows}
if not any(path.endswith('codec.mjs') for path in paths):
    raise SystemExit('protocol codec missing from minimal Carrier')
for name in ('graph.jsonl','map.jsonl','seq.jsonl'):
    if not any(path.endswith('/'+name) or path==name for path in paths):
        raise SystemExit(f'fixture missing from minimal Carrier: {name}')
inventory.write_text(json.dumps({'schema':'ops.mobileAgentMinCarrierInventory/1','files':sorted(rows,key=lambda row:row['path']),'appPath':matches[0]},indent=2,sort_keys=True)+'\n')
app_path.write_text(matches[0]+'\n')
print(json.dumps({'status':'PASS','files':len(rows),'appPath':matches[0]},sort_keys=True))
PY

python3 - "$root/prepare-receipt.json" "$root/materialized-receipt.json" "$root/archive-inventory.json" <<'PY'
import json,sys
prepared=json.load(open(sys.argv[1])); consumed=json.load(open(sys.argv[2])); inventory=json.load(open(sys.argv[3]))
assert prepared['status']==consumed['status']=='PASS'
assert prepared['payload']['sha256']==consumed['payload']['sha256']=='f0781226a3c302269a0507d3947867f8a5d2ef3a72ad1054454fed18598416ec'
assert prepared['carrier']['sha256']==consumed['carrier']['sha256']=='63e73cdbbe14a14ac01a013fe92feb5686e392333e696e0b3a850028604fea24'
print(json.dumps({
  'schema':'ops.mobileAgentCarrierLocalClosure/1',
  'status':'PASS',
  'archive':prepared['payload'],
  'carrier':prepared['carrier'],
  'app':{'bytes':2412388,'sha256':'3a8db8703aeb78ed2aded4292c554930daf16e6825dd1ccde83fd9bf680408d6','path':inventory['appPath']},
  'files':len(inventory['files']),
},sort_keys=True))
PY
