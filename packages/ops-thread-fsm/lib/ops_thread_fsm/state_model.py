"""State and permission vocabulary for ops-thread-fsm."""

STATE_KINDS = [
    "init",
    "source-packed",
    "request-sent",
    "sleeping-900",
    "readback",
    "output-materialized",
    "delivery-verified",
    "impl-review",
    "impl-review-pass",
    "merge-local-gate-pass",
    "merge-review",
    "merge-review-pass",
    "real-blocker",
    "false-blocker",
    "insufficient-plan",
    "accepted-plan",
    "state-requiring-user-gen0-agreement",
    "state-allowed-to-proceed-without-extra-user-agreement",
    "allowed-to-create-worktree",
    "allowed-to-implement",
    "allowed-to-return-artifact",
    "allowed-to-send-review",
    "ready-for-merge-review",
    "merge-ready",
    "escalation-needed",
]

PERMISSION_KEYS = [
    "createWorktree",
    "implement",
    "returnArtifact",
    "sendReview",
    "readyForMergeReview",
    "mergeReady",
    "canonicalMerge",
    "push",
    "overwrite",
]

NEXT_ACTIONS = {
    "request-sent": "sleep 900; then delegated readback via ops-cdp-core",
    "sleeping-900": "perform delegated readback via ops-cdp-core",
    "real-blocker": "stop normal flow; report evidence-backed blocker",
    "false-blocker": "correct blocker classification and resume",
    "insufficient-plan": "fail closed; collect missing plan evidence",
    "accepted-plan": "evaluate safe auto-continue boundary",
    "state-requiring-user-gen0-agreement": "hold for user/gen0 agreement",
    "state-allowed-to-proceed-without-extra-user-agreement": "continue to isolated worktree permission",
    "allowed-to-create-worktree": "create only the requested absent isolated worktree",
    "allowed-to-implement": "implement locally only; no merge/push/overwrite/handoff implied",
    "allowed-to-return-artifact": "return full-file artifact and RUN_REPORT",
    "allowed-to-send-review": "send review handoff with evidence",
    "ready-for-merge-review": "handoff ready for independent merge review; not final merge readiness",
    "merge-ready": "reviewed merge readiness state; FSM still does not merge",
    "escalation-needed": "stop normal flow; human judgment required",
    "output-materialized": "verify delivery manifest and readable RUN_REPORT",
    "delivery-verified": "send impl review when permitted",
    "impl-review": "wait for explicit impl-review-pass or impl-review-reject",
    "merge-review": "wait for explicit merge-review-pass or merge-review-reject",
}

def permissions_for(state: str) -> dict[str, bool]:
    p = {key: False for key in PERMISSION_KEYS}
    if state == "allowed-to-create-worktree":
        p["createWorktree"] = True
    elif state == "allowed-to-implement":
        p["implement"] = True
    elif state == "allowed-to-return-artifact":
        p["returnArtifact"] = True
    elif state == "allowed-to-send-review":
        p["sendReview"] = True
    elif state == "ready-for-merge-review":
        p["readyForMergeReview"] = True
    elif state == "merge-ready":
        p["mergeReady"] = True
    return p

def next_action_for(state: str) -> str:
    return NEXT_ACTIONS.get(state, "fail closed if state transition is unclear")

def result_row(classification: str, next_state: str, evidence=None, retry=False, reason=None, auto=None):
    row = {
        "kind": "ops-thread-fsm.classification.v1",
        "classification": classification,
        "nextStateKind": next_state,
        "evidence": evidence or [],
        "retry": retry,
        "retryReason": reason,
        "permissions": permissions_for(next_state),
        "writes": False,
        "sends": False,
        "nextAction": next_action_for(next_state),
    }
    if auto is not None:
        row["autoContinue"] = auto
    return row
