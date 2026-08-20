#!/usr/bin/env python3
from __future__ import annotations

import base64
import gzip
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

from readback import invariant, validate_root


def main(argv: list[str]) -> int:
    invariant(len(argv) == 8, "expected local_root root_url tree_digest source_sha project proof_path dom_path")
    local_root = Path(argv[1]).resolve()
    root = validate_root(argv[2], argv[5])
    tree_digest = argv[3]
    source_sha = argv[4]
    project = argv[5]
    proof_path = Path(argv[6])
    dom_path = Path(argv[7])

    fixtures = sorted(local_root.glob("capabilities/inspect-json/*/fixtures/pass.json"))
    invariant(len(fixtures) == 1, "inspect-json pass fixture is not unique")
    request = json.loads(fixtures[0].read_text(encoding="utf-8"))["request"]
    canonical = json.dumps(request, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    token = base64.urlsafe_b64encode(gzip.compress(canonical, mtime=0)).decode().rstrip("=")
    invoke_url = f"{root}/index.html#invoke={token}"

    browser = next((value for name in ("google-chrome", "chromium", "chromium-browser") if (value := shutil.which(name))), None)
    invariant(browser is not None, "Chromium browser is unavailable")
    command = [
        browser,
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--run-all-compositor-stages-before-draw",
        "--virtual-time-budget=20000",
        "--dump-dom",
        invoke_url,
    ]
    completed = subprocess.run(command, capture_output=True, text=True, timeout=70)
    invariant(completed.returncode == 0, f"browser failed: {completed.stderr[-4000:]}")
    dom = completed.stdout
    dom_path.write_text(dom, encoding="utf-8")
    invariant('data-state="pass"' in dom, "browser status is not PASS")
    invariant('"status": "PASS"' in dom, "result status is not PASS")
    invariant('"contract": "json-inspection/1"' in dom, "output contract is missing")
    invariant("inspect.json@1" in dom, "selected capability is missing")
    invariant("INCONCLUSIVE" not in dom, "browser produced INCONCLUSIVE")

    proof = {
        "schema": "ops.artifactRuntimePublicBrowserProof/1",
        "status": "PASS",
        "authority": False,
        "opsCommit": source_sha,
        "project": project,
        "treeDigest": tree_digest,
        "rootUrl": root,
        "invokeUrl": invoke_url,
        "requestDigest": f"sha256:{hashlib.sha256(canonical).hexdigest()}",
        "domSha256": f"sha256:{hashlib.sha256(dom.encode()).hexdigest()}",
        "browser": subprocess.check_output([browser, "--version"], text=True).strip(),
        "capability": "inspect.json@1",
        "outputContract": "json-inspection/1",
    }
    proof_path.write_text(json.dumps(proof, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
