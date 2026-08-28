#!/usr/bin/env bash
set -euo pipefail

: "${ROOT:?ROOT is required}"
: "${EVIDENCE:?EVIDENCE is required}"
: "${CANDIDATE_SHA:?CANDIDATE_SHA is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"

OLD_ROOT="verification/adrs-322-log-projected-application"
WRANGLER_VERSION="4.112.0"
BUCKET="stg-log-projected-observations"
sha_suffix="$(printf '%s' "$CANDIDATE_SHA" | cut -c1-10)"
WORKER="stg-log-projected-public-$sha_suffix"
mkdir -p "$EVIDENCE"

node "$ROOT/local-proof.mjs" "$EVIDENCE/local-proof.json"

api="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets?name_contains=$BUCKET&per_page=1000"
curl -fsS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "$api" > "$EVIDENCE/r2-buckets.raw.json"
python3 - "$EVIDENCE/r2-buckets.raw.json" "$BUCKET" <<'PY'
import json,sys
value=json.load(open(sys.argv[1],encoding='utf-8'))
assert value['success'] is True
assert any(item.get('name')==sys.argv[2] for item in value.get('result',{}).get('buckets',[])), 'expected existing proof bucket'
PY
rm -f "$EVIDENCE/r2-buckets.raw.json"

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
  if curl -fsS "$worker_url/api/meta" > "$EVIDENCE/meta.json" 2>/dev/null; then
    if python3 - "$EVIDENCE/meta.json" "$CANDIDATE_SHA" "$WORKER" <<'PY'
import json,sys
meta=json.load(open(sys.argv[1],encoding='utf-8'))
assert meta['status']=='PASS'
assert meta['app_version']==sys.argv[2]
assert meta['worker_name']==sys.argv[3]
PY
    then break; fi
  fi
  sleep .3
  if [ "$attempt" = 100 ]; then echo 'worker readiness failed' >&2; exit 1; fi
done

run_suffix="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
subject="proof-external-public-$sha_suffix-$run_suffix"
request_id="continue-public-$sha_suffix-$run_suffix"

python3 -m pip install --quiet --disable-pip-version-check playwright==1.55.0
chrome="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
test -n "$chrome"
CHROME_BIN="$chrome" python3 "$OLD_ROOT/browser-smoke.py" \
  "$worker_url" "$subject" "$request_id" \
  "$EVIDENCE/remote-browser.json" "$EVIDENCE/remote-browser.png"
"$chrome" --version > "$EVIDENCE/chrome-version.txt"

encoded_subject="$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))' "$subject")"
encoded_request="$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))' "$request_id")"
curl --retry 20 --retry-all-errors --retry-delay 1 -fsS \
  "$worker_url/api/observation?subject_id=$encoded_subject&request_id=$encoded_request" \
  > "$EVIDENCE/observation-readback.json"
curl --retry 20 --retry-all-errors --retry-delay 1 -fsS \
  "$worker_url/api/evidence?subject_id=$encoded_subject" \
  > "$EVIDENCE/observation-pool.json"\n
curl --retry 20 --retry-all-errors --retry-delay 1 -fsS "$worker_url/" > "$EVIDENCE/index.remote.html"
curl --retry 20 --retry-all-errors --retry-delay 1 -fsS "$worker_url/app.js" > "$EVIDENCE/app.remote.js"
curl --retry 20 --retry-all-errors --retry-delay 1 -fsS "$worker_url/projection.json" > "$EVIDENCE/projection.remote.json"
cmp "$ROOT/public/index.html" "$EVIDENCE/index.remote.html"
cmp "$ROOT/public/app.js" "$EVIDENCE/app.remote.js"
cmp "$ROOT/public/projection.json" "$EVIDENCE/projection.remote.json"

WORKER_URL="$worker_url" WORKER="$WORKER" BUCKET="$BUCKET" SUBJECT="$subject" REQUEST_ID="$request_id" \
python3 - "$EVIDENCE/local-proof.json" "$EVIDENCE/remote-browser.json" "$EVIDENCE/observation-readback.json" "$EVIDENCE/observation-pool.json" "$EVIDENCE/provider-proof.json" "$EVIDENCE/measurement.json" <<'PY'
import json,os,sys
local_path,browser_path,readback_path,pool_path,provider_path,measurement_path=sys.argv[1:]
local=json.load(open(local_path,encoding='utf-8'))
browser=json.load(open(browser_path,encoding='utf-8'))
readback=json.load(open(readback_path,encoding='utf-8'))
pool=json.load(open(pool_path,encoding='utf-8'))
assert local['status']==browser['status']==readback['status']==pool['status']=='PASS'
assert browser['observation_object_count']==1
assert pool['object_count']==1
assert pool['projection_object_count']==0
assert browser['projection_object_count']==0
assert browser['external_after_surface_digest']==browser['reload_surface_digest']
assert readback['event']['subject_id']==os.environ['SUBJECT']
assert readback['event']['event_id']==os.environ['REQUEST_ID']
assert readback['event']['kind']=='interaction.continue.observed'
assert readback['event']['payload']['action_id']=='continue'

measurement={
  'schema':'ops.publicDecisionObservationMeasurement/1',
  'status':'PASS',
  'authority':False,
  'public_surface':os.environ['WORKER_URL'],
  'technical_real_public_observation_count':1,
  'qualified_market_observation_count':0,
  'assessment':'INSUFFICIENT_FOR_MARKET_LEARNING',
  'reason':'Only controlled proof traffic is evidenced; no independent external audience observation is claimed.',
  'next_effect_policy':'ONE_BOUNDED_ACCELERATION_EFFECT_ALLOWED',
  'marketing_mail_required':False,
}
provider={
  'schema':'ops.publicDecisionProviderProof/1',
  'status':'PASS',
  'authority':False,
  'claim_ceiling':'ONE_ACCEPTED_PUBLIC_DECISION_TO_ONE_REAL_TECHNICAL_OBSERVATION',
  'source_acceptance_comment_id':5448293184,
  'public_projection_sha256':local['projection_sha256'],
  'public_bundle_sha256':local['bundle_sha256'],
  'candidate_sha':os.environ['CANDIDATE_SHA'],
  'worker':{'name':os.environ['WORKER'],'url':os.environ['WORKER_URL'],'candidate_scoped':True},
  'R2':{'bucket':os.environ['BUCKET'],'object_key':readback['object_key'],'object_sha256':readback['object_sha256'],'remote_readback':'PASS','current_projection_objects':0},
  'real_chromium':True,
  'browser_errors':len(browser['page_errors'])+len(browser['console_errors']),
  'external_browser_requests':len(browser['external_requests']),
  'observation_class':'controlled_real_public_surface_interaction',
  'qualified_market_observation':False,
  'reprojection':'PASS',
  'reload_digest_match':True,
  'current_pointer_used':False,
  'production_cutover':False,
  'customer_contact':False,
  'marketing_mail':False,
  'payment_effect':False,
}
for path,value in [(measurement_path,measurement),(provider_path,provider)]:
  open(path,'w',encoding='utf-8').write(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n')
print(json.dumps(provider,sort_keys=True))
print(json.dumps(measurement,sort_keys=True))
PY

rm -f "$EVIDENCE/wrangler-deploy.log"
