#!/usr/bin/env bash
set -euo pipefail

root="$RUNNER_TEMP/result"
tag='mobile-agent-seq-carrier-516a740503c8a22b1b4e0051fab3f5b9a942578fea8fd016323a0ccbe54c3e0d'
archive_name='mobile-agent-seq-carrier.tar.xz'
cp "$root/carrier/manifest.json" "$root/mobile-agent-seq-carrier-manifest.json"
cp "$root/transport-receipt.json" "$root/mobile-agent-seq-transport-receipt.json"
cp "$root/compile-receipt.json" "$root/mobile-agent-seq-compile-receipt.json"
cp "$root/local-proof/receipt.json" "$root/mobile-agent-seq-local-proof.json"
assets=(
  "$root/$archive_name"
  "$root/mobile-agent-seq-carrier-manifest.json"
  "$root/mobile-agent-seq-transport-receipt.json"
  "$root/mobile-agent-seq-compile-receipt.json"
  "$root/mobile-agent-seq-local-proof.json"
)
if ! gh release view "$tag" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
  gh release create "$tag" \
    --repo "$GITHUB_REPOSITORY" \
    --target "$GITHUB_SHA" \
    --title 'Mobile Agent existing seq/1 Carrier' \
    --notes 'Immutable non-authority Carrier for the existing seq/1 maxGraph App and protocol-v3 #smap codec.' \
    "${assets[@]}"
fi
mkdir "$RUNNER_TEMP/release-readback"
for asset in "${assets[@]}"; do
  name="$(basename "$asset")"
  gh release download "$tag" --repo "$GITHUB_REPOSITORY" --pattern "$name" --dir "$RUNNER_TEMP/release-readback"
  cmp "$asset" "$RUNNER_TEMP/release-readback/$name"
done

project='stg-mobile-agent'
test -n "$CLOUDFLARE_ACCOUNT_ID"
test -n "$CLOUDFLARE_API_TOKEN"
api="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$project"
code="$(curl -sS -o "$RUNNER_TEMP/project.json" -w '%{http_code}' \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H 'Content-Type: application/json' \
  "$api")"
if [ "$code" = 404 ]; then
  npx --yes wrangler@4.112.0 pages project create "$project" --production-branch proposals
elif [ "$code" = 200 ]; then
  python3 - "$RUNNER_TEMP/project.json" <<'PY'
import json,sys
value=json.load(open(sys.argv[1],encoding='utf-8'))
assert value['success'] is True
assert value['result']['name']=='stg-mobile-agent'
assert value['result']['production_branch']=='proposals'
PY
else
  cat "$RUNNER_TEMP/project.json" >&2
  exit 1
fi

output="$(npx --yes wrangler@4.112.0 pages deploy "$root/carrier/dist" \
  --project-name "$project" \
  --branch proposals \
  --commit-hash "$GITHUB_SHA" \
  --commit-message 'Existing seq/1 immutable Carrier' 2>&1)"
printf '%s\n' "$output"
deployment="$(printf '%s\n' "$output" \
  | grep -Eo 'https://[A-Za-z0-9.-]+\.pages\.dev' \
  | grep -v '^https://stg-mobile-agent\.pages\.dev$' \
  | head -n1 || true)"
test -n "$deployment"
stable='https://stg-mobile-agent.pages.dev/'
immutable="$deployment/"
printf 'stable_base=%s\ndeployment_base=%s\nrelease_tag=%s\n' "$stable" "$immutable" "$tag" >> "$GITHUB_OUTPUT"

verify_app() {
  local name="$1" base="$2" target="$root/${name}-app.html"
  for attempt in $(seq 1 90); do
    if curl --fail-with-body --location --silent --show-error \
      -H 'Cache-Control: no-cache' "${base}app/" -o "$target"; then
      if [ "$(wc -c < "$target")" -eq 2412388 ] && \
         [ "$(sha256sum "$target" | cut -d' ' -f1)" = 3a8db8703aeb78ed2aded4292c554930daf16e6825dd1ccde83fd9bf680408d6 ]; then
        return 0
      fi
    fi
    sleep 2
  done
  return 1
}
verify_app stable "$stable"
verify_app immutable "$immutable"

npm install --ignore-scripts --no-save --no-audit --no-fund playwright-core@1.55.0
chrome="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
test -n "$chrome"
node verification/mobile-agent-seq-ingress-v2/smoke.mjs \
  "$root/compile-receipt.json" "$stable" "$chrome" "$root/stable-proof"
node verification/mobile-agent-seq-ingress-v2/smoke.mjs \
  "$root/compile-receipt.json" "$immutable" "$chrome" "$root/immutable-proof"
"$chrome" --version > "$root/public-chrome-version.txt"
