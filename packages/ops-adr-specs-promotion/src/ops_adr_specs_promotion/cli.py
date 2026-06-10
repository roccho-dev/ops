from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .core import audit_workspace


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog='ops-adr-specs-promotion')
    sub = parser.add_subparsers(dest='command', required=True)
    audit = sub.add_parser('audit')
    audit.add_argument('--workspace', required=True)
    audit.add_argument('--json', action='store_true')
    args = parser.parse_args(argv)
    if args.command == 'audit':
        report = audit_workspace(Path(args.workspace))
        if args.json:
            print(json.dumps(report, sort_keys=True))
        else:
            print(report['classification'])
        return 0 if report['ok'] else 1
    return 2


if __name__ == '__main__':
    raise SystemExit(main())
