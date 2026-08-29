#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import time
import urllib.error
import urllib.parse
import urllib.request


def sha256(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"


def get(url: str) -> tuple[bytes, dict[str, str], int]:
    request = urllib.request.Request(
        url,
        headers={"Cache-Control": "no-cache", "User-Agent": "roccho-ops-adrs318-readback"},
        method="GET",
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        return response.read(), {key.lower(): value for key, value in response.headers.items()}, response.status


def fetch_exact(url: str, expected: bytes) -> tuple[bytes, dict[str, str]]:
    last: Exception | None = None
    for _ in range(90):
        try:
            data, headers, status = get(url)
            if status == 200 and data == expected:
                return data, headers
            last = RuntimeError(f"status/bytes mismatch: status={status} bytes={len(data)}")
        except (OSError, urllib.error.URLError, urllib.error.HTTPError) as exc:
            last = exc
        time.sleep(2)
    raise RuntimeError(f"remote readback failed for {url}: {last}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("dist", type=pathlib.Path)
    parser.add_argument("base_url")
    parser.add_argument("receipt", type=pathlib.Path)
    args = parser.parse_args()
    base = args.base_url.rstrip("/") + "/"
    paths = [
        "app.mjs",
        "style.css",
        "current.json",
        "materialize-receipt.json",
        *sorted(path.relative_to(args.dist).as_posix() for path in (args.dist / "data").glob("*.json")),
    ]
    results = []
    root_expected = (args.dist / "index.html").read_bytes()
    root_data, root_headers = fetch_exact(base, root_expected)
    results.append({
        "path": "/",
        "bytes": len(root_data),
        "sha256": sha256(root_data),
        "content_type": root_headers.get("content-type", ""),
    })
    for relative in paths:
        expected = (args.dist / relative).read_bytes()
        url = urllib.parse.urljoin(base, relative)
        data, headers = fetch_exact(url, expected)
        results.append({
            "path": relative,
            "bytes": len(data),
            "sha256": sha256(data),
            "content_type": headers.get("content-type", ""),
            "cache_control": headers.get("cache-control", ""),
        })
    receipt = {
        "schema": "ops.govJsonRuntimePagesReadback/1",
        "status": "PASS",
        "claim_ceiling": "PR_CANDIDATE_GREEN",
        "authority": False,
        "base_url": base,
        "files": results,
        "all_bytes_exact": True,
        "semantic_reduce": False,
        "authenticated_ui": False,
        "provider_e2e": False,
        "authority_changed": False,
        "cutover": False,
    }
    args.receipt.write_text(canonical(receipt), encoding="utf-8")
    print(canonical(receipt), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
