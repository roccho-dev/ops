#!/usr/bin/env bash
set -euo pipefail

: "${ROOT:?ROOT is required}"
: "${DIST:?DIST is required}"
: "${EVIDENCE:?EVIDENCE is required}"
: "${PROJECT:?PROJECT is required}"
: "${CANDIDATE_SHA:?CANDIDATE_SHA is required}"
: "${PR_NUMBER:?PR_NUMBER is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"

mkdir -p "$EVIDENCE"

node "$ROOT/materialize.mjs" "$ROOT/source.json" "$DIST" | tee "$EVIDENCE/materialize.stdout.json"
python3 - "$DIST/materialize-receipt.json" <<'PY'
import json,sys
receipt=json.load(open(sys.argv[1],encoding='utf-8'))
assert receipt['status']=='PASS'
assert receipt['claim_ceiling']=='PR_CANDIDATE_GREEN'
assert len(receipt['mirrored_assets'])==3
assert receipt['boundary']['semantic_reduce'] is False
assert receipt['boundary']['html_generated_per_update'] is False
PY

python3 -m pip install --quiet --disable-pip-version-check playwright==1.55.0
chrome="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
test -n "$chrome"

python3 -m http.server 4173 --bind 127.0.0.1 --directory "$DIST" > "$EVIDENCE/local-http.log" 2>&1 &
server=$!
trap 'kill $server 2>/dev/null || true' EXIT
for attempt in $(seq 1 100); do
  if curl -fsS http://127.0.0.1:4173/ >/dev/null; then break; fi
  sleep .2
done
CHROME_BIN="$chrome" python3 "$ROOT/browser-smoke.py" \
  http://127.0.0.1:4173/ \
  "$EVIDENCE/local-browser.json" \
  "$EVIDENCE/local-browser.png"
kill "$server" 2>/dev/null || true
trap - EXIT

api="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$PROJECT"
code="$(curl -sS -o "$EVIDENCE/cloudflare-project.json" -w '%{http_code}' \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H 'Content-Type: application/json' "$api")"
project_created=false
if [ "$code" = 404 ]; then
  npx --yes wrangler@4.112.0 pages project create "$PROJECT" --production-branch proposals
  project_created=true
elif [ "$code" = 200 ]; then
  python3 - "$EVIDENCE/cloudflare-project.json" "$PROJECT" <<'PY'
import json,sys
value=json.load(open(sys.argv[1],encoding='utf-8'))
assert value['success'] is True
assert value['result']['name']==sys.argv[2]
assert value['result']['production_branch']=='proposals'
PY
else
  cat "$EVIDENCE/cloudflare-project.json" >&2
  exit 1
fi

preview_branch="adrs-318-pr-$PR_NUMBER"
preview_output="$(npx --yes wrangler@4.112.0 pages deploy "$DIST" \
  --project-name "$PROJECT" \
  --branch "$preview_branch" \
  --commit-hash "$CANDIDATE_SHA" \
  --commit-message 'ADRS 318 gov JSON runtime preview proof' 2>&1)"
printf '%s\n' "$preview_output" | tee "$EVIDENCE/wrangler-preview-deploy.log"
preview_url="$(printf '%s\n' "$preview_output" | grep -Eo 'https://[A-Za-z0-9.-]+\.pages\.dev' | head -n1 || true)"
test -n "$preview_url"
preview_url="${preview_url%/}/"
printf '%s\n' "$preview_url" > "$EVIDENCE/preview-url.txt"

python3 "$ROOT/readback.py" "$DIST" "$preview_url" "$EVIDENCE/preview-readback.json"
CHROME_BIN="$chrome" python3 "$ROOT/browser-smoke.py" \
  "$preview_url" \
  "$EVIDENCE/preview-browser.json" \
  "$EVIDENCE/preview-browser.png"

production_branch=proposals
stable_base="https://$PROJECT.pages.dev/"
production_output="$(npx --yes wrangler@4.112.0 pages deploy "$DIST" \
  --project-name "$PROJECT" \
  --branch "$production_branch" \
  --commit-hash "$CANDIDATE_SHA" \
  --commit-message 'ADRS 318 gov JSON runtime stable deployment' 2>&1)"
printf '%s\n' "$production_output" | tee "$EVIDENCE/wrangler-production-deploy.log"
production_deployment_url="$(printf '%s\n' "$production_output" | grep -Eo 'https://[A-Za-z0-9.-]+\.pages\.dev' | head -n1 || true)"
test -n "$production_deployment_url"
production_deployment_url="${production_deployment_url%/}/"
printf '%s\n' "$production_deployment_url" > "$EVIDENCE/production-deployment-url.txt"
printf '%s\n' "$stable_base" > "$EVIDENCE/stable-url.txt"

python3 "$ROOT/readback.py" "$DIST" "$production_deployment_url" "$EVIDENCE/production-deployment-readback.json"
CHROME_BIN="$chrome" python3 "$ROOT/browser-smoke.py" \
  "$production_deployment_url" \
  "$EVIDENCE/production-deployment-browser.json" \
  "$EVIDENCE/production-deployment-browser.png"

python3 "$ROOT/readback.py" "$DIST" "$stable_base" "$EVIDENCE/stable-readback.json"
CHROME_BIN="$chrome" python3 "$ROOT/browser-smoke.py" \
  "$stable_base" \
  "$EVIDENCE/stable-browser.json" \
  "$EVIDENCE/stable-browser.png"
"$chrome" --version > "$EVIDENCE/chrome-version.txt"

PROJECT_CREATED="$project_created" \
PREVIEW_URL="$preview_url" \
PREVIEW_BRANCH="$preview_branch" \
PRODUCTION_BRANCH="$production_branch" \
PRODUCTION_DEPLOYMENT_URL="$production_deployment_url" \
STABLE_BASE="$stable_base" \
python3 - \
  "$DIST/materialize-receipt.json" \
  "$EVIDENCE/local-browser.json" \
  "$EVIDENCE/preview-readback.json" \
  "$EVIDENCE/preview-browser.json" \
  "$EVIDENCE/production-deployment-readback.json" \
  "$EVIDENCE/production-deployment-browser.json" \
  "$EVIDENCE/stable-readback.json" \
  "$EVIDENCE/stable-browser.json" \
  "$EVIDENCE/provider-proof.json" <<'PY'
import json,os,sys
(
  materialize_path,
  local_path,
  preview_readback_path,
  preview_browser_path,
  production_readback_path,
  production_browser_path,
  stable_readback_path,
  stable_browser_path,
  output_path,
)=sys.argv[1:]
materialize=json.load(open(materialize_path,encoding='utf-8'))
local=json.load(open(local_path,encoding='utf-8'))
preview_readback=json.load(open(preview_readback_path,encoding='utf-8'))
preview_browser=json.load(open(preview_browser_path,encoding='utf-8'))
production_readback=json.load(open(production_readback_path,encoding='utf-8'))
production_browser=json.load(open(production_browser_path,encoding='utf-8'))
stable_readback=json.load(open(stable_readback_path,encoding='utf-8'))
stable_browser=json.load(open(stable_browser_path,encoding='utf-8'))
assert all(value['status']=='PASS' for value in (
  materialize,local,preview_readback,preview_browser,
  production_readback,production_browser,stable_readback,stable_browser,
))
receipt={
  'schema':'ops.govJsonRuntimePagesProof/2',
  'status':'PASS',
  'claim_ceiling':'PR_CANDIDATE_GREEN',
  'authority':False,
  'repository':os.environ['GITHUB_REPOSITORY'],
  'candidate_sha':os.environ['CANDIDATE_SHA'],
  'source_release':materialize['source_release'],
  'source_assets':materialize['mirrored_assets'],
  'cloudflare':{
    'project':os.environ['PROJECT'],
    'project_created_this_run':os.environ['PROJECT_CREATED']=='true',
    'preview_branch':os.environ['PREVIEW_BRANCH'],
    'preview_url':os.environ['PREVIEW_URL'],
    'production_branch':os.environ['PRODUCTION_BRANCH'],
    'production_deployment_url':os.environ['PRODUCTION_DEPLOYMENT_URL'],
    'stable_base':os.environ['STABLE_BASE'],
  },
  'local_browser':'PASS',
  'preview_byte_readback':'PASS',
  'preview_browser':'PASS',
  'production_deployment_byte_readback':'PASS',
  'production_deployment_browser':'PASS',
  'stable_byte_readback':'PASS',
  'stable_browser':'PASS',
  'runtime_fetch':True,
  'display_reduce_only':True,
  'semantic_reduce':False,
  'html_generated_per_data_update':False,
  'provider_effects':True,
  'production_package_contract':False,
  'authenticated_ui':False,
  'provider_e2e':False,
  'authority_changed':False,
  'cutover':False,
}
open(output_path,'w',encoding='utf-8').write(json.dumps(receipt,sort_keys=True,separators=(',',':'))+'\n')
print(json.dumps(receipt,sort_keys=True))
PY
