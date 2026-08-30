#!/usr/bin/env bash
set -euo pipefail

: "${ROOT:?ROOT is required}"
: "${DIST:?DIST is required}"
: "${EVIDENCE:?EVIDENCE is required}"
: "${WORKER_NAME:?WORKER_NAME is required}"
: "${CANDIDATE_SHA:?CANDIDATE_SHA is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"

mkdir -p "$DIST" "$EVIDENCE"
python3 "$ROOT/materialize.py" "$ROOT/source.json" "$DIST" \
  | tee "$EVIDENCE/materialize.stdout.json"
python3 - "$DIST/materialize-receipt.json" <<'PY'
import json,sys
value=json.load(open(sys.argv[1],encoding='utf-8'))
assert value['status']=='PASS'
assert value['claim_ceiling']=='VISUAL_EVALUATION_ONLY'
assert value['authority'] is False
assert value['projection']['profile_id']=='governance.selectedUniverseRepo.v1/map/1'
assert value['projection']['pattern']=='map/1'
assert value['projection']['region_count']==5
assert value['projection']['relation_count']==0
assert value['html']['bytes']==15976
assert value['html']['sha256']=='sha256:86668cda9f72231c097bf57eabb8952b9a99c58b9466c4ef0148ffc0b3b70a38'
assert value['boundary']['html_visual_evaluation_only'] is True
assert value['boundary']['html_authority'] is False
assert value['boundary']['semantic_map_renderer_owned_by_ui'] is True
assert value['boundary']['delivery_owned_by_ops'] is True
assert value['boundary']['production_cutover'] is False
PY

cp "$DIST/index.html" packages/gov-release-proxy/public/index.html
(
  cd packages/gov-release-proxy
  npm run check
  npx --yes wrangler@4.112.0 deploy --dry-run --outdir "$EVIDENCE/dry-run"
)

python3 -m pip install --quiet --disable-pip-version-check playwright==1.55.0
chrome="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
test -n "$chrome"

# Local visual proof checks the exact UI bytes before the provider effect.
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

(
  cd packages/gov-release-proxy
  deploy_output="$(npx --yes wrangler@4.112.0 deploy --name "$WORKER_NAME" 2>&1)"
  printf '%s\n' "$deploy_output" | tee "$EVIDENCE/wrangler-deploy.log"
)
worker_url="$(grep -Eo 'https://[A-Za-z0-9.-]+\.workers\.dev' "$EVIDENCE/wrangler-deploy.log" | head -n1 || true)"
if [ -z "$worker_url" ]; then
  worker_url="https://$WORKER_NAME.roccho.workers.dev"
fi
worker_url="${worker_url%/}/"
printf '%s\n' "$worker_url" > "$EVIDENCE/worker-url.txt"

python3 "$ROOT/readback.py" "$DIST" "$worker_url" "$EVIDENCE/remote-readback.json"
CHROME_BIN="$chrome" python3 "$ROOT/browser-smoke.py" \
  "$worker_url" \
  "$EVIDENCE/remote-browser.json" \
  "$EVIDENCE/remote-browser.png"
"$chrome" --version > "$EVIDENCE/chrome-version.txt"

WORKER_URL="$worker_url" python3 - \
  "$DIST/materialize-receipt.json" \
  "$EVIDENCE/local-browser.json" \
  "$EVIDENCE/remote-readback.json" \
  "$EVIDENCE/remote-browser.json" \
  "$EVIDENCE/provider-proof.json" <<'PY'
import json,os,sys
materialize,local,readback,browser=[json.load(open(path,encoding='utf-8')) for path in sys.argv[1:5]]
output=sys.argv[5]
assert all(value['status']=='PASS' for value in (materialize,local,readback,browser))
assert local['state_hash']==browser['state_hash']==materialize['projection']['state_hash']
assert local['meaning_sha256']==browser['meaning_sha256']==materialize['meaning']['sha256']
assert local['profile_sha256']==browser['profile_sha256']==materialize['projection']['profile_sha256']
assert local['svg_sha256']==browser['svg_sha256']==materialize['projection']['svg_sha256']
receipt={
  'schema':'ops.selectedUniverseSemanticMapWorkerProof/2',
  'status':'PASS',
  'claim_ceiling':'VISUAL_EVALUATION_ONLY',
  'authority':False,
  'repository':os.environ['GITHUB_REPOSITORY'],
  'candidate_sha':os.environ['CANDIDATE_SHA'],
  'worker_name':os.environ['WORKER_NAME'],
  'url':os.environ['WORKER_URL'],
  'meaning':materialize['meaning'],
  'ui':materialize['ui'],
  'projection':materialize['projection'],
  'html':materialize['html'],
  'same_root_html_and_ndjson':True,
  'local_browser':'PASS',
  'remote_byte_readback':'PASS',
  'remote_browser':'PASS',
  'technical_observation':'REMOTE_HTML_NDJSON_AND_BROWSER_MATCH',
  'html_visual_evaluation_only':True,
  'meaning_source_unchanged':True,
  'production_cutover':False,
}
open(output,'w',encoding='utf-8').write(json.dumps(receipt,sort_keys=True,separators=(',',':'))+'\n')
print(json.dumps(receipt,sort_keys=True))
PY
