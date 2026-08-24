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
import tempfile

ISSUE = 286
PREFIX = "SEQ-APP-BR/1"
LAST_INDEX = 10
COUNT = LAST_INDEX + 1
BASE64_BYTES = 509_996
BASE64_SHA256 = "a45fda69531262da67ba592fa026007107a1605117228bf149ccec64e8e3bd01"
PACKED_BYTES = 382_497
PACKED_SHA256 = "4bf71a4ba919ec06c55b65eae31c350fcd2a0a9b091c116f270b7816491c6c97"
APP_BYTES = 2_412_388
APP_SHA256 = "3a8db8703aeb78ed2aded4292c554930daf16e6825dd1ccde83fd9bf680408d6"
APP_GIT_BLOB = "ebdb39084fa3cc57b0295818f6f339f62f0fca90"
BASE64_ALPHABET = frozenset(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="
)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


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
    normalized = str(body).replace("\r\n", "\n").strip()
    head, separator, payload = normalized.partition("\n")
    match = re.fullmatch(
        rf"{re.escape(PREFIX)} ([0-9]{{2}})/{COUNT:02d}",
        head.strip(),
    )
    if not separator or not match:
        return None
    index = int(match.group(1))
    if not 0 <= index <= LAST_INDEX:
        raise RuntimeError(f"unexpected Carrier chunk index: {index}")

    # GitHub may wrap long comment payloads. Keep only canonical Base64
    # characters, then close exactness with whole-carrier length and SHA gates.
    encoded = "".join(character for character in payload if character in BASE64_ALPHABET)
    if not encoded:
        raise RuntimeError(f"Carrier payload missing: {index:02d}/{COUNT:02d}")
    return index, encoded


def read_carrier(repository: str) -> bytes:
    chunks: dict[int, str] = {}
    for page in gh_pages(f"repos/{repository}/issues/{ISSUE}/comments?per_page=100"):
        for comment in page:
            parsed = parse(comment.get("body", ""))
            if parsed is None:
                continue
            index, value = parsed
            previous = chunks.get(index)
            if previous is not None and previous != value:
                raise RuntimeError(f"conflicting Carrier chunk: {index:02d}/{COUNT:02d}")
            chunks[index] = value

    expected = set(range(COUNT))
    observed = set(chunks)
    if observed != expected:
        raise RuntimeError(
            "temporary Carrier ingress is incomplete: "
            + json.dumps(
                {
                    "expected": sorted(expected),
                    "observed": sorted(observed),
                    "missing": sorted(expected - observed),
                },
                sort_keys=True,
            )
        )

    encoded = "".join(chunks[index] for index in range(COUNT)).encode("ascii")
    if len(encoded) != BASE64_BYTES or sha256(encoded) != BASE64_SHA256:
        raise RuntimeError(
            "Carrier Base64 identity mismatch: "
            + json.dumps(
                {
                    "observedBytes": len(encoded),
                    "observedSha256": sha256(encoded),
                    "chunkBytes": [len(chunks[index]) for index in range(COUNT)],
                },
                sort_keys=True,
            )
        )

    packed = base64.b64decode(encoded, validate=True)
    if len(packed) != PACKED_BYTES or sha256(packed) != PACKED_SHA256:
        raise RuntimeError("Carrier Brotli identity mismatch")
    return packed


def restore_app(packed: bytes, output: pathlib.Path) -> bytes:
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="mobile-agent-carry-") as temp:
        packed_path = pathlib.Path(temp) / "app.br"
        packed_path.write_bytes(packed)
        subprocess.run(
            [
                "node",
                "-e",
                (
                    "const fs=require('node:fs'),zlib=require('node:zlib');"
                    "fs.writeFileSync(process.argv[2],"
                    "zlib.brotliDecompressSync(fs.readFileSync(process.argv[1])));"
                ),
                str(packed_path),
                str(output),
            ],
            check=True,
        )

    app = output.read_bytes()
    if len(app) != APP_BYTES or sha256(app) != APP_SHA256:
        raise RuntimeError("App identity mismatch")
    git_blob = hashlib.sha1(f"blob {len(app)}\0".encode() + app).hexdigest()
    if git_blob != APP_GIT_BLOB:
        raise RuntimeError("App Git blob identity mismatch")

    text = app.decode("utf-8", errors="strict")
    for token in ("graph/1", "map/1", "seq/1"):
        if token not in text:
            raise RuntimeError(f"App contract token missing: {token}")
    if "maxgraph" not in text.lower():
        raise RuntimeError("maxGraph token missing")
    return app


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: restore_app.py OUT_HTML")

    repository = os.environ.get("GITHUB_REPOSITORY", "roccho-dev/ops")
    output = pathlib.Path(sys.argv[1])
    packed = read_carrier(repository)
    app = restore_app(packed, output)

    print(
        json.dumps(
            {
                "status": "PASS_TEMPORARY_MOBILE_AGENT_INGRESS",
                "source": "roccho-dev/ops#286:SEQ-APP-BR/1",
                "carrier": {
                    "codec": "brotli+standard-base64",
                    "packedBytes": PACKED_BYTES,
                    "packedSha256": PACKED_SHA256,
                    "base64Bytes": BASE64_BYTES,
                    "base64Sha256": BASE64_SHA256,
                    "chunks": COUNT,
                },
                "app": {
                    "bytes": len(app),
                    "sha256": APP_SHA256,
                    "gitBlob": APP_GIT_BLOB,
                },
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
