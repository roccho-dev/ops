from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from .errors import DistRunnerError

EXACT_COMMIT_RE = re.compile(r"^[a-f0-9]{40}$")
REPOSITORY_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")


def validate_exact_commit(value: Any, label: str = "ref") -> str:
    if not isinstance(value, str) or not EXACT_COMMIT_RE.fullmatch(value):
        raise DistRunnerError("mutable-ref-rejected", f"{label} must be an exact 40-hex commit")
    return value


def validate_repository(value: Any, label: str = "repository") -> str:
    if not isinstance(value, str) or not REPOSITORY_RE.fullmatch(value):
        raise DistRunnerError("invalid-repository", f"{label} must be an owner/name repository")
    return value


def canonical_json(value: Any) -> str:
    try:
        return json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )
    except (TypeError, ValueError) as exc:
        raise DistRunnerError("non-json-value", f"value is not canonical JSON: {exc}") from exc


def parse_json(text: str, label: str) -> Any:
    def reject_constant(value: str) -> None:
        raise ValueError(f"non-standard constant {value}")

    def reject_duplicate(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for key, value in pairs:
            if key in out:
                raise ValueError(f"duplicate key {key!r}")
            out[key] = value
        return out

    try:
        return json.loads(
            text,
            parse_constant=reject_constant,
            object_pairs_hook=reject_duplicate,
        )
    except (json.JSONDecodeError, ValueError) as exc:
        raise DistRunnerError("invalid-json", f"{label} is not strict JSON: {exc}") from exc


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_text(text: str) -> str:
    return sha256_bytes(text.encode("utf-8"))


def git_blob_sha1(data: bytes) -> str:
    return hashlib.sha1(f"blob {len(data)}\0".encode("ascii") + data).hexdigest()
