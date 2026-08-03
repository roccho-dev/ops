from __future__ import annotations

import json
from collections import Counter
from typing import Any

from .canonical import canonical_json, sha256_text


class JsonlInspectError(ValueError):
    def __init__(self, code: str, message: str, line: int | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.line = line

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.line is not None:
            out["line"] = self.line
        return out


def _reject_constant(value: str) -> None:
    raise ValueError(f"non-standard JSON constant: {value}")


def parse_jsonl(text: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line_number, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            value = json.loads(line, parse_constant=_reject_constant)
        except (json.JSONDecodeError, ValueError) as exc:
            raise JsonlInspectError(
                "invalid-json",
                f"line {line_number} is not valid JSON: {getattr(exc, 'msg', str(exc))}",
                line_number,
            ) from exc
        if not isinstance(value, dict):
            raise JsonlInspectError(
                "non-object-row",
                f"line {line_number} must contain a JSON object",
                line_number,
            )
        rows.append(value)
    return rows


def inspect_jsonl(text: str, id_key: str = "id") -> dict[str, Any]:
    if not isinstance(text, str):
        raise JsonlInspectError("invalid-text", "request.text must be a string")
    if not isinstance(id_key, str) or not id_key:
        raise JsonlInspectError("invalid-id-key", "request.idKey must be a non-empty string")

    rows = parse_jsonl(text)
    keys = sorted({key for row in rows for key in row})
    ids = [row[id_key] for row in rows if id_key in row]
    comparable_ids = [canonical_json(value) for value in ids]
    duplicate_ids = [
        json.loads(value)
        for value in sorted(
            value for value, count in Counter(comparable_ids).items() if count > 1
        )
    ]
    canonical_rows = "\n".join(canonical_json(row) for row in rows)
    if canonical_rows:
        canonical_rows += "\n"

    return {
        "kind": "jsonlInspect.result.v1",
        "ok": True,
        "rowCount": len(rows),
        "keys": keys,
        "idKey": id_key,
        "idCount": len(ids),
        "duplicateIds": duplicate_ids,
        "inputSha256": sha256_text(text),
        "canonicalRowsSha256": sha256_text(canonical_rows),
        "generatedIsAuthority": False,
    }


def run_request(request: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(request, dict):
        raise JsonlInspectError("invalid-request", "request must be a JSON object")
    unknown = sorted(set(request) - {"action", "text", "idKey"})
    if unknown:
        raise JsonlInspectError("unknown-request-keys", f"unknown request keys: {', '.join(unknown)}")
    action = request.get("action")
    if action != "inspect-jsonl":
        raise JsonlInspectError("unsupported-action", "request.action must be inspect-jsonl")
    return inspect_jsonl(request.get("text"), request.get("idKey", "id"))
