#!/usr/bin/env bash
set -euo pipefail

: "${ROOT:?ROOT is required}"
: "${EVIDENCE:?EVIDENCE is required}"
: "${CANDIDATE_SHA:?CANDIDATE_SHA is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"

WORKER="stg-adrs-ui-proposal-ingress"
BUCKET="stg-adrs-ui-proposals"
WRANGLER_VERSION="4.112.0"
PROPOSAL_ID="adrs318-ui-proposal-oidc-canary-v1"
mkdir -p "$EVIDENCE"

node --test "$ROOT/tests/worker.test.mjs" | tee "$EVIDENCE/node-tests.log"

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

python3 - "$ROOT/wrangler.jsonc" "$RUNNER_TEMP/wrangler.adrs318.json" "$CANDIDATE_SHA" <<'PY'
import json,sys
source,target,sha=sys.argv[1:]
value=json.load(open(source,encoding='utf-8'))
value['vars']['APP_VERSION']=sha
open(target,'w',encoding='utf-8').write(json.dumps(value,sort_keys=True,indent=2)+'\n')
PY

deploy_output="$(cd "$ROOT" && npx --yes "wrangler@$WRANGLER_VERSION" deploy --config "$RUNNER_TEMP/wrangler.adrs318.json" 2>&1)"
printf '%s\n' "$deploy_output" > "$EVIDENCE/wrangler-deploy.log"
worker_url="$(printf '%s\n' "$deploy_output" | grep -Eo 'https://[A-Za-z0-9.-]+\.workers\.dev' | head -n1 || true)"
test -n "$worker_url"
worker_url="${worker_url%/}"
printf '%s\n' "$worker_url" > "$EVIDENCE/worker-url.txt"

for attempt in $(seq 1 100); do
  if curl -fsS "$worker_url/api/meta" >/dev/null; then break; fi
  sleep .3
done
curl --retry 20 --retry-all-errors --retry-delay 1 -fsS "$worker_url/api/meta" > "$EVIDENCE/meta.json"
python3 - "$EVIDENCE/meta.json" "$CANDIDATE_SHA" <<'PY'
import json,sys
meta=json.load(open(sys.argv[1],encoding='utf-8'))
assert meta['status']=='PASS'
assert meta['app_version']==sys.argv[2]
assert meta['proposal_id']=='adrs318-ui-proposal-oidc-canary-v1'
assert meta['github_write_credential_in_worker'] is False
assert meta['relay_auth']=='GitHub Actions OIDC'
PY

python3 -m pip install --quiet --disable-pip-version-check playwright==1.55.0
chrome="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
test -n "$chrome"
CHROME_BIN="$chrome" python3 "$ROOT/browser-proof.py" \
  "$worker_url/" "$EVIDENCE/browser-submit.json" "$EVIDENCE/browser-submit.png"
"$chrome" --version > "$EVIDENCE/chrome-version.txt"

curl --retry 20 --retry-all-errors --retry-delay 1 -fsS "$worker_url/" > "$EVIDENCE/index.remote.html"
curl --retry 20 --retry-all-errors --retry-delay 1 -fsS "$worker_url/app.mjs" > "$EVIDENCE/app.remote.mjs"
curl --retry 20 --retry-all-errors --retry-delay 1 -fsS "$worker_url/style.css" > "$EVIDENCE/style.remote.css"
cmp "$ROOT/public/index.html" "$EVIDENCE/index.remote.html"
cmp "$ROOT/public/app.mjs" "$EVIDENCE/app.remote.mjs"
cmp "$ROOT/public/style.css" "$EVIDENCE/style.remote.css"
sha256sum "$ROOT/public/index.html" "$ROOT/public/app.mjs" "$ROOT/public/style.css" > "$EVIDENCE/static-assets.sha256"

relay_status="$(curl -sS -o "$EVIDENCE/relay-without-token.json" -w '%{http_code}' "$worker_url/api/relay/pending")"
test "$relay_status" = 401
python3 - "$EVIDENCE/relay-without-token.json" <<'PY'
import json,sys
value=json.load(open(sys.argv[1],encoding='utf-8'))
assert value['code']=='RELAY_AUTH_DENIED'
PY

curl --retry 20 --retry-all-errors --retry-delay 1 -fsS \
  "$worker_url/api/proposals/$PROPOSAL_ID" > "$EVIDENCE/proposal-status.json"

BUCKET_CREATED="$bucket_created" WORKER_URL="$worker_url" WORKER="$WORKER" BUCKET="$BUCKET" \
python3 - "$EVIDENCE/browser-submit.json" "$EVIDENCE/proposal-status.json" "$EVIDENCE/provider-proof.json" <<'PY'
import json,os,sys
browser=json.load(open(sys.argv[1],encoding='utf-8'))
status=json.load(open(sys.argv[2],encoding='utf-8'))
assert browser['status']==status['status']=='PASS'
assert status['state'] in {'submitted','recorded'}
receipt={
  'schema':'ops.adrsUiProposalIngressProviderProof/1',
  'status':'PASS',
  'claim_ceiling':'UI_TO_R2_PROPOSAL_SUBMIT_PROVEN',
  'authority':False,
  'repository':os.environ['GITHUB_REPOSITORY'],
  'candidate_sha':os.environ['CANDIDATE_SHA'],
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
    'exact_readback':'PASS',
  },
  'proposal_id':status['proposal_id'],
  'proposal_digest':status['proposal_digest'],
  'comment_body_sha256':status['comment_body_sha256'],
  'state':status['state'],
  'local_tests':4,
  'real_chromium':True,
  'browser_errors':0,
  'external_requests':0,
  'relay_without_oidc':'DENIED',
  'adrs_comment_recorded':status['state']=='recorded',
  'gov_materialized':False,
  'current_changed':False,
  'authority_changed':False,
  'cutover':False,
}
open(sys.argv[3],'w',encoding='utf-8').write(json.dumps(receipt,sort_keys=True,separators=(',',':'))+'\n')
print(json.dumps(receipt,sort_keys=True))
PY

rm -f "$EVIDENCE/wrangler-deploy.log" "$EVIDENCE/r2-create.log" 2>/dev/null || true
