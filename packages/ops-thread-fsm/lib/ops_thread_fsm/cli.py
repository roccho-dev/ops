"""Command-line interface for ops-thread-fsm."""
from __future__ import annotations

import argparse
import sys
from typing import Callable

from . import core, readiness


def _add_common_json(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--json", action="store_true", help="print JSON output")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ops-thread-fsm")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("status")
    p.add_argument("--events")
    p.add_argument("--state")
    _add_common_json(p)
    p.set_defaults(handler=core.cmd_status)

    p = sub.add_parser("next")
    p.add_argument("--state-kind", required=True)
    p.add_argument("--phase", default="impl")
    p.add_argument("--request-kind", default="work")
    p.add_argument("--classification")
    p.add_argument("--dry-run", action="store_true")
    _add_common_json(p)
    p.set_defaults(handler=core.cmd_next)

    p = sub.add_parser("classify-readback")
    p.add_argument("--input", required=True)
    p.add_argument("--phase", required=True)
    p.add_argument("--request-kind", required=True)
    _add_common_json(p)
    p.set_defaults(handler=core.cmd_classify_readback)

    p = sub.add_parser("evaluate-plan")
    p.add_argument("--input", required=True)
    _add_common_json(p)
    p.set_defaults(handler=core.cmd_evaluate_plan)

    p = sub.add_parser("check-discussion")
    p.add_argument("--input", required=True)
    _add_common_json(p)
    p.set_defaults(handler=core.cmd_check_discussion)

    p = sub.add_parser("render-prompt")
    p.add_argument("--phase", required=True)
    p.add_argument("--request-kind", required=True)
    p.add_argument("--dry-run", action="store_true")
    _add_common_json(p)
    p.set_defaults(handler=core.cmd_render_prompt)

    p = sub.add_parser("check-ready")
    p.add_argument("--delivery")
    p.add_argument("--materialize-manifest")
    p.add_argument("--impl-review")
    p.add_argument("--review")
    p.add_argument("--local-gate")
    p.add_argument("--merge-review")
    p.add_argument("--run-report")
    p.add_argument(
        "--target",
        choices=["ready-for-merge-review", "merge-ready"],
        default="ready-for-merge-review",
    )
    p.add_argument("--dry-run", action="store_true")
    _add_common_json(p)
    p.set_defaults(handler=readiness.cmd_check_ready)

    p = sub.add_parser("classify-localize")
    p.add_argument("--input", required=True)
    _add_common_json(p)
    p.set_defaults(handler=readiness.cmd_classify_localize)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(sys.argv[1:] if argv is None else argv)
    handler: Callable[[argparse.Namespace], int] = args.handler
    return int(handler(args) or 0)


if __name__ == "__main__":
    raise SystemExit(main())
