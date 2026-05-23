"""State and permission vocabulary for ops-thread-fsm.

``plan-accepted`` is the canonical accepted-plan token emitted by this package.
The legacy spelling is accepted only as a boundary alias so older callers can
still pass ``--state-kind accepted-plan`` without leaking that token into output.
"""

PLAN_ACCEPTED = "plan-accepted"
ACCEPTED_PLAN = PLAN_ACCEPTED
LEGACY_ACCEPTED_PLAN = "accepted" + "-plan"
FALSE_BLOCKER = "false-blocker"
INSUFFICIENT_PLAN = "insufficient-plan"

STATE_ALIASES = {
    LEGACY_ACCEPTED_PLAN: PLAN_ACCEPTED,
    "accepted_plan": PLAN_ACCEPTED,
    "accepted plan": PLAN_ACCEPTED,
    "plan_accepted": PLAN_ACCEPTED,
    "plan accepted": PLAN_ACCEPTED,
}
STATE_KIND_ALIASES = STATE_ALIASES


def canonical_state_kind(value: object) -> str:
    token = str(value or "").strip()
    normalized = token.lower().replace("_", "-").replace(" ", "-")
    return STATE_ALIASES.get(token, STATE_ALIASES.get(normalized, normalized))


normalize_state_kind = canonical_state_kind
normalise_state_kind = canonical_state_kind
canonicalize_state_kind = canonical_state_kind
canonicalise_state_kind = canonical_state_kind

STATE_KINDS = [
    "init",
    "source-packed",
    "request-sent",
    "sleeping-900",
    "readback",
    "output-materialized",
    "delivery-verified",
    "handoff-created",
    "local-handoff-ready",
    "project-handoff-sent",
    "project-review-ready",
    "impl-review",
    "impl-review-pass",
    "merge-local-gate-pass",
    "merge-review",
    "merge-review-pass",
    "merge-review-pass-received",
    "localizer-ready",
    "blocked-transport",
    "stale-policy-claim",
    "stale-canonical-head",
    "discussion-requested",
    "proposal-revision-present",
    "discussion-objections-present",
    "discussion-response-required",
    "discussion-no-objections-candidate",
    "discussion-no-objections-confirmed",
    "discussion-blocked-needs-parent",
    "planner-targets-ready",
    "merge-request-required",
    "merge-request-sent",
    "merge-send-confirmed",
    "merge-readback",
    "merge-output-materialized",
    "merge-review-request-required",
    "merge-review-request-sent",
    "merge-review-readback",
    "real-blocker",
    FALSE_BLOCKER,
    INSUFFICIENT_PLAN,
    PLAN_ACCEPTED,
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
ALL_STATE_KINDS = STATE_KINDS
VALID_STATE_KINDS = STATE_KINDS
STATES = STATE_KINDS
ALL_STATES = STATE_KINDS
VALID_STATES = STATE_KINDS
SUCCESS_CLASSIFICATIONS = (PLAN_ACCEPTED,)
SUCCESS_STATES = SUCCESS_CLASSIFICATIONS

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
    FALSE_BLOCKER: "correct blocker classification and resume",
    INSUFFICIENT_PLAN: "fail closed; collect missing plan evidence",
    PLAN_ACCEPTED: "evaluate safe auto-continue boundary",
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
    "handoff-created": "non-terminal source handoff; verify worker-readable readback and explicit next owner before work",
    "local-handoff-ready": "local handoff evidence is present; review next required owner before localizer",
    "project-handoff-sent": "Project handoff transport evidence exists; wait for worker readback or review evidence",
    "project-review-ready": "Project review evidence is present but merge-review pass is not yet localizer input",
    "merge-review-pass-received": "merge-review pass received; run no-drift and localizer preflight before localizer-ready",
    "localizer-ready": "merge-review pass plus fresh policy/canonical evidence; localizer may request explicit approval",
    "blocked-transport": "Project/source/artifact transport evidence is missing or failed",
    "stale-policy-claim": "policy snapshot is stale; reread policy and refresh claim",
    "stale-canonical-head": "canonical head drifted; refresh no-drift evidence before localizer",
    "impl-review": "wait for explicit impl-review-pass or impl-review-reject",
    "merge-review": "wait for explicit merge-review-pass or merge-review-reject",
    "discussion-requested": "collect proposal revision and required counterparties",
    "proposal-revision-present": "request same-revision responses from all required counterparties",
    "discussion-objections-present": "synthesize objections into the next proposal revision or escalate",
    "discussion-response-required": "request missing same-revision responses; do not complete discussion",
    "discussion-no-objections-candidate": "verify all required counterparties answered no-objections on the same revision",
    "discussion-no-objections-confirmed": "discussion converged for this revision; not implementation or merge approval",
    "discussion-blocked-needs-parent": "stop discussion loop and ask parent for a decision",
    "planner-targets-ready": "create the required next handoff or escalate missing destination",
    "merge-request-required": "send merge request to the declared merge-work owner",
    "merge-request-sent": "sleep/readback merge-work response; not terminal success",
    "merge-send-confirmed": "wait for merge readback; not terminal success",
    "merge-readback": "classify merge-work readback; not terminal success",
    "merge-output-materialized": "verify merge output and local gates before review",
    "merge-review-request-required": "send candidate to merge-review owner",
    "merge-review-request-sent": "sleep/readback merge-review response; not terminal success",
    "merge-review-readback": "classify merge-review response; only explicit merge-review-pass can advance",
}


def is_known_state_kind(state: object) -> bool:
    return canonical_state_kind(state) in STATE_KINDS


def is_success_classification(value: object) -> bool:
    return canonical_state_kind(value) in SUCCESS_CLASSIFICATIONS


def permissions_for(state: str) -> dict[str, bool]:
    state = canonical_state_kind(state)
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
    return NEXT_ACTIONS.get(canonical_state_kind(state), "fail closed if state transition is unclear")


def result_row(classification: str, next_state: str, evidence=None, retry=False, reason=None, auto=None):
    classification = canonical_state_kind(classification)
    next_state = canonical_state_kind(next_state)
    row = {
        "kind": "ops-thread-fsm.classification.v1",
        "classification": classification,
        "stateKind": classification,
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


State = str
