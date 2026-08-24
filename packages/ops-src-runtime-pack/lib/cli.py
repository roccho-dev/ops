"""CLI wiring for ops-src-runtime-pack."""

from __future__ import annotations

import argparse
import json

from carrier import carrier_create, carrier_validate
from common import PackError, profile_show
from pack import create, validate


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ops-src-runtime-pack")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("profile-show")
    p.add_argument("--repo-root", default=".")
    p.add_argument("--profile", required=True)
    p.add_argument("--profiles-file")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=profile_show)
    p = sub.add_parser("create")
    p.add_argument("--repo-root", default=".")
    p.add_argument("--repo-id", default="ops")
    p.add_argument("--package-name")
    p.add_argument("--profile")
    p.add_argument("--profiles-file")
    p.add_argument("--installable", action="append", default=[])
    p.add_argument("--source-path", action="append", default=[])
    p.add_argument("--policy-file", action="append", default=[])
    p.add_argument("--out-dir", required=True)
    p.add_argument("--force", action="store_true")
    p.add_argument("--metadata-only", action="store_true", help="skip nix build/copy; for static package checks only")
    p.add_argument("--include-untracked", action="store_true", help="include untracked non-ignored Git files in SRC/source.tar.gz")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=create)
    p = sub.add_parser("validate")
    p.add_argument("--pack-dir", required=True)
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=validate)
    p = sub.add_parser("carrier-create")
    p.add_argument("--pack-dir", required=True)
    p.add_argument("--out-dir", required=True)
    p.add_argument("--force", action="store_true")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=carrier_create)
    p = sub.add_parser("carrier-validate")
    p.add_argument("--carrier-dir", required=True)
    p.add_argument("--extract-dir")
    p.add_argument("--force", action="store_true")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=carrier_validate)
    return parser


def main(argv: list[str]) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        result = args.func(args)
        print(json.dumps(result, indent=2, ensure_ascii=False, sort_keys=True) if args.json else result["status"])
        return 0
    except PackError as exc:
        result = {"ok": False, "status": exc.status, "error": exc.message}
        print(json.dumps(result, indent=2, ensure_ascii=False, sort_keys=True))
        return 1
