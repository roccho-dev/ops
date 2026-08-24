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
COUNT = 11
EXPECTED_CHUNKS = (
    (50_000, "c0ecc10891b7e5dd4ad3fa2b5cf5b0703c296cb1e329a0ef793a569f5e01762a"),
    (50_000, "863290833dfa6daa435152adfa0cbb3b6464306eb66cbf3db22ae14cbe840909"),
    (50_000, "756ba2ea077166f4a2e6d4d903f137d6b6c5cc7990d91ae2e9e8ba76d40a513c"),
    (50_000, "97ef9f401906ae787210fb8afa41b139123c8381cbfba47d1c6d2f0de85ca80e"),
    (50_000, "2332f6e7fe4789e7582cd890b16527afac4c13762db92fa7e50ec95030962ca5"),
    (50_000, "5fdbcfbafa40de90631e52998f13a6717544ed44a89631aeba49628d065b7755"),
    (50_000, "59825071989604256e1705cd8b97ad7c66b8d1c13be93abceaedb0fd6c085e95"),
    (50_000, "8cf76a6067899818f271a6fbdfd606d7c25fe48578698bb03ad7068ef2bc2b0e"),
    (50_000, "f1d7e6de4aa509aa0e4f6e2c216dd953d3fc4676cf4eedae9fd467c2494a4901"),
    (50_000, "b4f813973bea05816a1bf6ecc4cdc275b3f286ee3eb485626da73c636d780f8c"),
    (9_996, "d4eafde357e6b54765d559618743ad923544d281db575862b183a79a34141c0a"),
)
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


def git_blob_sha(data: bytes) -> str:
    return hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()


def pages(repository: str) -> list[dict[str, object]]:
    raw = json.loads(
        subprocess.check_output(
            [
                "gh",
                "api",
                "--paginate",
                "--slurp",
                f"repos/{repository}/issues/{ISSUE}/comments?per_page=100",
            ],
            text=True,
        )
    )
    if raw and isinstance(raw[0], dict):
        raw = [raw]
    return [comment for page in raw for comment in page]


def read_exact_comment_carrier(repository: str) -> tuple[bytes, dict[str, object]]:
    header = re.compile(rf"^{re.escape(PREFIX)} ([0-9]{{2}})/{COUNT:02d}$")
    matches: dict[int, str] = {}
    diagnostics: dict[int, list[dict[str, object]]] = {index: [] for index in range(COUNT)}

    for comment in pages(repository):
        body = str(comment.get("body", "")).replace("\r\n", "\n").strip()
        first, separator, rest = body.partition("\n")
        if not separator:
            continue
        found = header.fullmatch(first.strip())
        if not found:
            continue
        index = int(found.group(1))
        if not 0 <= index < COUNT:
            continue
        candidate = "".join(character for character in rest if character in BASE64_ALPHABET)
        expected_bytes, expected_sha = EXPECTED_CHUNKS[index]
        observed = {
            "commentId": comment.get("id"),
            "bytes": len(candidate),
            "sha256": sha256(candidate.encode("ascii")),
            "expectedBytes": expected_bytes,
            "expectedSha256": expected_sha,
        }
        diagnostics[index].append(observed)
        if len(candidate) == expected_bytes and observed["sha256"] == expected_sha:
            previous = matches.get(index)
            if previous is not None and previous != candidate:
                raise RuntimeError(f"conflicting exact chunk: {index:02d}/{COUNT:02d}")
            matches[index] = candidate

    missing = [index for index in range(COUNT) if index not in matches]
    if missing:
        print(
            json.dumps(
                {
                    "status": "BLOCKED_EXACT_COMMENT_CHUNKS",
                    "matched": sorted(matches),
                    "missing": missing,
                    "diagnostics": diagnostics,
                },
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        raise RuntimeError(f"exact comment chunks missing: {missing}")

    encoded = "".join(matches[index] for index in range(COUNT)).encode("ascii")
    if len(encoded) != BASE64_BYTES or sha256(encoded) != BASE64_SHA256:
        raise RuntimeError("joined Base64 identity mismatch")
    packed = base64.b64decode(encoded, validate=True)
    if len(packed) != PACKED_BYTES or sha256(packed) != PACKED_SHA256:
        raise RuntimeError("Brotli identity mismatch")
    return packed, {
        "repository": repository,
        "issue": ISSUE,
        "prefix": PREFIX,
        "chunks": COUNT,
        "base64Bytes": len(encoded),
        "base64Sha256": sha256(encoded),
        "packedBytes": len(packed),
        "packedSha256": sha256(packed),
    }


def restore_app(repository: str, output: pathlib.Path) -> dict[str, object]:
    packed, source = read_exact_comment_carrier(repository)
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
        "status": "PASS_EXACT_MOBILE_AGENT_INGRESS",
        "source": source,
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
