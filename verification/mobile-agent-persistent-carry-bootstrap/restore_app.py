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
LAST_INDEX = 10
COUNT = 11
BASE64_BYTES = 509_996
BASE64_SHA256 = "a45fda69531262da67ba592fa026007107a1605117228bf149ccec64e8e3bd01"
BROTLI_BYTES = 382_497
BROTLI_SHA256 = "4bf71a4ba919ec06c55b65eae31c350fcd2a0a9b091c116f270b7816491c6c97"
APP_BYTES = 2_412_388
APP_SHA256 = "3a8db8703aeb78ed2aded4292c554930daf16e6825dd1ccde83fd9bf680408d6"
BASE64_ALPHABET = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def pages(repository: str) -> list[list[dict]]:
    raw = subprocess.check_output(
        [
            "gh",
            "api",
            "--paginate",
            "--slurp",
            f"repos/{repository}/issues/{ISSUE}/comments?per_page=100",
        ],
        text=True,
    )
    value = json.loads(raw)
    if value and isinstance(value[0], dict):
        return [value]
    return value


def parse(body: str) -> tuple[int, str] | None:
    normalized = str(body).replace("\r\n", "\n").strip()
    header, separator, payload = normalized.partition("\n")
    match = re.fullmatch(rf"{re.escape(PREFIX)} ([0-9]{{2}})/11", header.strip())
    if not separator or not match:
        return None
    index = int(match.group(1))
    if not 0 <= index <= LAST_INDEX:
        raise RuntimeError(f"unexpected chunk index: {index}")
    encoded = "".join(character for character in payload if character in BASE64_ALPHABET)
    if not encoded:
        raise RuntimeError(f"empty chunk: {index:02d}/11")
    return index, encoded


def restore_brotli(repository: str) -> bytes:
    owner = repository.split("/", 1)[0]
    chunks: dict[int, str] = {}
    comment_ids: dict[int, int] = {}
    for page in pages(repository):
        for comment in page:
            if comment.get("user", {}).get("login") != owner:
                continue
            parsed = parse(comment.get("body", ""))
            if parsed is None:
                continue
            index, encoded = parsed
            # The final digest is authoritative. Last-owner-wins allows an audited
            # replacement without retaining repair logic in normal consumers.
            chunks[index] = encoded
            comment_ids[index] = int(comment["id"])

    expected = set(range(COUNT))
    observed = set(chunks)
    if observed != expected:
        raise RuntimeError(
            "temporary ingress incomplete: "
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
            "temporary ingress identity mismatch: "
            + json.dumps(
                {
                    "bytes": len(encoded),
                    "sha256": sha256(encoded),
                    "chunkBytes": [len(chunks[index]) for index in range(COUNT)],
                    "commentIds": [comment_ids[index] for index in range(COUNT)],
                },
                sort_keys=True,
            )
        )

    compressed = base64.b64decode(encoded, validate=True)
    if len(compressed) != BROTLI_BYTES or sha256(compressed) != BROTLI_SHA256:
        raise RuntimeError("Brotli identity mismatch")
    return compressed


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: restore_app.py OUT_BR")
    repository = os.environ.get("GITHUB_REPOSITORY", "roccho-dev/ops")
    compressed = restore_brotli(repository)
    output = pathlib.Path(sys.argv[1])
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(compressed)
    print(
        json.dumps(
            {
                "schema": "ops.mobileAgentTemporaryIngress/1",
                "status": "PASS",
                "source": f"{repository}#{ISSUE}",
                "transport": {
                    "prefix": PREFIX,
                    "chunks": COUNT,
                    "base64Bytes": BASE64_BYTES,
                    "base64Sha256": BASE64_SHA256,
                    "brotliBytes": BROTLI_BYTES,
                    "brotliSha256": BROTLI_SHA256,
                },
                "expectedApp": {"bytes": APP_BYTES, "sha256": APP_SHA256},
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
