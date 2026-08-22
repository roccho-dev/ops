#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import pathlib
import sys
import time
import urllib.request


def fail(message: str) -> None:
    raise RuntimeError(f"mobile-agent-public-readback: {message}")


def fetch(url: str, attempts: int = 12) -> tuple[bytes, str]:
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "mobile-agent-public-readback/1", "Cache-Control": "no-cache"})
            with urllib.request.urlopen(request, timeout=60) as response:
                if response.status != 200:
                    fail(f"HTTP {response.status}: {url}")
                return response.read(), response.geturl()
        except Exception as error:
            last = error
            time.sleep(min(2 + attempt, 10))
    raise RuntimeError(f"mobile-agent-public-readback: fetch failed {url}: {last}")


def main(argv: list[str]) -> None:
    if len(argv) != 4:
        fail("usage: public_readback.py CARRIER_ROOT BASE OUTPUT_JSON")
    root = pathlib.Path(argv[1]).resolve()
    base = argv[2].rstrip("/") + "/"
    output = pathlib.Path(argv[3]).resolve()
    manifest = json.loads((root / "carrier-manifest.json").read_text(encoding="utf-8"))
    rows = []
    for row in manifest["files"]:
        rel = row["path"]
        if not rel.startswith("dist/"):
            continue
        public_rel = rel.removeprefix("dist/")
        local = (root / rel).read_bytes()
        url = base + public_rel
        remote, observed = fetch(url)
        if remote != local:
            fail(f"{public_rel}: byte mismatch")
        if len(remote) != row["bytes"] or "sha256:" + hashlib.sha256(remote).hexdigest() != row["sha256"]:
            fail(f"{public_rel}: identity mismatch")
        rows.append({"path": public_rel, "bytes": len(remote), "sha256": row["sha256"], "url": observed})
    if len(rows) != 40:
        fail(f"public file count {len(rows)}")
    value = {
        "schema": "ops.mobileAgentCarrierPublicReadback/1",
        "status": "PASS",
        "authority": False,
        "base": base,
        "carrierSha256": "sha256:f0781226a3c302269a0507d3947867f8a5d2ef3a72ad1054454fed18598416ec",
        "files": rows,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps({"status": "PASS", "base": base, "files": len(rows)}))


if __name__ == "__main__":
    main(sys.argv)
