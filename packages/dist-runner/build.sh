#!/bin/sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO="$(CDPATH= cd -- "$ROOT/../.." && pwd)"
OUT="$REPO/dist/dist-runner/dist-runner.pyz"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT HUP INT TERM
cp -R "$ROOT/src/." "$STAGE/"
find "$STAGE" -type d -name __pycache__ -prune -exec rm -rf {} +
find "$STAGE" -type f \( -name '*.pyc' -o -name '*.pyo' \) -delete
find "$STAGE" -type d -exec chmod 0755 {} +
find "$STAGE" -type f -exec chmod 0644 {} +
export TZ=UTC
find "$STAGE" -exec touch -t 198001010000 {} +
mkdir -p "$(dirname -- "$OUT")"
python3 -m zipapp "$STAGE" --output "$OUT" --python "/usr/bin/env python3"
