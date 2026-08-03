from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from .canonical import canonical_json
from .core import JsonlInspectError, run_request
from .manifest import MANIFEST


def emit(value: Any, stream: Any = sys.stdout) -> None:
    stream.write(canonical_json(value) + "\n")


def read_request(argument: str | None) -> dict[str, Any]:
    raw = argument if argument is not None else sys.stdin.read()
    if not raw.strip():
        raise JsonlInspectError("missing-request", "run requires a JSON request on stdin or --request")
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise JsonlInspectError("invalid-request-json", f"request is not valid JSON: {exc.msg}") from exc
    if not isinstance(value, dict):
        raise JsonlInspectError("invalid-request", "request must be a JSON object")
    return value


def selftest() -> dict[str, Any]:
    request = {
        "action": "inspect-jsonl",
        "text": '{"id":"a","value":2}\n{"value":1,"id":"a"}\n{"id":"b"}\n',
    }
    first = run_request(request)
    second = run_request(request)
    expected = {
        "rowCount": 3,
        "keys": ["id", "value"],
        "idCount": 3,
        "duplicateIds": ["a"],
    }
    for key, value in expected.items():
        if first.get(key) != value:
            raise AssertionError(f"selftest mismatch for {key}: {first.get(key)!r} != {value!r}")
    if canonical_json(first) != canonical_json(second):
        raise AssertionError("selftest output is not deterministic")
    malformed_blocked = False
    try:
        run_request({"action": "inspect-jsonl", "text": "{broken}\n"})
    except JsonlInspectError as exc:
        malformed_blocked = exc.code == "invalid-json"
    if not malformed_blocked:
        raise AssertionError("malformed JSONL was not rejected")
    return {
        "kind": "jsonlInspect.selftest.v1",
        "ok": True,
        "deterministic": True,
        "malformedInputBlocked": True,
        "rowCount": first["rowCount"],
        "duplicateIds": first["duplicateIds"],
        "generatedIsAuthority": False,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="jsonl-inspect")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("manifest")
    run = sub.add_parser("run")
    run.add_argument("--request")
    sub.add_parser("selftest")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "manifest":
            emit(MANIFEST)
            return 0
        if args.command == "selftest":
            emit(selftest())
            return 0
        if args.command == "run":
            emit(run_request(read_request(args.request)))
            return 0
        raise JsonlInspectError("unsupported-command", f"unsupported command: {args.command}")
    except (JsonlInspectError, AssertionError) as exc:
        if isinstance(exc, JsonlInspectError):
            error = exc.to_dict()
        else:
            error = {"code": "selftest-failed", "message": str(exc)}
        emit(
            {
                "kind": "jsonlInspect.error.v1",
                "ok": False,
                "error": error,
                "generatedIsAuthority": False,
            },
            sys.stderr,
        )
        return 1
