#!/usr/bin/env bash
set -euo pipefail
stage="$RUNNER_TEMP/staged"
cp "$stage/manifest.json" "$RUNNER_TEMP/mobile-agent-preset.manifest.json"
cp "$stage/expected.json" "$RUNNER_TEMP/mobile-agent-preset.expected.json"
assets=(
  "$stage/release/$ARCHIVE_NAME"
  "$stage/release/$CARRIER_NAME"
  "$RUNNER_TEMP/mobile-agent-preset.manifest.json"
  "$RUNNER_TEMP/mobile-agent-preset.expected.json"
  "$stage/bootstrap-receipt.json"
  "$stage/bootstrap-browser-receipt.json"
  "$stage/bootstrap-urls.json"
)
if ! gh release view "$TAG" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
  gh release create "$TAG" --repo "$GITHUB_REPOSITORY" --target "$GITHUB_SHA" --title "Mobile Agent existing preset App" --notes "Immutable non-authority projection of existing graph/1, map/1 and seq/1 maxGraph App." "${assets[@]}"
else
  check="$RUNNER_TEMP/release-check"
  test ! -e "$check"
  mkdir "$check"
  for asset in "${assets[@]}"; do
    name="$(basename "$asset")"
    gh release download "$TAG" --repo "$GITHUB_REPOSITORY" --pattern "$name" --dir "$check"
    cmp "$asset" "$check/$name"
  done
fi
