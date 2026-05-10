"""Readiness checks for ops-thread-fsm.

This module only inspects evidence files. It does not run gates, materialize
artifacts, send reviews, push, merge, or perform CDP/external-thread work.
"""
from __future__ import annotations

import json
import pathlib
from typing import Any

from .core import classify_readback_value, delivery_manifest_ok, load_value, readable_file


def _emit(value: dict[str, Any], json_mode: bool, scalar_key: str = "stateKind") -> None:
    if json_mode:
        print(json.dumps(value, ensure_ascii=False, indent=2))
    else:
        print(value[scalar_key])


def _read(path: str | None) -> Any:
    if not path or not pathlib.Path(path).exists():
        return None
    return load_value(path)


def _review_ok(path: str | None, request_kind: str) -> bool:
    value = _read(path)
    if value is None:
        return False
    result = classify_readback_value(
        value,
        phase="merge" if request_kind == "merge-review" else "impl",
        request_kind=request_kind,
    )
    return result.get("classification") == f"{request_kind}-pass"


def _local_gate_ok(path: str | None) -> bool:
    if not path:
        return False
    p = pathlib.Path(path)
    if not p.exists():
        return False
    value = load_value(str(p))
    if isinstance(value, dict) and value.get("ok") is True:
        return True
    raw = p.read_text(encoding="utf-8", errors="replace").lower()
    fail_markers = ["local-gate-fail", "local gate fail", "test fail", "tests failed"]
    pass_markers = ["local-gate-pass", "local gate pass", "tests passed"]
    return any(marker in raw for marker in pass_markers) and not any(marker in raw for marker in fail_markers)


def build_ready_report(args: Any) -> dict[str, Any]:
    delivery_path = args.delivery or args.materialize_manifest
    delivery = delivery_manifest_ok(delivery_path)
    impl_review = _review_ok(args.impl_review or args.review, "impl-review")
    local_gate = _local_gate_ok(args.local_gate)
    run_report = readable_file(args.run_report)
    ready_for_merge_review = delivery and impl_review and local_gate and run_report
    merge_review = _review_ok(args.merge_review, "merge-review")
    merge_ready = ready_for_merge_review and merge_review
    target = args.target or "ready-for-merge-review"
    ready = merge_ready if target == "merge-ready" else ready_for_merge_review
    state = "merge-ready" if target == "merge-ready" and merge_ready else "ready-for-merge-review" if ready_for_merge_review else "not-ready"
    return {
        "kind": "ops-thread-fsm.ready.v1",
        "ready": ready,
        "target": target,
        "stateKind": state,
        "readyForMergeReview": ready_for_merge_review,
        "mergeReady": merge_ready,
        "dryRun": bool(getattr(args, "dry_run", False)),
        "writes": False,
        "sends": False,
        "checks": {
            "delivery": delivery,
            "implReview": impl_review,
            "localGate": local_gate,
            "runReport": run_report,
            "mergeReview": merge_review,
        },
    }


def cmd_check_ready(args: Any) -> int:
    report = build_ready_report(args)
    _emit(report, bool(getattr(args, "json", False)))
    return 0 if report["ready"] else 1
