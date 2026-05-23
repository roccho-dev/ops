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


def _truthy(value: Any) -> bool:
    return value is True or (isinstance(value, str) and value.strip().lower() in {"true", "yes", "ok", "pass", "present"})


def _get_bool(value: dict[str, Any], *keys: str) -> bool:
    for key in keys:
        if key in value:
            return _truthy(value[key])
    return False


def build_localize_report(args: Any) -> dict[str, Any]:
    value = _read(args.input)
    if not isinstance(value, dict):
        value = {}
    evidence = value.get("evidence", {}) if isinstance(value.get("evidence"), dict) else value
    policy_fresh = _get_bool(evidence, "policyFresh", "latestPolicyRead", "policyReadFresh")
    canonical_fresh = _get_bool(evidence, "canonicalNoDrift", "canonicalHeadMatchesReviewBase", "noDrift")
    merge_review_pass = _get_bool(evidence, "mergeReviewPass", "merge-review-pass", "mergeReviewPassReceived")
    local_gate = _get_bool(evidence, "localGatePass", "localGateOk")
    run_report = _get_bool(evidence, "runReportPresent", "runReportReadable") or readable_file(value.get("runReport"))
    project_handoff = _get_bool(evidence, "projectHandoffSent", "projectTransportOk")
    project_review_ready = _get_bool(evidence, "projectReviewReady", "reviewArtifactPresent")
    local_handoff = _get_bool(evidence, "localHandoffReady", "handoffManifestPresent")

    if not policy_fresh:
        state = "stale-policy-claim"
        ready = False
        owner = "claim-writer"
        missing = ["policyFresh"]
    elif not canonical_fresh:
        state = "stale-canonical-head"
        ready = False
        owner = "localizer-or-parentActor"
        missing = ["canonicalNoDrift"]
    elif merge_review_pass and local_gate and run_report:
        state = "localizer-ready"
        ready = True
        owner = "parentActor"
        missing = []
    elif merge_review_pass:
        state = "merge-review-pass-received"
        ready = False
        owner = "localizer-or-parentActor"
        missing = [item for item, ok in (("localGatePass", local_gate), ("runReportPresent", run_report)) if not ok]
    elif project_review_ready:
        state = "project-review-ready"
        ready = False
        owner = "merge-review"
        missing = ["mergeReviewPass"]
    elif project_handoff:
        state = "project-handoff-sent"
        ready = False
        owner = "project-operator"
        missing = ["projectReviewReady", "mergeReviewPass"]
    elif local_handoff:
        state = "local-handoff-ready"
        ready = False
        owner = "impl-review-or-merge-review"
        missing = ["mergeReviewPass"]
    else:
        state = "blocked-transport"
        ready = False
        owner = "ops-cdp-core-or-handoff-owner"
        missing = ["projectHandoffSent or localHandoffReady"]

    return {
        "kind": "ops-thread-fsm.localizeReadiness.v1",
        "ready": ready,
        "stateKind": state,
        "requiredOwner": owner,
        "missing": missing,
        "writes": False,
        "sends": False,
        "checks": {
            "policyFresh": policy_fresh,
            "canonicalNoDrift": canonical_fresh,
            "mergeReviewPass": merge_review_pass,
            "localGatePass": local_gate,
            "runReportPresent": run_report,
            "projectHandoffSent": project_handoff,
            "projectReviewReady": project_review_ready,
            "localHandoffReady": local_handoff,
        },
    }


def cmd_classify_localize(args: Any) -> int:
    report = build_localize_report(args)
    _emit(report, bool(getattr(args, "json", False)))
    return 0 if report["ready"] else 1
