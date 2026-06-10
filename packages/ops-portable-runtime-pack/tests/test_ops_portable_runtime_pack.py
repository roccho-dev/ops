#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path


def run(cmd: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    proc = subprocess.run(cmd, cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != 0:
        raise AssertionError(f"command failed: {cmd}\nSTDOUT\n{proc.stdout}\nSTDERR\n{proc.stderr}")
    return proc


def main() -> int:
    package_dir = Path(sys.argv[1])
    out_dir = Path(sys.argv[2])
    out_dir.mkdir(parents=True, exist_ok=True)
    tool = out_dir / "fixture-tool"
    tool.write_text("#!/bin/sh\nprintf 'fixture-tool-ok\\n'\n", encoding="utf-8")
    tool.chmod(0o755)
    spec = out_dir / "tool-spec.json"
    spec.write_text(json.dumps({
        "tools": [
            {
                "name": "fixture-tool",
                "source": str(tool),
                "env": {"FIXTURE_RUNTIME_DIR": "$ROOT/share/fixture"},
                "smoke": [],
            }
        ]
    }), encoding="utf-8")
    pack_dir = out_dir / "pack"
    script = package_dir / "bin" / "ops-portable-runtime-pack.py"
    run([sys.executable, str(script), "create", "--target-system", "x86_64-linux", "--tool-spec", str(spec), "--out-dir", str(pack_dir)], package_dir)
    run([sys.executable, str(script), "validate", "--pack-dir", str(pack_dir)], package_dir)
    manifest = json.loads((pack_dir / "MANIFEST.json").read_text(encoding="utf-8"))
    assert manifest["kind"] == "ops.portable-runtime-pack.v1"
    assert manifest["targetSystem"] == "x86_64-linux"
    assert any(row["path"] == "bin/fixture-tool" for row in manifest["files"])
    proc = run(["sh", str(pack_dir / "bin" / "fixture-tool")], pack_dir)
    assert proc.stdout == "fixture-tool-ok\n"
    os.remove(pack_dir / "bin" / "fixture-tool")
    bad = subprocess.run([sys.executable, str(script), "validate", "--pack-dir", str(pack_dir)], cwd=package_dir)
    assert bad.returncode != 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
