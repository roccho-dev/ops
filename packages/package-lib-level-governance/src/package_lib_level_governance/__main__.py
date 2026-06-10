from __future__ import annotations

import argparse
import json
import pathlib
import sys

from .adapter import audit


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="package-lib-level-governance")
    sub = parser.add_subparsers(dest="command", required=True)
    audit_parser = sub.add_parser("audit", help="classify every package contract and compare with the lib-level baseline")
    audit_parser.add_argument("--root", default=".")
    audit_parser.add_argument("--baseline", default=None)
    audit_parser.add_argument("--out-dir", default=None)
    audit_parser.add_argument("--mode", choices=["audit", "admission", "final"], default="admission")
    audit_parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    if args.command == "audit":
        result = audit(
            pathlib.Path(args.root),
            pathlib.Path(args.baseline) if args.baseline else None,
            pathlib.Path(args.out_dir) if args.out_dir else None,
            args.mode,
        )
        text = json.dumps(result, ensure_ascii=False, sort_keys=True)
        print(text if args.json else "package-lib-level-governance:" + text)
        return 0 if result.get("ok") else 1
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
