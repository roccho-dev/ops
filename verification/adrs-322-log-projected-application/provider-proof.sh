#!/usr/bin/env bash
set -euo pipefail

: "${ROOT:?ROOT is required}"
: "${EVIDENCE:?EVIDENCE is required}"
: "${CANDIDATE_SHA:?CANDIDATE_SHA is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"

sha_suffix="$(printf '%s' "$CANDIDATE_SHA" | cut -c1-10)"
WORKER="stg-log-projected-application-$sha_suffix"
BUCKET="stg-log-projected-observations"
WRANGLER_VERSION="4.112.0"
mkdir -p "$EVIDENCE"

node "$ROOT/local-proof.mjs" "$EVIDENCE/local-proof.json"

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

python3 - "$ROOT/wrangler.template.json" "$ROOT/wrangler.generated.json" "$CANDIDATE_SHA" "$WORKER" <<'PY'
import json,sys
source,target,sha,worker=sys.argv[1:]
value=json.load(open(source,encoding='utf-8'))
value['name']=worker
value['vars']['APP_VERSION']=sha
value['vars']['WORKER_NAME']=worker
open(target,'w',encoding='utf-8').write(json.dumps(value,sort_keys=True,indent=2)+'\n')
PY
trap 'rm -f "$ROOT/wrangler.generated.json"' EXIT

deploy_output="$(cd "$ROOT" && npx --yes "wrangler@$WRANGLER_VERSION" deploy --config wrangler.generated.json 2>&1)"
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
python3 - "$EVIDENCE/meta.json" "$CANDIDATE_SHA" "$WORKER" <<'PY'
import json,sys
meta=json.load(open(sys.argv[1],encoding='utf-8'))
assert meta['status']=='PASS'
assert meta['app_version']==sys.argv[2]
assert meta['worker_name']==sys.argv[3]
PY

run_suffix="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
suffix="$sha_suffix-$run_suffix"
http_subject="proof-external-http-$suffix"
http_request="continue-http-$suffix"
browser_subject="proof-external-browser-$suffix"
browser_request="continue-browser-$suffix"
python3 "$ROOT/remote-proof.py" "$worker_url" "$http_subject" "$http_request" "$CANDIDATE_SHA" "$EVIDENCE/remote-http.json"

python3 -m pip install --quiet --disable-pip-version-check playwright==1.55.0
chrome="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
test -n "$chrome"
CHROME_BIN="$chrome" python3 "$ROOT/browser-smoke.py" \
  "$worker_url" "$browser_subject" "$browser_request" \
  "$EVIDENCE/remote-browser.json" "$EVIDENCE/remote-browser.png"
"$chrome" --version > "$EVIDENCE/chrome-version.txt"

curl --retry 20 --retry-all-errors --retry-delay 1 -fsS "$worker_url/" > "$EVIDENCE/index.remote.html"
curl --retry 20 --retry-all-errors --retry-delay 1 -fsS "$worker_url/app.js" > "$EVIDENCE/app.remote.js"
cmp "$ROOT/public/index.html" "$EVIDENCE/index.remote.html"
cmp "$ROOT/public/app.js" "$EVIDENCE/app.remote.js"
sha256sum "$ROOT/public/index.html" "$ROOT/public/app.js" > "$EVIDENCE/static-assets.sha256"

BUCKET_CREATED="$bucket_created" WORKER_URL="$worker_url" WORKER="$WORKER" BUCKET="$BUCKET" \
python3 - "$EVIDENCE/local-proof.json" "$EVIDENCE/remote-http.json" "$EVIDENCE/remote-browser.json" "$EVIDENCE/provider-proof.json" <<'PY'
import json,os,sys
local_path,http_path,browser_path,output_path=sys.argv[1:]
local=json.load(open(local_path,encoding='utf-8'))
http=json.load(open(http_path,encoding='utf-8'))
browser=json.load(open(browser_path,encoding='utf-8'))
assert local['status']==http['status']==browser['status']=='PASS'
assert local['kernel_digest']==http['kernel_digest']==browser['kernel_digest']
assert http['external_after_surface_digest']==http['reload_surface_digest']
assert browser['external_after_surface_digest']==browser['reload_surface_digest']
assert http['projection_object_count']==browser['projection_object_count']==0
receipt={
  'schema':'ops.logProjectedApplicationProviderProof/1',
  'status':'PASS',
  'claim_ceiling':'BOUNDED_PROVIDER_PROOF',
  'authority':False,
  'repository':os.environ['GITHUB_REPOSITORY'],
  'base_sha':os.environ.get('BASE_SHA'),
  'candidate_sha':os.environ['CANDIDATE_SHA'],
  'worker':{
    'name':os.environ['WORKER'],
    'url':os.environ['WORKER_URL'],
    'static_asset_readback':'PASS',
  },
  'R2':{
    'bucket':os.environ['BUCKET'],
    'created_this_run':os.environ['BUCKET_CREATED']=='true',
    'remote_readback':'PASS',
    'immutable_conditional_append':'PASS',
    'current_projection_objects':0,
  },
  'kernel_id':local['kernel_id'],
  'kernel_digest':local['kernel_digest'],
  'semantic_bundle_digest':local['semantic_bundle_digest'],
  'internal_source_reference':'roccho-dev/ops#336',
  'internal_surface_digest':http['internal_surface_digest'],
  'external_http_before_surface_digest':http['external_before_surface_digest'],
  'external_http_after_surface_digest':http['external_after_surface_digest'],
  'external_browser_before_surface_digest':browser['external_before_surface_digest'],
  'external_browser_after_surface_digest':browser['external_after_surface_digest'],
  'reload_replay':'PASS',
  'same_worker_version_before_after':True,
  'same_kernel_internal_external':True,
  'duplicate_request':'PASS',
  'idempotency_conflict':'PASS',
  'local_check_count':local['check_count'],
  'real_chromium':True,
  'browser_errors':0,
  'external_requests':0,
  'provider_effects':True,
  'production_authority':False,
  'customer_contact':False,
  'marketing_mail':False,
  'production_cutover':False,
}
open(output_path,'w',encoding='utf-8').write(json.dumps(receipt,sort_keys=True,separators=(',',':'))+'\n')
print(json.dumps(receipt,sort_keys=True))
PY

rm -f "$EVIDENCE/wrangler-deploy.log" "$EVIDENCE/r2-create.log" 2>/dev/null || true
