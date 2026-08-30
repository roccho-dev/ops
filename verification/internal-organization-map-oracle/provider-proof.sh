#!/usr/bin/env bash
set -euo pipefail
: "${ROOT:?ROOT required}"
: "${DIST:?DIST required}"
: "${EVIDENCE:?EVIDENCE required}"
: "${PROJECT:?PROJECT required}"
: "${BRANCH:?BRANCH required}"
: "${CANDIDATE_SHA:?CANDIDATE_SHA required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID required}"
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN required}"
UI_REF="59ba7c0370de72a790c8828994d5b726ce4cd944"
UI_REPOSITORY="https://github.com/roccho-dev/ui.git"
mkdir -p "$DIST" "$EVIDENCE/local-screens" "$EVIDENCE/deployment-screens" "$EVIDENCE/alias-screens"

state="$EVIDENCE/organization-current.jsonl"
envelope="$EVIDENCE/semantic-map-envelope.json"
ui_source="$EVIDENCE/ui-source"
ui_oracle="$EVIDENCE/ui-standalone"
python3 "$ROOT/build-state.py" "$state" | tee "$EVIDENCE/build-state.stdout.json"
python3 "$ROOT/normalize-ui-state.py" "$state" | tee "$EVIDENCE/normalize-ui-state.stdout.json"
python3 "$ROOT/build-envelope.py" "$state" "$envelope" | tee "$EVIDENCE/build-envelope.stdout.json"

git init -q "$ui_source"
git -C "$ui_source" remote add origin "$UI_REPOSITORY"
git -C "$ui_source" fetch -q --depth=1 origin "$UI_REF"
git -C "$ui_source" checkout -q --detach FETCH_HEAD
test "$(git -C "$ui_source" rev-parse HEAD)" = "$UI_REF"
node "$ui_source/packages/semantic-map/scripts/build-browser-example.mjs" --input="$envelope" --out="$ui_oracle" | tee "$EVIDENCE/ui-standalone-build.stdout.json"
cp "$ui_oracle/receipt.json" "$EVIDENCE/ui-standalone-receipt.json"
python3 "$ROOT/materialize.py" "$state" "$DIST" --oracle-file "$ui_oracle/index.html" --ui-ref "$UI_REF" | tee "$EVIDENCE/materialize.stdout.json"

sudo apt-get update -qq
sudo apt-get install -y -qq fonts-noto-cjk >/dev/null
python3 -m pip install --quiet --disable-pip-version-check playwright==1.55.0
chrome="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
test -n "$chrome"
"$chrome" --version | tee "$EVIDENCE/chrome-version.txt"

python3 -m http.server 4173 --bind 127.0.0.1 --directory "$DIST" > "$EVIDENCE/local-http.log" 2>&1 &
server=$!
trap 'kill "$server" 2>/dev/null || true' EXIT
for _ in $(seq 1 100); do curl -fsS http://127.0.0.1:4173/ >/dev/null && break; sleep .2; done
CHROME_BIN="$chrome" python3 "$ROOT/browser-check.py" http://127.0.0.1:4173/ "$EVIDENCE/local-browser.json" "$EVIDENCE/local-screens"
kill "$server" 2>/dev/null || true
trap - EXIT

api="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$PROJECT"
code="$(curl -sS -o "$EVIDENCE/cloudflare-project.json" -w '%{http_code}' -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'Content-Type: application/json' "$api")"
if [ "$code" = 404 ]; then
  npx --yes wrangler@4.112.0 pages project create "$PROJECT" --production-branch proposals | tee "$EVIDENCE/wrangler-project-create.log"
elif [ "$code" = 200 ]; then
  python3 - "$EVIDENCE/cloudflare-project.json" "$PROJECT" <<'PY'
import json,sys
v=json.load(open(sys.argv[1]));assert v['success'] is True;assert v['result']['name']==sys.argv[2]
PY
else
  cat "$EVIDENCE/cloudflare-project.json" >&2; exit 1
fi

deploy_output="$(npx --yes wrangler@4.112.0 pages deploy "$DIST" --project-name "$PROJECT" --branch "$BRANCH" --commit-hash "$CANDIDATE_SHA" --commit-message 'ADRS 331 internal organization map visual oracle' 2>&1)"
printf '%s\n' "$deploy_output" | tee "$EVIDENCE/wrangler-deploy.log"
deployment_url="$(printf '%s\n' "$deploy_output" | grep -Eo 'https://[A-Za-z0-9.-]+\.pages\.dev' | head -n1 || true)"
test -n "$deployment_url"
deployment_url="${deployment_url%/}/"
alias_url="https://$BRANCH.$PROJECT.pages.dev/"
printf '%s\n' "$deployment_url" > "$EVIDENCE/deployment-url.txt"
printf '%s\n' "$alias_url" > "$EVIDENCE/alias-url.txt"

python3 "$ROOT/readback.py" "$DIST" "$deployment_url" "$EVIDENCE/deployment-readback.json"
CHROME_BIN="$chrome" python3 "$ROOT/browser-check.py" "$deployment_url" "$EVIDENCE/deployment-browser.json" "$EVIDENCE/deployment-screens"
python3 "$ROOT/readback.py" "$DIST" "$alias_url" "$EVIDENCE/alias-readback.json" --attempts 50
CHROME_BIN="$chrome" python3 "$ROOT/browser-check.py" "$alias_url" "$EVIDENCE/alias-browser.json" "$EVIDENCE/alias-screens"

PROJECT="$PROJECT" BRANCH="$BRANCH" CANDIDATE_SHA="$CANDIDATE_SHA" UI_REF="$UI_REF" DEPLOYMENT_URL="$deployment_url" ALIAS_URL="$alias_url" python3 - "$DIST/materialize-receipt.json" "$EVIDENCE/local-browser.json" "$EVIDENCE/deployment-readback.json" "$EVIDENCE/deployment-browser.json" "$EVIDENCE/alias-readback.json" "$EVIDENCE/alias-browser.json" "$EVIDENCE/provider-proof.json" <<'PY'
import json,os,sys
paths=sys.argv[1:-1];out=sys.argv[-1];values=[json.load(open(p,encoding='utf-8')) for p in paths]
assert all(v['status']=='PASS' for v in values)
receipt={
 'schema':'ops.internalOrganizationMapProviderProof/2','status':'PASS','authority':False,
 'claimCeiling':'BOUNDED_READ_ONLY_STAGING_VISUAL_EVALUATION',
 'candidateSha':os.environ['CANDIDATE_SHA'],
 'ui':{'repository':'roccho-dev/ui','ref':os.environ['UI_REF'],'builder':'packages/semantic-map/scripts/build-browser-example.mjs'},
 'cloudflare':{'project':os.environ['PROJECT'],'branch':os.environ['BRANCH'],'deploymentUrl':os.environ['DEPLOYMENT_URL'],'stableBranchAlias':os.environ['ALIAS_URL']},
 'localBrowser':'PASS','deploymentByteReadback':'PASS','deploymentBrowser':'PASS','aliasByteReadback':'PASS','aliasBrowser':'PASS',
 'patterns':['map/1','graph/1','seq/1'],'productionCutover':False,
}
open(out,'w',encoding='utf-8').write(json.dumps(receipt,ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n')
print(json.dumps(receipt,ensure_ascii=False,sort_keys=True))
PY
