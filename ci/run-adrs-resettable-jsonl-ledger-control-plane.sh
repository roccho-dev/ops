#!/usr/bin/env bash
set -euo pipefail
HERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
. "$HERE/_common.sh"
ROOT="$(resolve_root "${1:-}")"
ensure_aliases "$ROOT"
python3 "$ROOT/adrs-main/tools/check-resettable-ledger.py" --root "$ROOT" --json --v2
