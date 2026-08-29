#!/usr/bin/env bash
set -euo pipefail

: "${ROOT:?ROOT is required}"
: "${EVIDENCE:?EVIDENCE is required}"
: "${CANDIDATE_SHA:?CANDIDATE_SHA is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"

WRANGLER_VERSION="4.112.0"
BUCKET="stg-adrs-ui-proposals"
PROPOSAL_ID="adrs318-ui-proposal-oidc-canary-v1"
KEY="receipts/$PROPOSAL_ID.json"
WORKER_URL="https://stg-adrs-ui-proposal-ingress.roccho.workers.dev"
SOURCE="$ROOT/manual-comment-readback.json"
RECEIPT="$EVIDENCE/manual-recorded-receipt.json"
READBACK="$EVIDENCE/manual-recorded-r2-readback.json"
EXISTING="$EVIDENCE/manual-recorded-r2-existing.json"
mkdir -p "$EVIDENCE"

python3 - "$SOURCE" "$RECEIPT" "$CANDIDATE_SHA" <<'PY'
import json,pathlib,sys
source=json.load(open(sys.argv[1],encoding='utf-8'))
assert source['schema']=='ops.adrsUiProposalManualCommentReadback/1'
assert source['status']=='PASS'
assert source['proposal_id']=='adrs318-ui-proposal-oidc-canary-v1'
assert source['proposal_digest']=='sha256:029bc192a2fa022879a3c72c0d9f4e45eac8005ba153a4eb15b84a0808b0033e'
assert source['comment_body_sha256']=='sha256:dbcbfb240e416055ff6c73637ed5097d0d138b7c0b852db26bb0dbaa42b770ad'
assert source['comment_id']==5462452549
assert source['comment_url']=='https://github.com/roccho-dev/adrs/issues/318#issuecomment-5462452549'
assert source['exact_comment_readback'] is True
assert source['authority'] is False and source['cutover'] is False
receipt={
  'schema':'ops.adrsUiProposalRecordedReceipt/1',
  'status':'recorded',
  'proposal_id':source['proposal_id'],
  'proposal_digest':source['proposal_digest'],
  'comment_body_sha256':source['comment_body_sha256'],
  'comment_id':source['comment_id'],
  'comment_url':source['comment_url'],
  'exact_comment_readback':True,
  'recording_mode':'manual-connector-fallback',
  'recording_candidate':sys.argv[3],
  'github_write_credential_in_worker':False,
  'relay_automation_proven':False,
  'gov_materialized':False,
  'current_changed':False,
  'authority':False,
  'authority_changed':False,
  'cutover':False,
}
pathlib.Path(sys.argv[2]).write_text(json.dumps(receipt,sort_keys=True,separators=(',',':'))+'\n',encoding='utf-8')
PY

existing=false
if npx --yes "wrangler@$WRANGLER_VERSION" r2 object get "$BUCKET/$KEY" --file="$EXISTING" --remote > "$EVIDENCE/r2-get-existing.log" 2>&1; then
  existing=true
  cmp "$RECEIPT" "$EXISTING"
else
  rm -f "$EXISTING"
  npx --yes "wrangler@$WRANGLER_VERSION" r2 object put "$BUCKET/$KEY" --file="$RECEIPT" --remote > "$EVIDENCE/r2-put.log" 2>&1
fi

npx --yes "wrangler@$WRANGLER_VERSION" r2 object get "$BUCKET/$KEY" --file="$READBACK" --remote > "$EVIDENCE/r2-get-readback.log" 2>&1
cmp "$RECEIPT" "$READBACK"

curl --retry 20 --retry-all-errors --retry-delay 1 --fail-with-body --silent --show-error \
  -H 'Accept: application/json' \
  -H 'User-Agent: roccho-ops-adrs318-manual-bridge-proof/1' \
  "$WORKER_URL/api/proposals/$PROPOSAL_ID" > "$EVIDENCE/recorded-status.json"
python3 - "$EVIDENCE/recorded-status.json" <<'PY'
import json,sys
value=json.load(open(sys.argv[1],encoding='utf-8'))
assert value['status']=='PASS'
assert value['proposal_id']=='adrs318-ui-proposal-oidc-canary-v1'
assert value['state']=='recorded'
assert value['comment_id']==5462452549
assert value['comment_url']=='https://github.com/roccho-dev/adrs/issues/318#issuecomment-5462452549'
assert value['exact_comment_readback'] is True
assert value['gov_materialized'] is False
assert value['current_changed'] is False
assert value['authority'] is False
assert value['cutover'] is False
PY

python3 -m pip install --quiet --disable-pip-version-check playwright==1.55.0
chrome="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
test -n "$chrome"
CHROME_BIN="$chrome" python3 "$ROOT/browser-proof.py" \
  "$WORKER_URL/" "$EVIDENCE/browser-recorded.json" "$EVIDENCE/browser-recorded.png"

EXISTING="$existing" WORKER_URL="$WORKER_URL" BUCKET="$BUCKET" KEY="$KEY" \
python3 - "$SOURCE" "$READBACK" "$EVIDENCE/recorded-status.json" "$EVIDENCE/browser-recorded.json" "$EVIDENCE/manual-bridge-proof.json" <<'PY'
import hashlib,json,os,pathlib,sys
source=json.load(open(sys.argv[1],encoding='utf-8'))
receipt_bytes=pathlib.Path(sys.argv[2]).read_bytes()
status=json.load(open(sys.argv[3],encoding='utf-8'))
browser=json.load(open(sys.argv[4],encoding='utf-8'))
assert status['state']=='recorded'
assert browser['status']=='PASS'
assert browser['status_after_submit']['state']=='recorded'
proof={
  'schema':'ops.adrsUiProposalManualBridgeProof/1',
  'status':'PASS',
  'claim_ceiling':'UI_TO_ADRS_COMMENT_MANUAL_BRIDGE_PROVEN',
  'authority':False,
  'proposal_id':source['proposal_id'],
  'proposal_digest':source['proposal_digest'],
  'comment_body_sha256':source['comment_body_sha256'],
  'comment_id':source['comment_id'],
  'comment_url':source['comment_url'],
  'exact_comment_readback':True,
  'worker_url':os.environ['WORKER_URL']+'/',
  'R2':{
    'bucket':os.environ['BUCKET'],
    'key':os.environ['KEY'],
    'existing_exact_receipt_reused':os.environ['EXISTING']=='true',
    'receipt_sha256':'sha256:'+hashlib.sha256(receipt_bytes).hexdigest(),
    'exact_readback':'PASS',
  },
  'ui_state':'recorded',
  'real_chromium':True,
  'github_write_credential_in_worker':False,
  'automatic_oidc_relay':False,
  'manual_fallback':True,
  'private_adrs_actions_available':False,
  'gov_materialized':False,
  'current_changed':False,
  'authority_changed':False,
  'cutover':False,
}
pathlib.Path(sys.argv[5]).write_text(json.dumps(proof,sort_keys=True,separators=(',',':'))+'\n',encoding='utf-8')
print(json.dumps(proof,sort_keys=True))
PY

rm -f "$EVIDENCE/r2-get-existing.log" "$EVIDENCE/r2-put.log" "$EVIDENCE/r2-get-readback.log" 2>/dev/null || true
