"""Filesystem adapter for functional-core governance manifests."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def load_manifest(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError("manifest must be a JSON object")
    return data


def load_declared_core_texts(manifest: dict[str, Any], manifest_path: Path, root: Path | None) -> dict[str, str]:
    base = root if root is not None else manifest_path.parent
    texts: dict[str, str] = {}
    core = manifest.get("core", [])
    if not isinstance(core, list):
        return texts
    for entry in core:
        if not isinstance(entry, dict):
            continue
        rel = entry.get("path")
        if not isinstance(rel, str):
            continue
        target = (base / rel).resolve()
        texts[rel] = target.read_text(encoding="utf-8")
    return texts
