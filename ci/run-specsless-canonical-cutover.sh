#!/usr/bin/env bash
set -euo pipefail
HERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
. "$HERE/_common.sh"
ROOT="$(resolve_root "${1:-}")"
ensure_aliases "$ROOT"
PYTHONPATH="$ROOT/ops-main/packages/ops-specsless-readiness/src" python3 -m ops_specsless_readiness.specsless_readiness --root "$ROOT" --mode final --json
python3 "$ROOT/repo-boundary-guard-main/tools/specsless_ci.py" --root "$ROOT" --mode final --json
PYTHONPATH="$ROOT/ops-main/packages/package-lib-level-governance/src" python3 -m package_lib_level_governance audit --root "$ROOT" --baseline "$ROOT/governance-records-main/records/specs/package-lib-level-baseline.v1.jsonl" --mode final --json >/dev/null
python3 "$ROOT/governance-records-main/tools/check-migration-coverage.py" --root "$ROOT" --json
python3 "$ROOT/governance-records-main/tools/check-required-command-replay.py" --root "$ROOT" --json
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
json_pass canonicalCore.specslessCutoverCi.v1 specsless-readiness repo-boundary-guard package-lib-level-final migration-coverage required-command-disposition entrypoints
