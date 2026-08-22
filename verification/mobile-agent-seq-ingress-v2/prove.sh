#!/usr/bin/env bash
set -euo pipefail

root="$RUNNER_TEMP/result"
mkdir -p "$root"
gh api "repos/$GITHUB_REPOSITORY/issues/286/comments?per_page=100" > "$root/comments.json"
python3 verification/mobile-agent-seq-ingress-v2/reconstruct.py \
  "$root/comments.json" \
  verification/mobile-agent-seq-ingress-v2/contract.json \
  "$root" \
  "$GITHUB_REPOSITORY_OWNER"

carrier="$root/carrier"
node "$carrier/bin/compile-url.mjs" \
  "$carrier/fixtures/seq.jsonl" \
  seq/1 \
  https://stg-mobile-agent.pages.dev/ \
  "$root/compile-receipt.json"
python3 - "$root/compile-receipt.json" <<'PY'
import json,sys
value=json.load(open(sys.argv[1],encoding='utf-8'))
assert value['schema']=='mobile-agent-url-compile-receipt/1'
assert value['status']=='PASS'
assert value['preset']=='seq/1'
assert value['view']=={'pattern':'seq/1','seq':{'axis':'ordinal','groupBy':'actor'}}
assert value['input']['sha256']=='sha256:94de0b233bcdfdb8c471484b2505bbfd2a23170d54b1de8fdc46b5b1815bcda4'
assert value['roundTripExact'] is True
assert value['url'].startswith('https://stg-mobile-agent.pages.dev/app#smap=')
assert value['sourceCloneUsed'] is False
assert value['sourceBuildUsed'] is False
assert value['providerWriteUsed'] is False
PY

npm install --ignore-scripts --no-save --no-audit --no-fund playwright-core@1.55.0
chrome="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
test -n "$chrome"
python3 -m http.server 4173 --bind 127.0.0.1 --directory "$carrier/dist" > "$root/http.log" 2>&1 &
server=$!
trap 'kill $server 2>/dev/null || true' EXIT
for attempt in $(seq 1 100); do
  if curl -fsS http://127.0.0.1:4173/app/ >/dev/null; then break; fi
  sleep .2
done
curl -fsS http://127.0.0.1:4173/app/ >/dev/null
node verification/mobile-agent-seq-ingress-v2/smoke.mjs \
  "$root/compile-receipt.json" \
  http://127.0.0.1:4173/ \
  "$chrome" \
  "$root/local-proof"
"$chrome" --version > "$root/local-chrome-version.txt"

test "$(wc -c < "$root/mobile-agent-seq-carrier.tar.xz")" -eq 426144
test "$(sha256sum "$root/mobile-agent-seq-carrier.tar.xz" | cut -d' ' -f1)" = 516a740503c8a22b1b4e0051fab3f5b9a942578fea8fd016323a0ccbe54c3e0d
