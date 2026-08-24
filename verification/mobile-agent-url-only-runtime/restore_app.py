#!/usr/bin/env python3
from __future__ import annotations

import base64
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import tempfile

PROJECTION_REF = "projection/mobile-agent-preset-dist-b0af2ab9"
PARTS = (
    (
        "projection/mobile-agent-preset-b0af2ab9/app-index.br.b64.part00",
        "f65a8c180f0b65317ff0455712c2ecd5934a7031",
    ),
    (
        "projection/mobile-agent-preset-b0af2ab9/app-index.br.b64.part01",
        "a0904cf208a3a9ac87afa37b8b6dfc4fe13c368f",
    ),
)
CARRIER_BYTES = 30_024
APP_BYTES = 2_412_388
APP_SHA256 = "3a8db8703aeb78ed2aded4292c554930daf16e6825dd1ccde83fd9bf680408d6"
APP_GIT_BLOB = "ebdb39084fa3cc57b0295818f6f339f62f0fca90"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def git_blob_sha(data: bytes) -> str:
    return hashlib.sha1(f"blob {len(data)}\0".encode("ascii") + data).hexdigest()


def fetch_part(repository: str, path: str, expected_blob: str) -> bytes:
    # Deliberately mirror the already-written projection proof workflow:
    # gh api --jq .content | tr -d '\n' | base64 --decode
    api_base64 = subprocess.check_output(
        [
            "gh",
            "api",
            "-X",
            "GET",
            f"repos/{repository}/contents/{path}",
            "-f",
            f"ref={PROJECTION_REF}",
            "--jq",
            ".content",
        ],
        text=True,
    )
    data = base64.b64decode("".join(api_base64.split()), validate=True)
    observed = git_blob_sha(data)
    if observed != expected_blob:
        raise RuntimeError(
            f"projection part Git blob mismatch: {path}: {observed} != {expected_blob}"
        )
    return data


def restore_app(repository: str, output: pathlib.Path) -> dict[str, object]:
    carrier = b"".join(fetch_part(repository, path, blob) for path, blob in PARTS)
    if len(carrier) != CARRIER_BYTES:
        raise RuntimeError(
            f"projection Carrier length mismatch: {len(carrier)} != {CARRIER_BYTES}"
        )
    packed = base64.b64decode(carrier, validate=True)

    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="mobile-agent-projection-") as temp:
        packed_path = pathlib.Path(temp) / "app-index.br"
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
        raise RuntimeError("exact App byte/SHA identity mismatch")
    if git_blob_sha(app) != APP_GIT_BLOB:
        raise RuntimeError("exact App Git blob identity mismatch")

    text = app.decode("utf-8", errors="strict")
    for token in ("graph/1", "map/1", "seq/1", "maxgraph"):
        if token.lower() not in text.lower():
            raise RuntimeError(f"App contract token missing: {token}")

    return {
        "status": "PASS_PERSISTENT_MOBILE_AGENT_GITHUB_PROJECTION",
        "source": {
            "repository": repository,
            "projectionRef": PROJECTION_REF,
            "parts": [
                {"path": path, "gitBlob": blob} for path, blob in PARTS
            ],
            "carrierBytes": len(carrier),
            "carrierSha256": sha256(carrier),
            "packedBytes": len(packed),
            "packedSha256": sha256(packed),
        },
        "app": {
            "bytes": len(app),
            "sha256": APP_SHA256,
            "gitBlob": APP_GIT_BLOB,
        },
    }


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: restore_app.py OUT_HTML")
    repository = os.environ.get("GITHUB_REPOSITORY", "roccho-dev/ops")
    print(json.dumps(restore_app(repository, pathlib.Path(sys.argv[1])), sort_keys=True))


if __name__ == "__main__":
    main()
