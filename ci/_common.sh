#!/usr/bin/env bash
set -euo pipefail
resolve_root() {
  if [[ $# -gt 0 && -n "${1:-}" && "$1" != --* ]]; then
    (cd "$1" && pwd -P)
  else
    local here
    here="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
    (cd "$here/../.." && pwd -P)
  fi
}
ensure_aliases() {
  local root="$1"
  python3 "$root/ops/workspace/materialize-aliases.py" --root "$root" >/dev/null
  python3 "$root/ops/workspace/materialize-aliases.py" --root "$root" --check >/dev/null
}
json_pass() {
  python3 - "$@" <<'PY'
import json, sys
print(json.dumps({"kind": sys.argv[1], "status": "pass", "details": sys.argv[2:]}, ensure_ascii=False, sort_keys=True))
PY
}
json_status() {
  python3 - "$@" <<'PY'
import json, sys
kind, status, *details = sys.argv[1:]
print(json.dumps({"kind": kind, "status": status, "details": details}, ensure_ascii=False, sort_keys=True))
PY
}
