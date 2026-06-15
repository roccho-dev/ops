#!/usr/bin/env bash
set -euo pipefail
HERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
. "$HERE/_common.sh"
ROOT="$(resolve_root "${1:-}")"
ensure_aliases "$ROOT"
python3 "$ROOT/ops-main/packages/adrs-obligation-compiler/bin/adrs-obligation-compiler.py" self-test --root "$ROOT" --package adrs-feat-build-destructive-readiness-gate
