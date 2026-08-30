#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import time
import urllib.error
import urllib.request


def canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"


def sha256(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def request(url: str, accept: str, method: str = "GET") -> tuple[int, bytes, dict[str, str]]:
    req = urllib.request.Request(
        url,
        method=method,
        headers={
            "Accept": accept,
            "Cache-Control": "no-cache",
            "User-Agent": "roccho-ops-selected-universe-readback/1",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return response.status, response.read(), {key.lower(): value for key, value in response.headers.items()}
    except urllib.error.HTTPError as error:
        return error.code, error.read(), {key.lower(): value for key, value in error.headers.items()}


def fetch_exact(url: str, accept: str, expected: bytes) -> tuple[bytes, dict[str, str]]:
    last: object = None
    for _ in range(90):
        try:
            status, body, headers = request(url, accept)
            if status == 200 and body == expected:
                return body, headers
            last = {"status": status, "bytes": len(body), "sha256": sha256(body)}
        except OSError as error:
            last = repr(error)
        time.sleep(2)
    raise RuntimeError(f"exact readback failed: {last}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("dist", type=pathlib.Path)
    parser.add_argument("url")
    parser.add_argument("receipt", type=pathlib.Path)
    args = parser.parse_args()
    url = args.url.rstrip("/") + "/"

    html_expected = (args.dist / "index.html").read_bytes()
    meaning_expected = (args.dist / "selected-universe.jsonl").read_bytes()
    html, html_headers = fetch_exact(url, "text/html", html_expected)
    meaning, meaning_headers = fetch_exact(url, "application/x-ndjson", meaning_expected)

    head_status, head_body, head_headers = request(url, "application/x-ndjson", "HEAD")
    assert head_status == 200 and head_body == b""
    assert head_headers.get("x-gov-release-digest") == sha256(meaning_expected)
    assert head_headers.get("vary") == "Accept"

    query_status, _, _ = request(url + "?repo=evil", "text/html")
    missing_status, _, _ = request(url + "missing", "text/html")
    post_status, _, _ = request(url, "text/html", "POST")
    assert query_status == 400
    assert missing_status == 404
    assert post_status == 405

    receipt = {
        "schema": "ops.selectedUniverseSemanticMapReadback/1",
        "status": "PASS",
        "claim_ceiling": "VISUAL_EVALUATION_ONLY",
        "authority": False,
        "url": url,
        "html": {
            "bytes": len(html),
            "sha256": sha256(html),
            "content_type": html_headers.get("content-type", ""),
            "vary": html_headers.get("vary", ""),
            "purpose": "visual-evaluation-only",
        },
        "meaning": {
            "bytes": len(meaning),
            "sha256": sha256(meaning),
            "content_type": meaning_headers.get("content-type", ""),
            "vary": meaning_headers.get("vary", ""),
        },
        "head_metadata_match": True,
        "query_status": query_status,
        "missing_status": missing_status,
        "post_status": post_status,
        "production_cutover": False,
    }
    args.receipt.write_text(canonical(receipt), encoding="utf-8")
    print(canonical(receipt), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
