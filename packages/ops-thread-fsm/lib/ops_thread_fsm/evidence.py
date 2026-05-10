"""Evidence-file helpers for ops-thread-fsm.

This module only inspects files and metadata. It does not materialize artifacts, run
local gates, call CDP, push, merge, or operate external threads.
"""
from __future__ import annotations

import json
import pathlib
import re
from typing import Any


def load_value(path: str | None) -> Any:
    if not path:
        return ""
    raw = pathlib.Path(path).read_text(encoding="utf-8")
    try:
        return json.loads(raw)
    except Exception:
        return raw


def readable_file(path: str | None) -> bool:
    if not path:
        return False
    p = pathlib.Path(path)
    return p.exists() and bool(p.read_text(encoding="utf-8", errors="replace").strip())


def _as_int(value: Any) -> int | None:
    try:
        return int(value)
    except Exception:
        return None


def _hex64(value: Any) -> bool:
    return isinstance(value, str) and re.fullmatch(r"[0-9a-fA-F]{64}", value or "") is not None


def delivery_manifest_ok(path: str | None) -> bool:
    """Validate materializer manifest metadata without materializing anything."""
    if not path or not pathlib.Path(path).exists():
        return False
    manifest = load_value(path)
    if not isinstance(manifest, dict) or manifest.get("ok") is not True:
        return False
    count = _as_int(manifest.get("count"))
    rows = manifest.get("rows")
    if count is None or count <= 0 or not isinstance(rows, list) or len(rows) != count:
        return False
    indexes: list[int] = []
    for row in rows:
        if not isinstance(row, dict) or row.get("ok") is not True:
            return False
        if not isinstance(row.get("path"), str) or not row["path"].strip():
            return False
        byte_count = _as_int(row.get("bytes"))
        expected_bytes = _as_int(row.get("bytesExpected", row.get("sizeExpected")))
        if byte_count is None or expected_bytes is None or byte_count <= 0 or byte_count != expected_bytes:
            return False
        sha = str(row.get("sha256", "")).lower()
        expected_sha = str(row.get("sha256Expected", "")).lower()
        if not (_hex64(sha) and _hex64(expected_sha) and sha == expected_sha):
            return False
        file_index = _as_int(row.get("fileIndex"))
        file_count = _as_int(row.get("fileCount"))
        if file_index is None or file_count != count:
            return False
        indexes.append(file_index)
    return sorted(indexes) == list(range(1, count + 1))
