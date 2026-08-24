#!/usr/bin/env bash
set -euo pipefail

root="${1:?usage: verify.sh OUT_DIR}"
app_sha="3a8db8703aeb78ed2aded4292c554930daf16e6825dd1ccde83fd9bf680408d6"
app_bytes=2412388
carrier_sha="9f7dee8b1fb658d573705f487d25d8afcd960118501fecb30087e24a3c02f4e8"
carrier_bytes=3216520
asset="mobile-agent-app.${app_sha}.b64.txt"
mkdir -p "$root/source"

python3 verification/mobile-agent-persistent-carry-bootstrap/recover_app.py \
  "$root/app.index.html" "$root/recovery-receipt.json" > "$root/recovery-terminal.json"
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
test "$(wc -c < "$root/source/$asset")" -eq "$carrier_bytes"
test "$(sha256sum "$root/source/$asset" | cut -d' ' -f1)" = "$carrier_sha"
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
    'url':'https://github.invalid/audited-retained-artifact/'+sys.argv[3],
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

python3 - "$root/recovery-receipt.json" "$root/prepare-receipt.json" "$root/materialized-receipt.json" <<'PY'
import json,sys
recovery=json.load(open(sys.argv[1])); prepared=json.load(open(sys.argv[2])); consumed=json.load(open(sys.argv[3]))
assert recovery['status']==prepared['status']==consumed['status']=='PASS'
assert recovery['app']['sha256']==prepared['payload']['sha256']==consumed['payload']['sha256']=='3a8db8703aeb78ed2aded4292c554930daf16e6825dd1ccde83fd9bf680408d6'
assert prepared['carrier']['sha256']==consumed['carrier']['sha256']=='9f7dee8b1fb658d573705f487d25d8afcd960118501fecb30087e24a3c02f4e8'
print(json.dumps({
  'schema':'ops.mobileAgentCarrierLocalClosure/1',
  'status':'PASS',
  'sourceArtifact':recovery['artifact'],
  'app':prepared['payload'],
  'carrier':prepared['carrier'],
  'sharedMaterialize':'PASS',
},sort_keys=True))
PY
