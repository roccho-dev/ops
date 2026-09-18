#!/usr/bin/env bash
set -euo pipefail
result="$RUNNER_TEMP/result"
test ! -e "$result"
mkdir -p "$result/dist" "$result/release"
cp -a "$RUNNER_TEMP/dist/." "$result/dist/"
cp verification/mobile-agent-preset-app/manifest.json "$result/manifest.json"
cp verification/mobile-agent-preset-app/expected.json "$result/expected.json"
cp "$RUNNER_TEMP/$ARCHIVE_NAME" "$result/release/$ARCHIVE_NAME"
cp "$RUNNER_TEMP/$CARRIER_NAME" "$result/release/$CARRIER_NAME"
for name in bootstrap-urls.json bootstrap-receipt.json bootstrap-browser-receipt.json; do
  if [ -f "$RUNNER_TEMP/$name" ]; then cp "$RUNNER_TEMP/$name" "$result/$name"; fi
done
