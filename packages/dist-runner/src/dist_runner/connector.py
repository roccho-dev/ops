from __future__ import annotations

import base64
from typing import Any

from .artifacts import identity
from .errors import DistRunnerError

CONNECTOR_KEYS = {"content", "encoding", "sha"}


def expected_encoding(executor: str) -> str:
    if executor == "python-zipapp":
        return "base64"
    if executor in {"node-esm", "browser-esm"}:
        return "utf-8"
    raise DistRunnerError("unsupported-executor", f"unsupported executor: {executor}")


def decode_and_verify(entry: dict[str, Any], connector: Any) -> tuple[bytes, dict[str, Any]]:
    if not isinstance(connector, dict):
        raise DistRunnerError("invalid-connector-envelope", "connector response must be an object")
    unknown = sorted(set(connector) - CONNECTOR_KEYS)
    missing = sorted(CONNECTOR_KEYS - set(connector))
    if unknown or missing:
        raise DistRunnerError("invalid-connector-envelope", "connector keys do not match schema", unknown=unknown, missing=missing)
    encoding = connector["encoding"]
    expected = expected_encoding(entry["executor"])
    if encoding != expected:
        raise DistRunnerError("connector-encoding-mismatch", f"expected {expected}, received {encoding}")
    content = connector["content"]
    if not isinstance(content, str):
        raise DistRunnerError("invalid-connector-envelope", "connector content must be text")
    try:
        if encoding == "base64":
            compact = "".join(content.split())
            data = base64.b64decode(compact, validate=True)
        else:
            data = content.encode("utf-8")
    except (ValueError, UnicodeError) as exc:
        raise DistRunnerError("invalid-connector-content", "connector content could not be decoded") from exc
    actual = identity(data)
    sha = connector["sha"]
    if not isinstance(sha, str) or sha != actual["gitBlobSha1"]:
        raise DistRunnerError("computed-blob-mismatch", "connector blob SHA does not match decoded bytes")
    if actual != entry["artifact"]:
        raise DistRunnerError("artifact-identity-mismatch", "connector bytes differ from the selected index entry", actual=actual, expected=entry["artifact"])
    return data, actual
