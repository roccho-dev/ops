#!/usr/bin/env python3
from __future__ import annotations

import base64
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys

ISSUE = 286
PREFIX = "SEQ-APP-BR/1"
COUNT = 11
BASE64_BYTES = 509_996
BASE64_SHA256 = "a45fda69531262da67ba592fa026007107a1605117228bf149ccec64e8e3bd01"
BROTLI_BYTES = 382_497
BROTLI_SHA256 = "4bf71a4ba919ec06c55b65eae31c350fcd2a0a9b091c116f270b7816491c6c97"
APP_BYTES = 2_412_388
APP_SHA256 = "3a8db8703aeb78ed2aded4292c554930daf16e6825dd1ccde83fd9bf680408d6"


def gh_pages(endpoint: str):
    pages = json.loads(
        subprocess.check_output(
            ["gh", "api", "--paginate", "--slurp", endpoint],
            text=True,
        )
    )
    if pages and isinstance(pages[0], dict):
        return [pages]
    return pages


def parse(body: str):
    body = str(body).replace("\r\n", "\n")
    head, sep, payload = body.partition("\n")
    match = re.fullmatch(rf"{re.escape(PREFIX)} ([0-9]{{2}})/{COUNT:02d}", head.strip())
    if not sep or not match:
        return None
    payload = re.sub(r"\s+", "", payload)
    if not re.fullmatch(r"[A-Za-z0-9+/=]+", payload):
        return None
    return int(match.group(1)), payload


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: restore_app.py OUT_HTML")

    repository = os.environ.get("GITHUB_REPOSITORY", "roccho-dev/ops")
    chunks: dict[int, str] = {}
    for page in gh_pages(f"repos/{repository}/issues/{ISSUE}/comments?per_page=100"):
        for comment in page:
            parsed = parse(comment.get("body", ""))
            if parsed is None:
                continue
            index, value = parsed
            previous = chunks.get(index)
            if previous is not None and previous != value:
                raise RuntimeError(f"conflicting temporary carry chunk: {index:02d}/{COUNT:02d}")
            chunks[index] = value

    expected = set(range(COUNT))
    observed = set(chunks)
    if observed != expected:
        raise RuntimeError(
            "temporary carry ingress is incomplete: "
            + json.dumps(
                {
                    "expected": sorted(expected),
                    "observed": sorted(observed),
                    "missing": sorted(expected - observed),
                },
                sort_keys=True,
            )
        )

    joined = "".join(chunks[index] for index in range(COUNT))
    if len(joined) != BASE64_BYTES or hashlib.sha256(joined.encode()).hexdigest() != BASE64_SHA256:
        raise RuntimeError("joined Base64 identity mismatch")

    compressed = base64.b64decode(joined, validate=True)
    if len(compressed) != BROTLI_BYTES or hashlib.sha256(compressed).hexdigest() != BROTLI_SHA256:
        raise RuntimeError("Brotli identity mismatch")

    output = pathlib.Path(sys.argv[1])
    output.parent.mkdir(parents=True, exist_ok=True)
    brotli = output.with_suffix(output.suffix + ".br")
    brotli.write_bytes(compressed)
    subprocess.run(
        [
            "node",
            "-e",
            "const fs=require('node:fs'),z=require('node:zlib');"
            "fs.writeFileSync(process.argv[2],z.brotliDecompressSync(fs.readFileSync(process.argv[1])));",
            str(brotli),
            str(output),
        ],
        check=True,
    )
    brotli.unlink()

    app = output.read_bytes()
    if len(app) != APP_BYTES or hashlib.sha256(app).hexdigest() != APP_SHA256:
        raise RuntimeError("App identity mismatch")
    text = app.decode("utf-8", errors="strict")
    for token in ("graph/1", "map/1", "seq/1"):
        if token not in text:
            raise RuntimeError(f"App contract token missing: {token}")
    if "maxgraph" not in text.lower():
        raise RuntimeError("maxGraph token missing")

    print(
        json.dumps(
            {
                "status": "PASS_TEMPORARY_MOBILE_AGENT_INGRESS",
                "source": "roccho-dev/ops#286",
                "chunks": COUNT,
                "bytes": len(app),
                "sha256": APP_SHA256,
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
