"""Readback classification for ops-thread-fsm."""
from __future__ import annotations

from typing import Any

from .state_model import next_action_for, permissions_for

OUTPUT_MARKERS = ["BEGIN_B64_FILE", "RUN_REPORT", "MATERIALIZE_MANIFEST", "diff --git", "file tree", "patch"]
DONE_MARKERS = ["できた", "done", "complete", "completed"]
LOCAL_GATE_FAIL = ["local-gate-fail", "local gate fail", "test fail", "tests failed"]
REJECT = ["impl-review-reject", "merge-review-reject", "review-reject", "reject", "差し戻し", "failed"]


def _text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return "\n".join(_text(v) for v in value.values())
    if isinstance(value, list):
        return "\n".join(_text(v) for v in value)
    return "" if value is None else str(value)


def _streaming(value: Any) -> bool:
    if isinstance(value, dict):
        for key, item in value.items():
            if str(key).replace("_", "").lower() == "isstreaming" and item is True:
                return True
            if _streaming(item):
                return True
    if isinstance(value, list):
        return any(_streaming(item) for item in value)
    return False


def _first_line(text: str) -> str:
    for line in text.splitlines():
        line = line.strip()
        if line:
            return line
    return ""


def _contains(text: str, needles: list[str]) -> list[str]:
    lower = text.lower()
    return [needle for needle in needles if needle.lower() in lower]


def _structured_verdict(line: str, token: str) -> bool:
    low = line.casefold()
    token = token.casefold()
    return low in {
        token,
        f"verdict: {token}",
        f"verdict={token}",
        f"status: {token}",
        f"status={token}",
        f"result: {token}",
        f"result={token}",
    }


def _row(classification: str, next_state: str, evidence=None, retry=False, reason=None) -> dict[str, Any]:
    return {
        "kind": "ops-thread-fsm.classification.v1",
        "classification": classification,
        "nextStateKind": next_state,
        "evidence": evidence or [],
        "retry": retry,
        "retryReason": reason,
        "isStreaming": classification == "streaming",
        "permissions": permissions_for(next_state),
        "writes": False,
        "sends": False,
        "nextAction": next_action_for(next_state),
    }


def classify_readback_value(value: Any, phase: str, request_kind: str) -> dict[str, Any]:
    text = _text(value)
    lower = text.lower()
    if _streaming(value):
        return _row("streaming", "sleeping-900", ["isStreaming:true"], True, "readback still streaming")
    gate_fail = _contains(text, LOCAL_GATE_FAIL)
    if gate_fail:
        return _row("local-gate-fail", "request-sent", gate_fail, True, "local gate failed")
    if request_kind in {"impl-review", "merge-review"}:
        pass_token = f"{request_kind}-pass"
        reject_token = f"{request_kind}-reject"
        first = _first_line(text)
        if _structured_verdict(first, reject_token) or _contains(text, REJECT):
            return _row(f"{request_kind}-reject", "request-sent", [first] if first else [], True, "review rejected")
        if _structured_verdict(first, pass_token):
            return _row(pass_token, pass_token, [first])
        evidence = _contains(text, ["review-pass", "pass", "passed", "合格", pass_token])
        return _row(f"{request_kind}-pending", "request-sent", evidence, True, f"missing first-line {pass_token}/{reject_token} verdict")
    evidence = _contains(text, OUTPUT_MARKERS)
    if evidence:
        return _row("output-candidate", "output-materialized", evidence)
    return _row("output-missing", "request-sent", _contains(text, DONE_MARKERS), True, "no materializable output")
