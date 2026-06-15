#!/usr/bin/env bash
set -euo pipefail
HERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
. "$HERE/_common.sh"
ROOT="$(resolve_root "${1:-}")"
ensure_aliases "$ROOT"
python3 - "$ROOT" <<'PY'
import json, pathlib, sys
root=pathlib.Path(sys.argv[1])
required=[root/'adrs-main/tools/check-feat-readiness.py', root/'governance-records-main/records/feat/build-evidence.v1.jsonl', root/'governance-records-main/records/feat/readiness-decision.v1.jsonl']
missing=[str(p.relative_to(root)) for p in required if not p.exists()]
if missing: raise SystemExit('missing buildable ADR creation proof inputs: '+','.join(missing))
print(json.dumps({'kind':'canonicalCore.buildableAdrCreationProofCi.v1','status':'pass','checked':[str(p.relative_to(root)) for p in required]}, sort_keys=True))
PY
