#!/usr/bin/env bash
set -euo pipefail

: "${ROOT:?ROOT is required}"
: "${UI_ROOT:?UI_ROOT is required}"
: "${PACKAGE_ROOT:?PACKAGE_ROOT is required}"
: "${EVIDENCE:?EVIDENCE is required}"
: "${WORKER_NAME:?WORKER_NAME is required}"
: "${CANDIDATE_SHA:?CANDIDATE_SHA is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"

mkdir -p "$EVIDENCE"
node "$ROOT/build-real-case.mjs" "$UI_ROOT" "$PACKAGE_ROOT" "$EVIDENCE" \
  | tee "$EVIDENCE/build.stdout.json"

(
  cd "$PACKAGE_ROOT"
  npm run check
  npx --yes wrangler@4.112.0 deploy --dry-run --outdir "$EVIDENCE/dry-run"
)

python3 -m pip install --quiet --disable-pip-version-check playwright==1.55.0
chrome="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
test -n "$chrome"
"$chrome" --version > "$EVIDENCE/chrome-version.txt"

node "$ROOT/local-server.mjs" "$EVIDENCE/meaning.jsonl" 4173 > "$EVIDENCE/local-server.log" 2>&1 &
server=$!
trap 'kill "$server" 2>/dev/null || true' EXIT
for attempt in $(seq 1 100); do
  if curl -fsS -H 'Accept: text/html' http://127.0.0.1:4173/ >/dev/null; then break; fi
  sleep .2
done
CHROME_BIN="$chrome" python3 "$ROOT/browser-proof.py" \
  http://127.0.0.1:4173/ \
  "$EVIDENCE/expected.json" \
  "$EVIDENCE/local-browser.json" \
  "$EVIDENCE/local-browser.png"
kill "$server" 2>/dev/null || true
trap - EXIT

(
  cd "$PACKAGE_ROOT"
  deploy_output="$(npx --yes wrangler@4.112.0 deploy --name "$WORKER_NAME" 2>&1)"
  printf '%s\n' "$deploy_output" | tee "$EVIDENCE/wrangler-deploy.log"
)
worker_url="$(grep -Eo 'https://[A-Za-z0-9.-]+\.workers\.dev' "$EVIDENCE/wrangler-deploy.log" | head -n1 || true)"
if [ -z "$worker_url" ]; then
  worker_url="https://$WORKER_NAME.roccho.workers.dev"
fi
worker_url="${worker_url%/}/"
printf '%s\n' "$worker_url" > "$EVIDENCE/worker-url.txt"

CHROME_BIN="$chrome" python3 "$ROOT/browser-proof.py" \
  "$worker_url" \
  "$EVIDENCE/expected.json" \
  "$EVIDENCE/remote-browser.json" \
  "$EVIDENCE/remote-browser.png"

WORKER_URL="$worker_url" python3 - \
  "$EVIDENCE/expected.json" \
  "$EVIDENCE/local-browser.json" \
  "$EVIDENCE/remote-browser.json" \
  "$EVIDENCE/provider-proof.json" <<'PY'
import json, os, sys
expected, local, remote = [json.load(open(path, encoding="utf-8")) for path in sys.argv[1:4]]
assert local["status"] == remote["status"] == "PASS"
assert local["bindingId"] == remote["bindingId"] == expected["bindingId"]
assert local["meaning"]["sha256"] == remote["meaning"]["sha256"] == expected["meaning"]["sha256"]
assert local["ui"]["htmlSha256"] == remote["ui"]["htmlSha256"] == expected["ui"]["htmlSha256"]
receipt = {
    "schema": "ops.govPackageSemanticMapProviderProof/1",
    "status": "PASS",
    "repository": os.environ["GITHUB_REPOSITORY"],
    "candidateSha": os.environ["CANDIDATE_SHA"],
    "workerName": os.environ["WORKER_NAME"],
    "url": os.environ["WORKER_URL"],
    "bindingId": expected["bindingId"],
    "meaning": expected["meaning"],
    "ui": expected["ui"],
    "projection": expected["projection"],
    "sameRootHtmlAndNdjson": True,
    "localBrowser": "PASS",
    "remoteHtmlByteReadback": "PASS",
    "remoteNdjsonByteReadback": "PASS",
    "remoteBrowser": "PASS",
    "authority": False,
    "productionCutover": False,
}
open(sys.argv[4], "w", encoding="utf-8").write(json.dumps(receipt, sort_keys=True, separators=(",", ":")) + "\n")
print(json.dumps(receipt, sort_keys=True))
PY
