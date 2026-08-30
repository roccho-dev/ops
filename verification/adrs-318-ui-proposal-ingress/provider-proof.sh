#!/usr/bin/env bash
set -euo pipefail

: "${ROOT:?ROOT is required}"
: "${EVIDENCE:?EVIDENCE is required}"
: "${CANDIDATE_SHA:?CANDIDATE_SHA is required}"
: "${UI_ROOT:?UI_ROOT is required}"
: "${UI_COMMIT:?UI_COMMIT is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"

WORKER="stg-adrs-ui-proposal-ingress"
BUCKET="stg-adrs-ui-proposals"
WRANGLER_VERSION="4.112.0"
PROPOSAL_ID="adrs318-ui-proposal-oidc-canary-v1"
GENERATED_CONFIG="$ROOT/wrangler.proof.json"
LOCAL_PORT=8765
local_server_pid=""
mkdir -p "$EVIDENCE"

cleanup() {
  if [ -n "$local_server_pid" ]; then kill "$local_server_pid" 2>/dev/null || true; fi
  rm -f "$GENERATED_CONFIG"
}
trap cleanup EXIT

node --test "$ROOT/tests/worker.test.mjs" | tee "$EVIDENCE/node-tests.log"
python3 -m pip install --quiet --disable-pip-version-check playwright==1.55.0
chrome="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
test -n "$chrome"
"$chrome" --version > "$EVIDENCE/chrome-version.txt"

test "$(git -C "$UI_ROOT" rev-parse HEAD)" = "$UI_COMMIT"
UI_COMMIT="$UI_COMMIT" node "$ROOT/build-approved-ui.mjs" "$UI_ROOT" "$ROOT/public" \
  | tee "$EVIDENCE/approved-ui-build.log"
cp "$ROOT/public/approved-ui-receipt.json" "$EVIDENCE/approved-ui-receipt.json"
python3 - "$EVIDENCE/approved-ui-receipt.json" "$UI_COMMIT" <<'PY'
import json,sys
value=json.load(open(sys.argv[1],encoding='utf-8'))
assert value['status']=='PASS'
assert value['uiCommit']==sys.argv[2]
assert value['pattern']=='map/1'
assert value['retiredFixedFormPresent'] is False
assert value['requiredRegionIds']==['repo:adrs','repo:governance','repo:ops','pkg.adrs318.canary']
PY
! grep -R -F 'ADRS UI Proposal Canary' "$ROOT/public"
! grep -R -F '固定canary変更' "$ROOT/public"

python3 -m http.server "$LOCAL_PORT" --bind 127.0.0.1 --directory "$ROOT/public" \
  > "$EVIDENCE/local-server.log" 2>&1 &
local_server_pid=$!
for _ in $(seq 1 100); do
  if curl -fsS "http://127.0.0.1:$LOCAL_PORT/" >/dev/null; then break; fi
  sleep .1
done
CHROME_BIN="$chrome" python3 "$ROOT/browser-proof.py" \
  "http://127.0.0.1:$LOCAL_PORT/" "$EVIDENCE/local-visual.json" "$EVIDENCE/local-visual.png" --visual-only
kill "$local_server_pid"
wait "$local_server_pid" 2>/dev/null || true
local_server_pid=""
python3 - "$EVIDENCE/local-visual.json" "$EVIDENCE/local-visual.png" "$EVIDENCE/local-visual-proposal.png" <<'PY'
import json,os,sys
value=json.load(open(sys.argv[1],encoding='utf-8'))
assert value['status']=='PASS'
assert value['mode']=='visual-only'
assert value['pattern']=='map/1'
assert value['representation_count']==20
assert value['relation_count']==6
assert value['console_errors']==[] and value['page_errors']==[] and value['failed_responses']==[]
assert os.path.getsize(sys.argv[2])>0 and os.path.getsize(sys.argv[3])>0
PY

api="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets?name_contains=$BUCKET&per_page=1000"
curl -fsS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "$api" > "$EVIDENCE/r2-buckets.raw.json"
bucket_exists="$(python3 - "$EVIDENCE/r2-buckets.raw.json" "$BUCKET" <<'PY'
import json,sys
value=json.load(open(sys.argv[1],encoding='utf-8'))
assert value['success'] is True
print('true' if any(item.get('name')==sys.argv[2] for item in value.get('result',{}).get('buckets',[])) else 'false')
PY
)"
rm -f "$EVIDENCE/r2-buckets.raw.json"
bucket_created=false
if [ "$bucket_exists" = false ]; then
  npx --yes "wrangler@$WRANGLER_VERSION" r2 bucket create "$BUCKET" > "$EVIDENCE/r2-create.log" 2>&1
  bucket_created=true
fi

python3 - "$ROOT/wrangler.jsonc" "$GENERATED_CONFIG" "$CANDIDATE_SHA" <<'PY'
import json,sys
source,target,sha=sys.argv[1:]
value=json.load(open(source,encoding='utf-8'))
value['vars']['APP_VERSION']=sha
open(target,'w',encoding='utf-8').write(json.dumps(value,sort_keys=True,indent=2)+'\n')
PY

deploy_output="$(cd "$ROOT" && npx --yes "wrangler@$WRANGLER_VERSION" deploy --config "$(basename "$GENERATED_CONFIG")" 2>&1)"
printf '%s\n' "$deploy_output" > "$EVIDENCE/wrangler-deploy.log"
worker_url="$(printf '%s\n' "$deploy_output" | grep -Eo 'https://[A-Za-z0-9.-]+\.workers\.dev' | head -n1 || true)"
test -n "$worker_url"
worker_url="${worker_url%/}"
printf '%s\n' "$worker_url" > "$EVIDENCE/worker-url.txt"

meta_ready=false
for _ in $(seq 1 120); do
  if curl -fsS -H 'User-Agent: roccho-ops-approved-semantic-map-proof/1' \
      "$worker_url/api/meta" > "$EVIDENCE/meta.candidate.json"; then
    if python3 - "$EVIDENCE/meta.candidate.json" "$CANDIDATE_SHA" <<'PY'
import json,sys
meta=json.load(open(sys.argv[1],encoding='utf-8'))
assert meta['status']=='PASS'
assert meta['app_version']==sys.argv[2]
assert meta['proposal_id']=='adrs318-ui-proposal-oidc-canary-v1'
assert meta['github_write_credential_in_worker'] is False
assert meta['relay_auth']=='GitHub Actions OIDC'
PY
    then
      mv "$EVIDENCE/meta.candidate.json" "$EVIDENCE/meta.json"
      meta_ready=true
      break
    fi
  fi
  sleep .5
done
rm -f "$EVIDENCE/meta.candidate.json"
test "$meta_ready" = true

for name in index.html connectability.mjs proposal-connect.mjs receipt.json approved-ui-receipt.json; do
  curl --retry 20 --retry-all-errors --retry-delay 1 -fsS "$worker_url/$name" > "$EVIDENCE/$name.remote"
  cmp "$ROOT/public/$name" "$EVIDENCE/$name.remote"
done
sha256sum \
  "$ROOT/public/index.html" \
  "$ROOT/public/connectability.mjs" \
  "$ROOT/public/proposal-connect.mjs" \
  "$ROOT/public/receipt.json" \
  "$ROOT/public/approved-ui-receipt.json" > "$EVIDENCE/static-assets.sha256"

CHROME_BIN="$chrome" python3 "$ROOT/browser-proof.py" \
  "$worker_url/" "$EVIDENCE/live-browser.json" "$EVIDENCE/live-browser.png"

relay_status="$(curl -sS -o "$EVIDENCE/relay-without-token.json" -w '%{http_code}' \
  -H 'User-Agent: roccho-ops-approved-semantic-map-proof/1' \
  "$worker_url/api/relay/pending")"
test "$relay_status" = 401
python3 - "$EVIDENCE/relay-without-token.json" <<'PY'
import json,sys
value=json.load(open(sys.argv[1],encoding='utf-8'))
assert value['code']=='RELAY_AUTH_DENIED'
PY

curl --retry 20 --retry-all-errors --retry-delay 1 -fsS \
  -H 'Accept: application/json' \
  -H 'User-Agent: roccho-ops-approved-semantic-map-proof/1' \
  "$worker_url/api/proposals/$PROPOSAL_ID" > "$EVIDENCE/proposal-status.json"

BUCKET_CREATED="$bucket_created" WORKER_URL="$worker_url" WORKER="$WORKER" BUCKET="$BUCKET" UI_COMMIT="$UI_COMMIT" \
python3 - "$EVIDENCE/approved-ui-receipt.json" "$EVIDENCE/local-visual.json" "$EVIDENCE/live-browser.json" "$EVIDENCE/proposal-status.json" "$EVIDENCE/provider-proof.json" <<'PY'
import json,os,sys
build=json.load(open(sys.argv[1],encoding='utf-8'))
local=json.load(open(sys.argv[2],encoding='utf-8'))
live=json.load(open(sys.argv[3],encoding='utf-8'))
status=json.load(open(sys.argv[4],encoding='utf-8'))
assert build['status']==local['status']==live['status']==status['status']=='PASS'
assert build['uiCommit']==local['ui_commit']==live['ui_commit']==os.environ['UI_COMMIT']
assert local['mode']=='visual-only' and live['mode']=='live-provider'
assert local['representation_count']==live['representation_count']==20
assert local['relation_count']==live['relation_count']==6
assert local['approved_ui'] is live['approved_ui'] is True
assert local['retired_fixed_form_present'] is live['retired_fixed_form_present'] is False
assert live['proposal_state']=='recorded' and status['state']=='recorded'
assert status['exact_comment_readback'] is True
assert isinstance(status['comment_id'],int) and status['comment_id']>0
assert status['comment_url'].startswith('https://github.com/roccho-dev/adrs/issues/318#issuecomment-')
receipt={
  'schema':'ops.approvedSemanticMapProviderProof/1',
  'status':'PASS',
  'claim_ceiling':'APPROVED_SEMANTIC_MAP_TO_ADRS_COMMENT_RECORDED',
  'authority':False,
  'repository':os.environ['GITHUB_REPOSITORY'],
  'candidate_sha':os.environ['CANDIDATE_SHA'],
  'ui_commit':os.environ['UI_COMMIT'],
  'ui_pattern':'map/1',
  'visible_regions':live['representation_count'],
  'visible_relations':live['relation_count'],
  'worker':{
    'name':os.environ['WORKER'],
    'url':os.environ['WORKER_URL']+'/',
    'static_asset_readback':'PASS',
    'github_write_credential':False,
    'relay_auth':'GitHub Actions OIDC',
  },
  'R2':{
    'bucket':os.environ['BUCKET'],
    'created_this_run':os.environ['BUCKET_CREATED']=='true',
    'conditional_append':'PASS',
    'proposal_exact_readback':'PASS',
    'recorded_receipt_exact_readback':'PASS',
  },
  'expected_ui_generated_before_deploy':True,
  'local_real_chromium_visual_proof':'PASS',
  'remote_real_chromium_visual_and_submit_proof':'PASS',
  'approved_ui':True,
  'retired_fixed_form_present':False,
  'proposal_id':status['proposal_id'],
  'proposal_digest':status['proposal_digest'],
  'comment_body_sha256':status['comment_body_sha256'],
  'comment_id':status['comment_id'],
  'comment_url':status['comment_url'],
  'state':'recorded',
  'browser_errors':0,
  'external_requests':0,
  'relay_without_oidc':'DENIED',
  'automatic_oidc_relay':True,
  'adrs_comment_recorded':True,
  'exact_comment_readback':True,
  'gov_materialized':False,
  'current_changed':False,
  'authority_changed':False,
  'cutover':False,
}
open(sys.argv[5],'w',encoding='utf-8').write(json.dumps(receipt,sort_keys=True,separators=(',',':'))+'\n')
print(json.dumps(receipt,sort_keys=True))
PY

rm -f "$EVIDENCE/wrangler-deploy.log" "$EVIDENCE/r2-create.log" 2>/dev/null || true
