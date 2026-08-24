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

ISSUE = 279
PREFIX = "MOBILE_AGENT_CARRIER_CHUNK/1"
FIRST_INDEX = 1
LAST_INDEX = 32
COUNT = LAST_INDEX - FIRST_INDEX + 1
BASE64_BYTES = 571_088
BASE64_SHA256 = "63e73cdbbe14a14ac01a013fe92feb5686e392333e696e0b3a850028604fea24"
ARCHIVE_BYTES = 428_316
ARCHIVE_SHA256 = "f0781226a3c302269a0507d3947867f8a5d2ef3a72ad1054454fed18598416ec"
APP_BYTES = 2_412_388
APP_SHA256 = "3a8db8703aeb78ed2aded4292c554930daf16e6825dd1ccde83fd9bf680408d6"
BASE64_RE = re.compile(r"[A-Za-z0-9+/]*={0,2}")
HEADER_RE = re.compile(
    rf"{re.escape(PREFIX)} ([0-9]{{2}})/{LAST_INDEX:02d} sha256=([a-f0-9]{{64}})"
)


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


def parse(body: str) -> tuple[int, str, str] | None:
    normalized = str(body).replace("\r\n", "\n").strip()
    header, separator, payload = normalized.partition("\n")
    match = HEADER_RE.fullmatch(header.strip())
    if not separator or not match:
        return None
    index = int(match.group(1))
    expected_sha = match.group(2)
    if not FIRST_INDEX <= index <= LAST_INDEX:
        raise RuntimeError(f"unexpected Carrier chunk index: {index}")
    encoded = re.sub(r"\s+", "", payload)
    if not encoded or not BASE64_RE.fullmatch(encoded):
        raise RuntimeError(f"non-canonical Carrier chunk: {index:02d}/{LAST_INDEX:02d}")
    observed_sha = sha256(encoded.encode("ascii"))
    if observed_sha != expected_sha:
        raise RuntimeError(
            f"Carrier chunk sha256 mismatch: {index:02d}/{LAST_INDEX:02d}: "
            f"expected={expected_sha} observed={observed_sha} bytes={len(encoded)}"
        )
    return index, encoded, expected_sha


def restore_carrier(repository: str) -> tuple[bytes, dict]:
    owner = repository.split("/", 1)[0]
    chunks: dict[int, str] = {}
    comment_ids: dict[int, int] = {}
    chunk_shas: dict[int, str] = {}
    for page in pages(repository):
        for comment in page:
            if comment.get("user", {}).get("login") != owner:
                continue
            parsed = parse(comment.get("body", ""))
            if parsed is None:
                continue
            index, encoded, chunk_sha = parsed
            previous = chunks.get(index)
            if previous is not None and previous != encoded:
                raise RuntimeError(f"conflicting Carrier chunk: {index:02d}/{LAST_INDEX:02d}")
            chunks[index] = encoded
            chunk_shas[index] = chunk_sha
            comment_ids[index] = int(comment["id"])

    expected = set(range(FIRST_INDEX, LAST_INDEX + 1))
    observed = set(chunks)
    if observed != expected:
        raise RuntimeError(
            "temporary Carrier ingress incomplete: "
            + json.dumps(
                {
                    "expected": sorted(expected),
                    "observed": sorted(observed),
                    "missing": sorted(expected - observed),
                },
                sort_keys=True,
            )
        )

    carrier = "".join(chunks[index] for index in range(FIRST_INDEX, LAST_INDEX + 1)).encode("ascii")
    if len(carrier) != BASE64_BYTES or sha256(carrier) != BASE64_SHA256:
        raise RuntimeError(
            "temporary Carrier identity mismatch: "
            + json.dumps(
                {
                    "bytes": len(carrier),
                    "sha256": sha256(carrier),
                    "chunkBytes": [len(chunks[index]) for index in range(FIRST_INDEX, LAST_INDEX + 1)],
                    "commentIds": [comment_ids[index] for index in range(FIRST_INDEX, LAST_INDEX + 1)],
                },
                sort_keys=True,
            )
        )

    archive = base64.b64decode(carrier, validate=True)
    if len(archive) != ARCHIVE_BYTES or sha256(archive) != ARCHIVE_SHA256:
        raise RuntimeError("minimal App Carrier archive identity mismatch")

    evidence = {
        "schema": "ops.mobileAgentTemporaryCarrierIngress/1",
        "status": "PASS",
        "source": f"{repository}#{ISSUE}",
        "transport": {
            "prefix": PREFIX,
            "chunks": COUNT,
            "commentIds": [comment_ids[index] for index in range(FIRST_INDEX, LAST_INDEX + 1)],
            "chunkSha256": [chunk_shas[index] for index in range(FIRST_INDEX, LAST_INDEX + 1)],
            "carrierBytes": BASE64_BYTES,
            "carrierSha256": BASE64_SHA256,
            "archiveBytes": ARCHIVE_BYTES,
            "archiveSha256": ARCHIVE_SHA256,
        },
        "expectedApp": {"bytes": APP_BYTES, "sha256": APP_SHA256},
    }
    return carrier, evidence


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: restore_app.py OUT_BASE64")
    repository = os.environ.get("GITHUB_REPOSITORY", "roccho-dev/ops")
    carrier, evidence = restore_carrier(repository)
    output = pathlib.Path(sys.argv[1])
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(carrier)
    print(json.dumps(evidence, sort_keys=True))


if __name__ == "__main__":
    main()
