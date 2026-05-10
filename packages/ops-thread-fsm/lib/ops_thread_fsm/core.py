"""Core entry points for the ops thread FSM controller."""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Iterable, Mapping

from .plan import classify_plan, row
from .state_model import PLAN_ACCEPTED, canonical_state_kind, is_success_classification

SUCCESS_CLASSIFICATIONS = (PLAN_ACCEPTED,)
SUCCESS_STATES = SUCCESS_CLASSIFICATIONS


def classification_is_success(value: object) -> bool:
    return is_success_classification(value)


is_success = classification_is_success


def classify(payload: Any | None = None, *, state_kind: object | None = None) -> dict[str, Any]:
    """Classify either an explicit state kind or a plan evidence payload."""

    if state_kind is not None:
        canonical = canonical_state_kind(state_kind)
        return row(
            canonical,
            "state kind supplied by caller",
            {"stateKind": canonical},
            autoContinue=classification_is_success(canonical),
        )
    return classify_plan(payload or {})


classify_payload = classify
evaluate = classify


def _load_payload(text: str) -> Any:
    if not text.strip():
        return {}
    return json.loads(text)


def run(argv: Iterable[str] | None = None, stdin: Any | None = None, stdout: Any | None = None) -> int:
    parser = argparse.ArgumentParser(description="Classify ops-thread FSM evidence")
    parser.add_argument("--state-kind", dest="state_kind", help="state kind to canonicalise")
    parser.add_argument("--pretty", action="store_true", help="pretty-print JSON output")
    parser.add_argument("--input", "-i", dest="input_path", help="read JSON evidence from a file instead of stdin")
    args = parser.parse_args(list(argv) if argv is not None else None)

    if stdout is None:
        stdout = sys.stdout
    if stdin is None:
        stdin = sys.stdin

    if args.state_kind:
        result = classify(state_kind=args.state_kind)
    else:
        if args.input_path:
            with open(args.input_path, "r", encoding="utf-8") as handle:
                payload = _load_payload(handle.read())
        else:
            payload = _load_payload(stdin.read())
        result = classify_plan(payload)

    json.dump(result, stdout, indent=2 if args.pretty else None, sort_keys=True)
    stdout.write("\n")
    return 0 if classification_is_success(result.get("classification")) else 1


def main(argv: Iterable[str] | None = None) -> int:
    return run(argv)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
