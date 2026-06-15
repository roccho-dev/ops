#!/usr/bin/env bash
set -euo pipefail
HERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
. "$HERE/_common.sh"
ROOT="$(resolve_root "${1:-}")"
ensure_aliases "$ROOT"
mkdir -p "$ROOT/.hardening-out"
python3 "$ROOT/adrs-main/tools/check-feat-readiness.py" --root "$ROOT" --json --out "$ROOT/.hardening-out/adrs-feat-readiness.json"
