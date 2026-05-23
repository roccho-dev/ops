"""Command handlers and public helpers for ops-thread-fsm.

The implementation is split into small modules for reliable artifact transfer.
This module is the stable surface used by cli.py and readiness.py.
"""
from __future__ import annotations

import json
import sys
from typing import Any

from .classify import classify_readback_value
from .discussion import check_discussion_value
from .evidence import delivery_manifest_ok, load_value, readable_file
from .plan import evaluate_plan_value
from .state_model import PLAN_ACCEPTED, STATE_KINDS, canonical_state_kind, next_action_for, permissions_for


def emit(value: Any, json_mode: bool, scalar_key: str | None = None) -> None:
    if json_mode:
        print(json.dumps(value, ensure_ascii=False, indent=2))
    elif scalar_key is not None and isinstance(value, dict):
        print(value[scalar_key])
    else:
        print(value)


def cmd_status(args: Any) -> int:
    emit(
        {
            "kind": "ops-thread-fsm.status.v1",
            "states": STATE_KINDS,
            "controllerOnly": True,
            "canonicalAcceptedPlan": PLAN_ACCEPTED,
            "forbiddenMechanics": [
                "CDP",
                "push",
                "refs-vault",
                "artifact materializer",
                "local gate execution",
                "external-thread mechanics",
                "canonical merge",
            ],
        },
        args.json,
    )
    return 0


def cmd_next(args: Any) -> int:
    state = canonical_state_kind(args.state_kind)
    if state not in STATE_KINDS:
        print(f"unknown state-kind: {state}", file=sys.stderr)
        return 2
    emit(
        {
            "kind": "ops-thread-fsm.next.v1",
            "stateKind": state,
            "phase": getattr(args, "phase", None),
            "requestKind": getattr(args, "request_kind", None),
            "classification": canonical_state_kind(getattr(args, "classification", "")) if getattr(args, "classification", None) else None,
            "dryRun": args.dry_run,
            "writes": False,
            "sends": False,
            "permissions": permissions_for(state),
            "nextAction": next_action_for(state),
        },
        args.json,
        "nextAction",
    )
    return 0


def cmd_classify_readback(args: Any) -> int:
    result = classify_readback_value(load_value(args.input), args.phase, args.request_kind)
    emit(result, args.json, "classification")
    if result["classification"] in {"output-candidate", "impl-review-pass", "merge-review-pass"}:
        return 0
    return 1


def cmd_evaluate_plan(args: Any) -> int:
    result = evaluate_plan_value(load_value(args.input))
    emit(result, args.json, "classification")
    if result["classification"] in {PLAN_ACCEPTED, "false-blocker"}:
        return 0
    return 1


def cmd_check_discussion(args: Any) -> int:
    result = check_discussion_value(load_value(args.input))
    emit(result, args.json, "classification")
    if result["classification"] == "discussion-no-objections-confirmed":
        return 0
    return 1


def cmd_render_prompt(args: Any) -> int:
    print(
        "Return materializable full-file artifacts plus RUN_REPORT. "
        "Review gates require first-line impl-review-pass or merge-review-pass only. "
        "Safe auto-continue requires a complete pre-authorized plan with concrete local base, base, upstream, "
        "head, worktree, branch, success/failure condition, gate, and reportable evidence; valid local base evidence; "
        "no merge, no push, no overwrite, branch/worktree absence; and concrete external-thread send confirmation, "
        "readback, and response evidence when external work is used. "
        "readbackDisprovesBlocker can emit false-blocker only with concrete readback evidence. "
        "The canonical accepted-plan token is plan-accepted. "
        "request-sent means sleep 900, then delegated readback via ops-cdp-core. "
        "Target handoff is ready-for-merge-review; final readiness additionally requires merge review. "
        "FSM does not implement CDP, push, refs-vault, artifact materialization, local gates, external-thread mechanics, or canonical merge."
    )
    return 0


def classify(payload: Any | None = None, *, state_kind: object | None = None) -> dict[str, Any]:
    if state_kind is not None:
        state = canonical_state_kind(state_kind)
        return {
            "kind": "ops-thread-fsm.classification.v1",
            "classification": state,
            "stateKind": state,
            "nextStateKind": state,
            "evidence": {"stateKind": state},
            "autoContinue": state == PLAN_ACCEPTED,
            "writes": False,
            "sends": False,
        }
    return evaluate_plan_value(payload or {})


classify_payload = classify
evaluate = classify
evaluate_plan = evaluate_plan_value

__all__ = [
    "cmd_status",
    "cmd_next",
    "cmd_classify_readback",
    "cmd_evaluate_plan",
    "cmd_check_discussion",
    "cmd_render_prompt",
    "classify",
    "classify_payload",
    "evaluate",
    "evaluate_plan",
    "check_discussion_value",
    "classify_readback_value",
    "delivery_manifest_ok",
    "load_value",
    "readable_file",
]
