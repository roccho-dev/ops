#!/usr/bin/env python3
from __future__ import annotations

import json
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


def fail(message: str) -> None:
    raise RuntimeError(f"mobile-agent-projection-readback: {message}")


def get(url: str, expected: bytes) -> tuple[bytes, str]:
    last: Exception | None = None
    for attempt in range(1, 11):
        try:
            request = urllib.request.Request(
                url,
                headers={
                    "Accept-Encoding": "identity",
                    "Cache-Control": "no-cache",
                    "User-Agent": "ops-mobile-agent-projection-readback/1",
                },
            )
            with urllib.request.urlopen(request, timeout=90) as response:
                observed = response.read()
                if response.status == 200 and observed == expected:
                    return observed, response.geturl()
                last = RuntimeError(
                    f"HTTP {response.status}; bytes {len(observed)}; expected {len(expected)}"
                )
        except (urllib.error.URLError, TimeoutError) as error:
            last = error
        if attempt < 10:
            time.sleep(min(attempt * 2, 15))
    fail(f"{url}: {last}")


def main(argv: list[str]) -> int:
    if len(argv) != 5:
        fail("usage: readback_projection.py LOCAL_ROOT BASE MANIFEST RECEIPT")
    root = pathlib.Path(argv[1]).resolve()
    base = argv[2].rstrip("/") + "/"
    manifest = json.loads(pathlib.Path(argv[3]).read_text(encoding="utf-8"))
    receipt_path = pathlib.Path(argv[4]).resolve()
    if manifest.get("schema") != "ops.mobileAgentMigratedProjection/1":
        fail("unexpected manifest schema")

    rows: list[dict[str, object]] = []
    for row in manifest["files"]:
        relative = row["path"]
        local = (root / relative).read_bytes()
        url = urllib.parse.urljoin(base, relative)
        observed, observed_url = get(url, local)
        rows.append({
            "path": relative,
            "bytes": len(observed),
            "sha256": row["sha256"],
            "url": observed_url,
        })

    receipt = {
        "schema": "ops.mobileAgentProjectionReadback/1",
        "status": "PASS",
        "authority": False,
        "base": base,
        "distTreeDigest": manifest["distTreeDigest"],
        "fileCount": len(rows),
        "files": rows,
    }
    receipt_path.parent.mkdir(parents=True, exist_ok=True)
    receipt_path.write_text(
        json.dumps(receipt, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "status": "PASS",
        "base": base,
        "fileCount": len(rows),
        "distTreeDigest": manifest["distTreeDigest"],
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
