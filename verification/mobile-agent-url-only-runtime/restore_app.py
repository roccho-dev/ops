#!/usr/bin/env python3
from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import pathlib
import re
import subprocess
import sys
import tarfile

ISSUE = 286
PREFIX = "SEQ-CARRIER-CHUNK/2"
LAST_INDEX = 10
COUNT = LAST_INDEX + 1
BASE64_BYTES = 571_088
BASE64_SHA256 = "63e73cdbbe14a14ac01a013fe92feb5686e392333e696e0b3a850028604fea24"
ARCHIVE_BYTES = 428_316
ARCHIVE_SHA256 = "f0781226a3c302269a0507d3947867f8a5d2ef3a72ad1054454fed18598416ec"
APP_BYTES = 2_412_388
APP_SHA256 = "3a8db8703aeb78ed2aded4292c554930daf16e6825dd1ccde83fd9bf680408d6"
APP_GIT_BLOB = "ebdb39084fa3cc57b0295818f6f339f62f0fca90"


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
    normalized = str(body).replace("\r\n", "\n")
    head, separator, payload = normalized.partition("\n")
    match = re.fullmatch(
        rf"{re.escape(PREFIX)} ([0-9]{{2}})/{LAST_INDEX:02d}",
        head.strip(),
    )
    if not separator or not match:
        return None
    index = int(match.group(1))
    if not 0 <= index <= LAST_INDEX:
        raise RuntimeError(f"unexpected Carrier chunk index: {index}")
    payload = re.sub(r"\s+", "", payload)
    if not payload or not re.fullmatch(r"[A-Za-z0-9+/=]+", payload):
        raise RuntimeError(f"invalid Carrier payload: {index:02d}/{LAST_INDEX:02d}")
    return index, payload


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
                raise RuntimeError(
                    f"conflicting Carrier chunk: {index:02d}/{LAST_INDEX:02d}"
                )
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
        raise RuntimeError("Carrier Base64 identity mismatch")

    archive = base64.b64decode(encoded, validate=True)
    if len(archive) != ARCHIVE_BYTES or sha256(archive) != ARCHIVE_SHA256:
        raise RuntimeError("Carrier archive identity mismatch")
    return archive


def app_from_carrier(archive: bytes) -> tuple[str, bytes]:
    matches: list[tuple[str, bytes]] = []
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:xz") as source:
        for member in source.getmembers():
            path = pathlib.PurePosixPath(member.name)
            if path.is_absolute() or ".." in path.parts:
                raise RuntimeError(f"unsafe Carrier member path: {member.name}")
            if member.issym() or member.islnk() or member.isdev():
                raise RuntimeError(f"unsafe Carrier member type: {member.name}")
            if not member.isfile():
                continue
            handle = source.extractfile(member)
            if handle is None:
                raise RuntimeError(f"Carrier member unreadable: {member.name}")
            data = handle.read()
            if len(data) == APP_BYTES and sha256(data) == APP_SHA256:
                matches.append((member.name, data))

    if len(matches) != 1:
        raise RuntimeError(
            "Carrier must contain exactly one exact Mobile Agent App: "
            + json.dumps([name for name, _ in matches])
        )
    return matches[0]


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: restore_app.py OUT_HTML")

    repository = os.environ.get("GITHUB_REPOSITORY", "roccho-dev/ops")
    archive = read_carrier(repository)
    source_path, app = app_from_carrier(archive)

    git_blob = hashlib.sha1(f"blob {len(app)}\0".encode() + app).hexdigest()
    if git_blob != APP_GIT_BLOB:
        raise RuntimeError("App Git blob identity mismatch")

    text = app.decode("utf-8", errors="strict")
    for token in ("graph/1", "map/1", "seq/1"):
        if token not in text:
            raise RuntimeError(f"App contract token missing: {token}")
    if "maxgraph" not in text.lower():
        raise RuntimeError("maxGraph token missing")

    output = pathlib.Path(sys.argv[1])
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(app)

    print(
        json.dumps(
            {
                "status": "PASS_TEMPORARY_MOBILE_AGENT_INGRESS",
                "source": "roccho-dev/ops#286",
                "carrier": {
                    "bytes": ARCHIVE_BYTES,
                    "sha256": ARCHIVE_SHA256,
                    "chunks": COUNT,
                },
                "app": {
                    "sourcePath": source_path,
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
