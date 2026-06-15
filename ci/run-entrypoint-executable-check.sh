#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=/dev/null
. "${SCRIPT_DIR}/_common.sh"
ROOT="$(resolve_root "${1:-}")"
python3 - "$ROOT" <<'PY'
import json, pathlib, sys
root=pathlib.Path(sys.argv[1])
missing=[]
for p in sorted((root/'ops-main/packages').glob('*/bin/*')):
    if p.is_file() and not p.stat().st_mode & 0o111:
        missing.append(str(p.relative_to(root)))
if missing:
    raise SystemExit('entrypoint-executable:error:non-executable bin files: '+json.dumps(missing))
print(json.dumps({'status':'pass','checkedBinEntrypoints':len(list((root/'ops-main/packages').glob('*/bin/*'))),'nonExecutable':0}, sort_keys=True))
PY
