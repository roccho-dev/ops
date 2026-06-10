"""Thin CLI wrapper for smoke checks and manual catalog inspection."""

from __future__ import annotations

import argparse
import json
import sys

from .catalog import get_default_catalog
from .core import BillingRequest, select_billing_channel, validate_catalog


def _validate(args: argparse.Namespace) -> int:
    result = validate_catalog(get_default_catalog())
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0 if result["ok"] else 1


def _select(args: argparse.Namespace) -> int:
    request = BillingRequest(
        product_id=args.product,
        customer_kind=args.customer_kind,
        amount=args.amount,
        currency=args.currency,
        cadence=args.cadence,
        domestic_card_heavy=args.domestic_card_heavy,
        provider_blocked=tuple(args.block_provider or ()),
        preferred_channel=args.preferred_channel,
    )
    selection = select_billing_channel(get_default_catalog(), request)
    print(json.dumps(selection.to_json(), ensure_ascii=False, sort_keys=True))
    return 0 if selection.ok else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="billing-channel-config")
    sub = parser.add_subparsers(dest="command", required=True)
    validate = sub.add_parser("validate", help="validate the bundled catalog")
    validate.set_defaults(func=_validate)

    select = sub.add_parser("select", help="select a channel for a request")
    select.add_argument("--product", required=True)
    select.add_argument("--customer-kind", default="unknown", choices=["unknown", "individual", "business"])
    select.add_argument("--amount", type=int)
    select.add_argument("--currency", default="JPY")
    select.add_argument("--cadence", default="one_time", choices=["one_time", "recurring", "estimate"])
    select.add_argument("--domestic-card-heavy", action="store_true")
    select.add_argument("--block-provider", action="append")
    select.add_argument("--preferred-channel")
    select.set_defaults(func=_select)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
