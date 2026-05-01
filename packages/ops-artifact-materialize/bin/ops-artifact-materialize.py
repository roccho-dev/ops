#!/usr/bin/env python3
"""Materialize BEGIN_B64_FILE blocks from ChatGPT thread text.

This is intentionally small: it decodes machine artifacts, verifies bytes and
sha256, and writes a manifest. Human notes remain outside this contract.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import pathlib
import re
import sys
from typing import Any


BLOCK_RE = re.compile(r"BEGIN_B64_FILE\s+(.*?)\s+END_B64_FILE", re.DOTALL)
META_RE = re.compile(
    r"path:\s*(?P<path>\S+)\s+"
    r"bytes:\s*(?P<bytes>\d+)\s+"
    r"sha256:\s*(?P<sha256>[a-fA-F0-9]{64})\s+"
    r"encoding:\s*(?P<encoding>\S+)"
    r"(?:\s+baseRev:\s*(?P<baseRev>\S+))?"
    r"(?:\s+sourceSeed:\s*(?P<sourceSeed>\S+))?"
    r"(?:\s+fileIndex:\s*(?P<fileIndex>\d+))?"
    r"(?:\s+fileCount:\s*(?P<fileCount>\d+))?",
    re.DOTALL,
)


def fail(message: str) -> None:
    print(f"ops-artifact-materialize: error: {message}", file=sys.stderr)
    raise SystemExit(1)


def read_input_text(path: pathlib.Path) -> str:
    raw = path.read_text(encoding="utf-8")
    try:
        doc = json.loads(raw)
    except json.JSONDecodeError:
        return raw

    previews: list[str] = []
    if isinstance(doc, dict):
        for key in ("last", "messages", "turns"):
            value = doc.get(key)
            if isinstance(value, list):
                for item in value:
                    if not isinstance(item, dict):
                        continue
                    if item.get("role") not in (None, "assistant"):
                        continue
                    preview = item.get("preview") or item.get("text") or item.get("content")
                    if isinstance(preview, str):
                        previews.append(preview)
    return "\n\n".join(previews) if previews else raw


def safe_output_path(out_dir: pathlib.Path, rel_path: str) -> pathlib.Path:
    if "\0" in rel_path:
        fail(f"unsafe output path contains NUL: {rel_path!r}")
    rel = pathlib.PurePosixPath(rel_path)
    if rel.is_absolute() or any(part == ".." for part in rel.parts):
        fail(f"unsafe output path: {rel_path}")
    return out_dir.joinpath(*rel.parts)


def parse_block(block: str) -> tuple[dict[str, Any], str]:
    payload_marker = "payload:"
    idx = block.find(payload_marker)
    if idx < 0:
        fail("BEGIN_B64_FILE block has no payload")
    meta_text = block[:idx].strip()
    payload = re.sub(r"\s+", "", block[idx + len(payload_marker) :].strip())
    match = META_RE.search(meta_text)
    if not match:
        fail(f"cannot parse BEGIN_B64_FILE metadata: {meta_text}")
    meta = match.groupdict()
    meta["bytes"] = int(meta["bytes"] or "0")
    meta["sha256"] = str(meta["sha256"]).lower()
    meta["fileIndex"] = int(meta["fileIndex"]) if meta.get("fileIndex") else None
    meta["fileCount"] = int(meta["fileCount"]) if meta.get("fileCount") else None
    return meta, payload


def materialize(input_path: pathlib.Path, out_dir: pathlib.Path, strict_count: bool) -> dict[str, Any]:
    text = read_input_text(input_path)
    out_dir.mkdir(parents=True, exist_ok=True)
    rows: list[dict[str, Any]] = []

    for match in BLOCK_RE.finditer(text):
        meta, payload = parse_block(match.group(1).strip())
        if meta["encoding"] != "base64":
            fail(f"unsupported encoding for {meta['path']}: {meta['encoding']}")
        try:
            data = base64.b64decode(payload, validate=True)
        except Exception as exc:  # noqa: BLE001 - user-facing CLI
            fail(f"invalid base64 for {meta['path']}: {exc}")

        actual_sha = hashlib.sha256(data).hexdigest()
        out_path = safe_output_path(out_dir, meta["path"])
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(data)
        ok = len(data) == meta["bytes"] and actual_sha == meta["sha256"]
        rows.append(
            {
                "path": meta["path"],
                "outPath": str(out_path),
                "bytes": len(data),
                "bytesExpected": meta["bytes"],
                "sha256": actual_sha,
                "sha256Expected": meta["sha256"],
                "ok": ok,
                "baseRev": meta.get("baseRev"),
                "sourceSeed": meta.get("sourceSeed"),
                "fileIndex": meta.get("fileIndex"),
                "fileCount": meta.get("fileCount"),
            }
        )

    if not rows:
        fail("no BEGIN_B64_FILE blocks found")

    if strict_count:
        declared = {row["fileCount"] for row in rows if row.get("fileCount") is not None}
        if len(declared) != 1 or next(iter(declared)) != len(rows):
            fail(f"fileCount mismatch: declared={sorted(declared)} actual={len(rows)}")
        indexes = sorted(row["fileIndex"] for row in rows if row.get("fileIndex") is not None)
        if indexes != list(range(1, len(rows) + 1)):
            fail(f"fileIndex mismatch: {indexes}")

    failed = [row for row in rows if not row["ok"]]
    manifest = {
        "kind": "ops.artifactMaterialize.manifest.v1",
        "inputPath": str(input_path),
        "outDir": str(out_dir),
        "count": len(rows),
        "ok": not failed,
        "rows": rows,
    }
    (out_dir / "MATERIALIZE_MANIFEST.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    if failed:
        raise SystemExit(1)
    return manifest


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="raw thread text or read-thread JSON")
    parser.add_argument("--out-dir", required=True, help="directory where files are restored")
    parser.add_argument("--strict-count", action="store_true", help="require fileIndex/fileCount to be complete")
    parser.add_argument("--json", action="store_true", help="print full manifest")
    args = parser.parse_args(argv)

    manifest = materialize(pathlib.Path(args.input), pathlib.Path(args.out_dir), args.strict_count)
    if args.json:
        print(json.dumps(manifest, indent=2))
    else:
        print(
            json.dumps(
                {
                    "ok": manifest["ok"],
                    "count": manifest["count"],
                    "manifest": str(pathlib.Path(args.out_dir) / "MATERIALIZE_MANIFEST.json"),
                },
                indent=2,
            )
        )
    return 0 if manifest["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
