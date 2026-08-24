#!/usr/bin/env bash
set -euo pipefail

root="${1:?usage: verify.sh OUT_DIR}"
app_sha="3a8db8703aeb78ed2aded4292c554930daf16e6825dd1ccde83fd9bf680408d6"
app_bytes=2412388
asset="mobile-agent-app.${app_sha}.b64.txt"
mkdir -p "$root/source"

python3 verification/mobile-agent-persistent-carry-bootstrap/restore_app.py \
  "$root/app.br" > "$root/ingress.json"
node -e 'const fs=require("node:fs"),zlib=require("node:zlib");fs.writeFileSync(process.argv[2],zlib.brotliDecompressSync(fs.readFileSync(process.argv[1])));' \
  "$root/app.br" "$root/app.index.html"
test "$(wc -c < "$root/app.index.html")" -eq "$app_bytes"
test "$(sha256sum "$root/app.index.html" | cut -d' ' -f1)" = "$app_sha"
grep -F 'graph/1' "$root/app.index.html" >/dev/null
grep -F 'map/1' "$root/app.index.html" >/dev/null
grep -F 'seq/1' "$root/app.index.html" >/dev/null
grep -Fi 'maxgraph' "$root/app.index.html" >/dev/null

node packages/chatgpt-capability/ingress/carrier-publish.mjs selftest
node packages/chatgpt-capability/ingress/carrier-publish.mjs prepare \
  --payload "$root/app.index.html" --payload-sha256 "$app_sha" \
  --carrier "$root/source/$asset" --receipt "$root/prepare-receipt.json"
node packages/chatgpt-capability/ingress/carrier-publish.mjs verify \
  --payload "$root/app.index.html" --payload-sha256 "$app_sha" \
  --carrier "$root/source/$asset" --receipt "$root/prepare-receipt.json"

python3 - "$root/prepare-receipt.json" "$root/request.json" "$asset" <<'PY'
import json, pathlib, sys
receipt=json.load(open(sys.argv[1],encoding='utf-8'))
request={
  'schema':'carrier-job/1',
  'request_id':'mobile-agent-app-publish-proof',
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
cmp "$root/app.index.html" "$root/materialized/payload.bin"

python3 - "$root/prepare-receipt.json" "$root/materialized-receipt.json" <<'PY'
import json,sys
prepared=json.load(open(sys.argv[1])); consumed=json.load(open(sys.argv[2]))
assert prepared['status']==consumed['status']=='PASS'
assert prepared['payload']['sha256']==consumed['payload']['sha256']
assert prepared['carrier']['sha256']==consumed['carrier']['sha256']
print(json.dumps({
  'schema':'ops.mobileAgentCarrierLocalClosure/1',
  'status':'PASS',
  'payload':prepared['payload'],
  'carrier':prepared['carrier'],
},sort_keys=True))
PY
