#!/usr/bin/env bash
set -euo pipefail

: "${ROOT:?ROOT is required}"
: "${EVIDENCE:?EVIDENCE is required}"
: "${CANDIDATE_SHA:?CANDIDATE_SHA is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"

WRANGLER_VERSION="4.112.0"
BUCKET="stg-log-projected-observations"
sha_suffix="$(printf '%s' "$CANDIDATE_SHA" | cut -c1-10)"
WORKER="stg-log-projected-semantic-$sha_suffix"
PROOF_ID="proof-semantic-$sha_suffix"
PREFIX="semantic-evolution/$PROOF_ID"
RUN_SUFFIX="$sha_suffix-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
mkdir -p "$EVIDENCE"

node "$ROOT/local-proof.mjs" "$EVIDENCE/local-proof.json"
readarray -t DIGESTS < <(python3 - "$EVIDENCE/local-proof.json" <<'PY'
import json,sys
v=json.load(open(sys.argv[1],encoding='utf-8'))
assert v['status']=='PASS'
assert v['check_count'] >= 18
print(v['event_digest'])
print(v['bundle_v1_digest'])
print(v['bundle_v2_digest'])
print(v['static_asset_bundle_sha256'])
PY
)
EVENT_DIGEST="${DIGESTS[0]}"
BUNDLE_V1_DIGEST="${DIGESTS[1]}"
BUNDLE_V2_DIGEST="${DIGESTS[2]}"
STATIC_BUNDLE_DIGEST="${DIGESTS[3]}"

api="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets?name_contains=$BUCKET&per_page=1000"
curl -fsS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "$api" > "$EVIDENCE/r2-buckets.raw.json"
python3 - "$EVIDENCE/r2-buckets.raw.json" "$BUCKET" <<'PY'
import json,sys
value=json.load(open(sys.argv[1],encoding='utf-8'))
assert value['success'] is True
assert any(item.get('name')==sys.argv[2] for item in value.get('result',{}).get('buckets',[])), 'expected existing proof bucket'
PY
rm -f "$EVIDENCE/r2-buckets.raw.json"

r2_get() {
  local key="$1" out="$2"
  npx --yes "wrangler@$WRANGLER_VERSION" r2 object get "$BUCKET/$key" --remote --file "$out" >/dev/null 2>&1
}
put_immutable() {
  local key="$1" file="$2" label="$3"
  local out="$EVIDENCE/${label}.r2.json"
  if r2_get "$key" "$out"; then
    cmp "$file" "$out"
  else
    npx --yes "wrangler@$WRANGLER_VERSION" r2 object put "$BUCKET/$key" --remote --file "$file" >/dev/null
    r2_get "$key" "$out"
    cmp "$file" "$out"
  fi
}

put_immutable "$PREFIX/events/base.json" "$ROOT/fixtures/event.json" "event"
put_immutable "$PREFIX/bundles/${BUNDLE_V1_DIGEST#sha256:}.json" "$ROOT/fixtures/bundle-v1.json" "bundle-v1"
put_immutable "$PREFIX/bundles/${BUNDLE_V2_DIGEST#sha256:}.json" "$ROOT/fixtures/bundle-v2.json" "bundle-v2"

python3 - "$ROOT/wrangler.template.json" "$ROOT/wrangler.generated.json" "$CANDIDATE_SHA" "$WORKER" "$PROOF_ID" "$EVENT_DIGEST" "$BUNDLE_V1_DIGEST" "$BUNDLE_V2_DIGEST" <<'PY'
import json,sys
source,target,sha,worker,proof,event,v1,v2=sys.argv[1:]
value=json.load(open(source,encoding='utf-8'))
value['name']=worker
value['vars'].update({
  'APP_VERSION':sha,
  'WORKER_NAME':worker,
  'PROOF_ID':proof,
  'EVENT_DIGEST':event,
  'BUNDLE_V1_DIGEST':v1,
  'BUNDLE_V2_DIGEST':v2,
})
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
    if python3 - "$EVIDENCE/meta.json" "$CANDIDATE_SHA" "$WORKER" "$PROOF_ID" "$EVENT_DIGEST" "$BUNDLE_V1_DIGEST" "$BUNDLE_V2_DIGEST" <<'PY'
import json,sys
meta=json.load(open(sys.argv[1],encoding='utf-8'))
assert meta['status']=='PASS'
assert meta['app_version']==sys.argv[2]
assert meta['worker_name']==sys.argv[3]
assert meta['proof_id']==sys.argv[4]
assert meta['event_digest']==sys.argv[5]
assert meta['admitted_bundle_digests']==[sys.argv[6],sys.argv[7]]
PY
    then break; fi
  fi
  sleep .3
  if [ "$attempt" = 100 ]; then echo 'worker readiness failed' >&2; exit 1; fi
done

python3 "$ROOT/remote-proof.py" "$worker_url" "$PROOF_ID" "$EVENT_DIGEST" "$BUNDLE_V1_DIGEST" "$BUNDLE_V2_DIGEST" "$CANDIDATE_SHA" "$RUN_SUFFIX" "$EVIDENCE/remote-http.json"

python3 -m pip install --quiet --disable-pip-version-check playwright==1.55.0
chrome="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
test -n "$chrome"
CHROME_BIN="$chrome" python3 "$ROOT/browser-proof.py" "$worker_url" "$PROOF_ID" "$BUNDLE_V1_DIGEST" "$BUNDLE_V2_DIGEST" "$CANDIDATE_SHA" "$RUN_SUFFIX" "$EVIDENCE/remote-browser.json" "$EVIDENCE/remote-browser.png"
"$chrome" --version > "$EVIDENCE/chrome-version.txt"

curl --retry 20 --retry-all-errors --retry-delay 1 -fsS "$worker_url/" > "$EVIDENCE/index.remote.html"
curl --retry 20 --retry-all-errors --retry-delay 1 -fsS "$worker_url/app.js" > "$EVIDENCE/app.remote.js"
curl --retry 20 --retry-all-errors --retry-delay 1 -fsS "$worker_url/styles.css" > "$EVIDENCE/styles.remote.css"
cmp "$ROOT/public/index.html" "$EVIDENCE/index.remote.html"
cmp "$ROOT/public/app.js" "$EVIDENCE/app.remote.js"
cmp "$ROOT/public/styles.css" "$EVIDENCE/styles.remote.css"

r2_get "$PREFIX/events/base.json" "$EVIDENCE/event.final.r2.json"
r2_get "$PREFIX/bundles/${BUNDLE_V1_DIGEST#sha256:}.json" "$EVIDENCE/bundle-v1.final.r2.json"
r2_get "$PREFIX/bundles/${BUNDLE_V2_DIGEST#sha256:}.json" "$EVIDENCE/bundle-v2.final.r2.json"
cmp "$ROOT/fixtures/event.json" "$EVIDENCE/event.final.r2.json"
cmp "$ROOT/fixtures/bundle-v1.json" "$EVIDENCE/bundle-v1.final.r2.json"
cmp "$ROOT/fixtures/bundle-v2.json" "$EVIDENCE/bundle-v2.final.r2.json"

WORKER_URL="$worker_url" WORKER="$WORKER" BUCKET="$BUCKET" PROOF_ID="$PROOF_ID" PREFIX="$PREFIX" STATIC_BUNDLE_DIGEST="$STATIC_BUNDLE_DIGEST" \
python3 - "$EVIDENCE/local-proof.json" "$EVIDENCE/remote-http.json" "$EVIDENCE/remote-browser.json" "$EVIDENCE/provider-proof.json" <<'PY'
import json,os,sys
local_path,http_path,browser_path,out=sys.argv[1:]
local=json.load(open(local_path,encoding='utf-8'))
http=json.load(open(http_path,encoding='utf-8'))
browser=json.load(open(browser_path,encoding='utf-8'))
assert local['status']==http['status']==browser['status']=='PASS'
assert local['event_digest']==http['event_digest_before']==http['event_digest_after']==browser['event_digest']
assert local['bundle_v1_digest']==http['bundle_v1_digest']==browser['bundle_v1_digest']
assert local['bundle_v2_digest']==http['bundle_v2_digest']==browser['bundle_v2_digest']
assert http['surface_v1_digest']==http['exact_v1_replay_digest']==http['rollback_surface_digest']
assert browser['surface_v1_digest']==browser['exact_v1_replay_digest']==browser['rollback_surface_digest']
assert http['worker_version_stable'] is True and browser['same_worker_version'] is True
receipt={
  'schema':'ops.semanticBundleEvolutionProviderProof/1',
  'status':'PASS',
  'claim_ceiling':'BOUNDED_PROVIDER_PROOF',
  'authority':False,
  'repository':os.environ['GITHUB_REPOSITORY'],
  'base_sha':os.environ.get('BASE_SHA'),
  'candidate_sha':os.environ['CANDIDATE_SHA'],
  'kernel_id':local['kernel_id'],
  'worker':{'name':os.environ['WORKER'],'url':os.environ['WORKER_URL'],'same_version_v1_v2_v1':True,'static_asset_readback':'PASS'},
  'R2':{
    'bucket':os.environ['BUCKET'],
    'prefix':os.environ['PREFIX'],
    'event_byte_readback':'PASS',
    'bundle_v1_byte_readback':'PASS',
    'bundle_v2_byte_readback':'PASS',
    'selection_pointer_authority':False,
    'relationship_current_state_objects':0,
  },
  'proof_id':os.environ['PROOF_ID'],
  'event_digest':local['event_digest'],
  'bundle_v1_digest':local['bundle_v1_digest'],
  'bundle_v2_digest':local['bundle_v2_digest'],
  'static_asset_bundle_sha256':os.environ['STATIC_BUNDLE_DIGEST'],
  'http_surface_v1_digest':http['surface_v1_digest'],
  'http_surface_v2_digest':http['surface_v2_digest'],
  'http_rollback_digest':http['rollback_surface_digest'],
  'browser_surface_v1_digest':browser['surface_v1_digest'],
  'browser_surface_v2_digest':browser['surface_v2_digest'],
  'browser_rollback_digest':browser['rollback_surface_digest'],
  'same_event_bytes_across_bundle_change':True,
  'historical_v1_replay':'PASS',
  'stale_writer_rejected':True,
  'unknown_bundle_rejected':True,
  'duplicate_selection_idempotent':True,
  'real_chromium':True,
  'browser_errors':0,
  'external_requests':0,
  'accepted_meaning_authority':False,
  'customer_effect':False,
  'production_cutover':False,
}
open(out,'w',encoding='utf-8').write(json.dumps(receipt,sort_keys=True,separators=(',',':'))+'\n')
print(json.dumps(receipt,sort_keys=True))
PY

rm -f "$EVIDENCE/wrangler-deploy.log" 2>/dev/null || true
