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
import zlib

ISSUE = 286
PREFIX = "SEQ-APP-BR/1"
COUNT = 11
DIRECT_COMMENT_IDS = {
    4: 5381568336,
    5: 5381582415,
    6: 5381594577,
    8: 5381733151,
    9: 5381756373,
}
BASE64_BYTES = 509_996
BASE64_SHA256 = "a45fda69531262da67ba592fa026007107a1605117228bf149ccec64e8e3bd01"
BROTLI_BYTES = 382_497
BROTLI_SHA256 = "4bf71a4ba919ec06c55b65eae31c350fcd2a0a9b091c116f270b7816491c6c97"
APP_BYTES = 2_412_388
APP_SHA256 = "3a8db8703aeb78ed2aded4292c554930daf16e6825dd1ccde83fd9bf680408d6"


def gh_json(*args: str):
    return json.loads(subprocess.check_output(["gh", "api", *args], text=True))


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
    repo = os.environ["GITHUB_REPOSITORY"]
    pages = gh_json(f"repos/{repo}/issues/{ISSUE}/comments?per_page=100")
    chunks: dict[int, str] = {}
    for comment in pages:
        parsed = parse(comment.get("body", ""))
        if parsed:
            chunks[parsed[0]] = parsed[1]
    for index, comment_id in DIRECT_COMMENT_IDS.items():
        if index in chunks:
            continue
        comment = gh_json(f"repos/{repo}/issues/comments/{comment_id}")
        parsed = parse(comment.get("body", ""))
        if parsed is None or parsed[0] != index:
            raise RuntimeError(f"direct comment {comment_id} did not contain chunk {index:02d}")
        chunks[index] = parsed[1]
    if sorted(chunks) != list(range(COUNT)):
        raise RuntimeError(f"missing chunks: {sorted(set(range(COUNT)) - set(chunks))}")
    joined = "".join(chunks[index] for index in range(COUNT))
    if len(joined) != BASE64_BYTES or hashlib.sha256(joined.encode()).hexdigest() != BASE64_SHA256:
        raise RuntimeError("joined Base64 identity mismatch")
    compressed = base64.b64decode(joined, validate=True)
    if len(compressed) != BROTLI_BYTES or hashlib.sha256(compressed).hexdigest() != BROTLI_SHA256:
        raise RuntimeError("Brotli identity mismatch")
    html = zlib.decompress(compressed, wbits=0) if False else None
    # Python stdlib does not expose Brotli; delegate only the deterministic decompression step to Node.
    out = pathlib.Path(sys.argv[1])
    out.parent.mkdir(parents=True, exist_ok=True)
    br = out.with_suffix(out.suffix + ".br")
    br.write_bytes(compressed)
    subprocess.run([
        "node", "-e",
        "const fs=require('node:fs'),z=require('node:zlib');fs.writeFileSync(process.argv[2],z.brotliDecompressSync(fs.readFileSync(process.argv[1])));",
        str(br), str(out),
    ], check=True)
    data = out.read_bytes()
    if len(data) != APP_BYTES or hashlib.sha256(data).hexdigest() != APP_SHA256:
        raise RuntimeError("App identity mismatch")
    br.unlink()
    text = data.decode("utf-8", errors="strict")
    for token in ("graph/1", "map/1", "seq/1"):
        if token not in text:
            raise RuntimeError(f"App contract token missing: {token}")
    if "maxgraph" not in text.lower():
        raise RuntimeError("maxGraph token missing")
    print(json.dumps({"status":"PASS","chunks":COUNT,"bytes":len(data),"sha256":APP_SHA256}))


if __name__ == "__main__":
    main()
