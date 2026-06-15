#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=/dev/null
. "${SCRIPT_DIR}/_common.sh"
ROOT="$(resolve_root "${1:-}")"
python3 "${ROOT}/governance-records-main/tools/check-required-command-replay.py" --root "${ROOT}" --execute-root-ci --json
