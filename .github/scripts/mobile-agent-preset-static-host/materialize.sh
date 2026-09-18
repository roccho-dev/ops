#!/usr/bin/env bash
set -euo pipefail
root=verification/mobile-agent-preset-app
dist="$RUNNER_TEMP/dist"
archive="$RUNNER_TEMP/$ARCHIVE_NAME"
carrier="$RUNNER_TEMP/$CARRIER_NAME"
test ! -e "$dist"
if [ "$GITHUB_EVENT_NAME" = issue_comment ]; then
  mkdir "$dist"
  gh release download "$TAG" --repo "$GITHUB_REPOSITORY" --pattern "$ARCHIVE_NAME" --pattern "$CARRIER_NAME" --dir "$RUNNER_TEMP"
  test "$(wc -c < "$archive")" -eq "$ARCHIVE_BYTES"
  test "$(sha256sum "$archive" | cut -d' ' -f1)" = "$ARCHIVE_SHA"
  test "$(wc -c < "$carrier")" -eq "$CARRIER_BYTES"
  test "$(sha256sum "$carrier" | cut -d' ' -f1)" = "$CARRIER_SHA"
  base64 --decode "$carrier" | cmp - "$archive"
  tar -xzf "$archive" -C "$dist"
else
  python3 "$root/bootstrap.py" "$root/expected.json" "$BOOTSTRAP_BASE" "$dist" "$RUNNER_TEMP/bootstrap-receipt.json"
  (cd "$dist" && tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner --mode='u=rwX,go=rX,go-s' -cf - .) | gzip -n > "$archive"
  test "$(wc -c < "$archive")" -eq "$ARCHIVE_BYTES"
  test "$(sha256sum "$archive" | cut -d' ' -f1)" = "$ARCHIVE_SHA"
  base64 -w0 "$archive" > "$carrier"
  test "$(wc -c < "$carrier")" -eq "$CARRIER_BYTES"
  test "$(sha256sum "$carrier" | cut -d' ' -f1)" = "$CARRIER_SHA"
fi
python3 .github/scripts/mobile-agent-preset-static-host/verify_dist.py "$dist" "$root/expected.json"
node "$root/generate-urls.mjs" "$dist" "$root/manifest.json" "$BOOTSTRAP_BASE" "$RUNNER_TEMP/bootstrap-urls.json"
