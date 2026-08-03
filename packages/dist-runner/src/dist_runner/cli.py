from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from . import MANIFEST
from .canonical import canonical_json, parse_json
from .errors import DistRunnerError
from .index import audit, write_index
from .service import complete_request, resolve_request, run_request


def _emit(value: Any, stream: Any = sys.stdout) -> None:
    stream.write(canonical_json(value) + "\n")


def _request(argument: str | None) -> Any:
    raw = argument if argument is not None else sys.stdin.read()
    if not raw.strip():
        raise DistRunnerError("missing-request", "JSON request is required")
    return parse_json(raw, "request")


def parser() -> argparse.ArgumentParser:
    out = argparse.ArgumentParser(prog="dist-runner")
    sub = out.add_subparsers(dest="command", required=True)
    sub.add_parser("manifest")
    index = sub.add_parser("index")
    index.add_argument("--repo-root", default=".")
    index.add_argument("--write", action="store_true", required=True)
    audit_command = sub.add_parser("audit")
    audit_command.add_argument("--repo-root", default=".")
    for name in ["resolve", "run", "complete"]:
        command = sub.add_parser(name)
        command.add_argument("--request")
    return out


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        if args.command == "manifest":
            _emit(MANIFEST)
        elif args.command == "index":
            _emit(write_index(Path(args.repo_root)))
        elif args.command == "audit":
            _emit(audit(Path(args.repo_root)))
        elif args.command == "resolve":
            _emit(resolve_request(_request(args.request)))
        elif args.command == "run":
            _emit(run_request(_request(args.request)))
        elif args.command == "complete":
            _emit(complete_request(_request(args.request)))
        else:
            raise DistRunnerError("unsupported-command", f"unsupported command: {args.command}")
        return 0
    except (DistRunnerError, OSError, UnicodeError, json.JSONDecodeError) as exc:
        error = exc.to_dict() if isinstance(exc, DistRunnerError) else {"code": "adapter-error", "message": str(exc)}
        _emit({"error": error, "generatedIsAuthority": False, "kind": "ops.distRunner.error.v1", "ok": False}, sys.stderr)
        return 1
