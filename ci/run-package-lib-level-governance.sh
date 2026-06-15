#!/usr/bin/env bash
set -euo pipefail
HERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
. "$HERE/_common.sh"
ROOT="$(resolve_root "${1:-}")"
ensure_aliases "$ROOT"
PYTHONPATH="$ROOT/ops-main/packages/package-lib-level-governance/src" python3 -m package_lib_level_governance audit --root "$ROOT" --baseline "$ROOT/governance-records-main/records/specs/package-lib-level-baseline.v1.jsonl" --mode final --json
