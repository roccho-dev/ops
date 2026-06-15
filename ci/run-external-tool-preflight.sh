#!/usr/bin/env bash
set -euo pipefail
HERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
. "$HERE/_common.sh"
ROOT="$(resolve_root "${1:-}")"
ensure_aliases "$ROOT"
python3 - "$ROOT" <<'PY'
import json, shutil, sys
required=['nix']
deprecated={'qjs': {'status':'deprecated-decision-needed','decisionRequired':'nodejs-migration-or-delete','requiredForFinal':False,'reason':'QuickJS/qjs dependent implementation surfaces are deprecated and must not block or false-pass final validation.'}}
tools={t:{'present':bool(shutil.which(t)),'path':shutil.which(t)} for t in required}
missing=[t for t,v in tools.items() if not v['present']]
for t in deprecated:
    deprecated[t]['present']=bool(shutil.which(t)); deprecated[t]['path']=shutil.which(t)
status='pass' if not missing else 'external-tool-missing'
print(json.dumps({'kind':'canonicalCore.externalToolPreflight.v1','status':status,'requiredTools':tools,'missing':missing,'deprecatedTools':deprecated,'boundary':'required external tools may be pass/missing; deprecated qjs is decision-needed and never converted to pass'}, sort_keys=True))
raise SystemExit(0 if status=='pass' else 78)
PY
