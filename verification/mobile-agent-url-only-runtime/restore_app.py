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

PART_BLOBS = (
    "f65a8c180f0b65317ff0455712c2ecd5934a7031",
    "a0904cf208a3a9ac87afa37b8b6dfc4fe13c368f",
)
CARRIER_BYTES = 30_024
APP_BYTES = 2_412_388
APP_SHA256 = "3a8db8703aeb78ed2aded4292c554930daf16e6825dd1ccde83fd9bf680408d6"
APP_GIT_BLOB = "ebdb39084fa3cc57b0295818f6f339f62f0fca90"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def git_blob_sha(data: bytes) -> str:
    header = f"blob {len(data)}\0".encode("ascii")
    return hashlib.sha1(header + data).hexdigest()


def read_git_blob(repository: str, blob_sha: str) -> bytes:
    value = json.loads(
        subprocess.check_output(
            ["gh", "api", f"repos/{repository}/git/blobs/{blob_sha}"],
            text=True,
        )
    )
    if value.get("sha") != blob_sha or value.get("encoding") != "base64":
        raise RuntimeError(f"unexpected Git blob response: {blob_sha}")
    encoded = "".join(str(value.get("content", "")).split())
    data = base64.b64decode(encoded, validate=True)
    if git_blob_sha(data) != blob_sha:
        raise RuntimeError(f"Git blob identity mismatch: {blob_sha}")
    return data


def restore_app(repository: str, output: pathlib.Path) -> dict[str, object]:
    parts = [read_git_blob(repository, blob_sha) for blob_sha in PART_BLOBS]
    carrier = b"".join(parts)
    if len(carrier) != CARRIER_BYTES:
        raise RuntimeError(
            f"Carrier length mismatch: expected {CARRIER_BYTES}, observed {len(carrier)}"
        )
    if any(byte > 0x7F for byte in carrier) or any(chr(byte).isspace() for byte in carrier):
        raise RuntimeError("Carrier must be canonical ASCII Base64 without whitespace")
    packed = base64.b64decode(carrier, validate=True)

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
    if git_blob_sha(app) != APP_GIT_BLOB:
        raise RuntimeError("App Git blob identity mismatch")

    text = app.decode("utf-8", errors="strict")
    for token in ("graph/1", "map/1", "seq/1"):
        if token not in text:
            raise RuntimeError(f"App contract token missing: {token}")
    if "maxgraph" not in text.lower():
        raise RuntimeError("maxGraph token missing")

    return {
        "status": "PASS_PERSISTENT_MOBILE_AGENT_GIT_BLOBS",
        "source": {
            "repository": repository,
            "partBlobs": list(PART_BLOBS),
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
    result = restore_app(repository, pathlib.Path(sys.argv[1]))
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
