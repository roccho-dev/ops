#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("github-approval-evidence.py")
SPEC = importlib.util.spec_from_file_location("github_approval_evidence", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"cannot load {MODULE_PATH}")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def main() -> int:
    if len(sys.argv) >= 2 and sys.argv[1] == "manifest":
        value = {**MODULE.adapter_manifest(), "manifest_digest": MODULE.adapter_manifest_digest()}
        print(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
        return 0
    return int(MODULE.main())


if __name__ == "__main__":
    raise SystemExit(main())
