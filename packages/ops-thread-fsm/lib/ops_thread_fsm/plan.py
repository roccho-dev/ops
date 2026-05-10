"""Plan classification helpers for ops-thread-fsm.

The controller classifies supplied evidence only.  It does not perform CDP,
pushes, refs-vault operations, artifact materialization, local gate execution,
overwrite handling, or canonical merges.
"""

from .state_model import (
    FALSE_BLOCKER,
    INSUFFICIENT_PLAN,
    PLAN_ACCEPTED,
    next_action_for,
    permissions_for,
)

UNSUPPORTED = ["not sent", "thread not created", "not in project", "cannot connect"]
BOOLEAN_REQUIRED = [
    ("planComplete",),
    ("localBaseEvidenceValid", "localBaseEvidenceValinsPresent"),
    ("successConditionsPresent",),
    ("failureConditionsPresent",),
    ("gatesPresent",),
    ("reportableEvidencePresent",),
    ("worktreeBranchAbsent",),
    ("noMerge",),
    ("noPush",),
    ("noOverwrite",),
]
REQUIRED_CONCRETE = {
    "localBase": ("localBaseEvidence", "localBaseReadbackEvidence", "localBaseContent", "localBase", "localBaseValue", "localBaseSha", "localBaseCommit", "localBaseEvidenceValues", "localBaseEvidenceValins"),
    "base": ("baseEvidence", "baseReadbackEvidence", "baseContent", "base", "baseRef", "baseSha", "baseCommit"),
    "upstream": ("upstreamEvidence", "upstreamReadbackEvidence", "upstreamContent", "upstream", "upstreamRef", "upstreamHead", "upstreamSha", "upstreamCommit"),
    "head": ("headEvidence", "headReadbackEvidence", "headContent", "head", "headSha", "headCommit", "candidateHead", "candidateHeadEvidence"),
    "worktree": ("worktreeEvidence", "worktreeReadbackEvidence", "worktreeContent", "worktree", "worktreePath", "worktreeStatus", "worktreeCleanEvidence"),
    "branch": ("branchEvidence", "branchReadbackEvidence", "branchContent", "branch", "branchName", "candidateBranch", "candidateBranchEvidence"),
    "successConditions": ("successConditionsEvidence", "successConditionEvidence", "successConditionsContent", "successConditions", "successCriteria", "successCriteriaEvidence"),
    "failureConditions": ("failureConditionsEvidence", "failureConditionEvidence", "failureConditionsContent", "failureConditions", "failureCriteria", "failureCriteriaEvidence"),
    "gates": ("gatesEvidence", "gateEvidence", "gatesContent", "gates", "requiredGates", "requiredGatesEvidence", "gateList"),
    "reportableEvidence": ("reportableEvidence", "reportableEvidenceEvidence", "reportableEvidenceContent", "reportEvidence", "responseEvidence", "readbackResponseEvidence", "externalThreadResponseEvidence"),
}
FALSE_BLOCKER_READBACK = (
    "readbackEvidence",
    "readbackContent",
    "readbackProof",
    "readbackTranscript",
    "blockerReadbackEvidence",
    "disprovingReadbackEvidence",
    "disprovingReadbackContent",
    "responseEvidence",
    "readbackResponseEvidence",
)
PLACEHOLDERS = {"", "true", "false", "yes", "no", "ok", "pass", "valid", "present", "1", "0", "provided", "available", "evidence", "none", "null", "missing", "absent"}


def truthy(v):
    return v is True or (isinstance(v, str) and v.strip().lower() in {"true", "yes", "ok", "pass", "valid", "present", "1"})


def concrete(v):
    if v is None or isinstance(v, bool):
        return False
    if isinstance(v, (int, float)):
        return True
    if isinstance(v, str):
        return bool(v.strip()) and v.strip().lower() not in PLACEHOLDERS
    if isinstance(v, dict):
        return any(concrete(x) for x in v.values())
    if isinstance(v, (list, tuple, set, frozenset)):
        return any(concrete(x) for x in v)
    return True


def flag(p, key):
    return isinstance(p, dict) and truthy(p.get(key))


def flag_any(p, keys):
    return any(flag(p, key) for key in keys)


def evidence(p, *keys):
    return any(concrete(p.get(k)) for k in keys) if isinstance(p, dict) else False


def first_evidence(p, keys):
    if not isinstance(p, dict):
        return None, None
    for key in keys:
        value = p.get(key)
        if concrete(value):
            return key, value
    return None, None


def concrete_evidence(p):
    found = {}
    for category, keys in REQUIRED_CONCRETE.items():
        key, value = first_evidence(p, keys)
        if key:
            found[category] = {"field": key, "value": value}
    return found


def missing_concrete(p):
    found = concrete_evidence(p)
    return [category for category in REQUIRED_CONCRETE if category not in found]


def row(kind, state, ev=None, retry=False, reason=None, auto=None, missing=None):
    out = {
        "kind": "ops-thread-fsm.classification.v1",
        "classification": kind,
        "stateKind": kind,
        "nextStateKind": state,
        "evidence": ev if ev is not None else [],
        "retry": retry,
        "retryReason": reason,
        "permissions": permissions_for(state),
        "writes": False,
        "sends": False,
        "nextAction": next_action_for(state),
    }
    if auto is not None:
        out["autoContinue"] = auto
    if missing:
        out["missingEvidence"] = list(missing)
    return out


def destructive(p):
    text = "\n".join(str(p.get(k, "")) for k in ("scope", "requestedActions", "text")).lower()
    out = []
    if p.get("noMerge") is False or flag(p, "mergeRequested") or flag(p, "canonicalMergeRequested") or ("merge" in text and "no merge" not in text):
        out.append("merge-scope")
    if p.get("noPush") is False or flag(p, "pushRequested") or ("push" in text and "no push" not in text):
        out.append("push-scope")
    if p.get("noOverwrite") is False or flag(p, "overwriteRequested") or ("overwrite" in text and "no overwrite" not in text):
        out.append("overwrite-scope")
    return out


def external_requested(p):
    n = p.get("externalThread") if isinstance(p.get("externalThread"), dict) else {}
    keys = ("externalThreadWork", "externalThreadRequired", "externalThreadRequested", "work", "required", "requested")
    return any(flag(x, k) for x in (p, n) for k in keys)


def external_confirmed(p):
    n = p.get("externalThread") if isinstance(p.get("externalThread"), dict) else {}
    send = evidence(p, "sendConfirmationEvidence", "sendConfirmationContent", "externalSendConfirmationEvidence") or evidence(n, "sendConfirmationEvidence", "sentEvidence")
    readback = evidence(p, "readbackEvidence", "readbackContent", "externalReadbackEvidence") or evidence(n, "readbackEvidence", "readback")
    response = evidence(p, "responseEvidence", "responseContent", "externalResponseEvidence") or evidence(n, "responseEvidence", "response")
    return send and readback and response


def evaluate_plan_value(value):
    p = value if isinstance(value, dict) else {"text": str(value or "")}
    claim = str(p.get("blockerClaim", p.get("claim", p.get("blocker", "")))).strip()
    lower = claim.lower()

    bad = destructive(p)
    if bad:
        return row("escalation-needed", "escalation-needed", bad, False, "merge/push/overwrite scope requires human judgment", False)

    if claim and flag(p, "readbackDisprovesBlocker"):
        readback_key, readback_value = first_evidence(p, FALSE_BLOCKER_READBACK)
        if not readback_key:
            return row(
                INSUFFICIENT_PLAN,
                INSUFFICIENT_PLAN,
                {"blockerClaim": claim},
                True,
                "readbackDisprovesBlocker requires concrete readback evidence",
                False,
                ["readbackEvidence"],
            )
        return row(
            FALSE_BLOCKER,
            PLAN_ACCEPTED,
            {
                "blockerClaim": claim,
                "readbackEvidence": {"field": readback_key, "value": readback_value},
            },
            False,
            "readback evidence disproves blocker claim",
            False,
        )

    if claim and flag(p, "blockerEvidence"):
        return row("real-blocker", "real-blocker", [claim], True, "evidence-backed blocker", False)
    if claim and any(token in lower for token in UNSUPPORTED):
        return row(INSUFFICIENT_PLAN, INSUFFICIENT_PLAN, [claim], True, "unsupported blocker claim lacks evidence", False)

    missing = [keys[0] for keys in BOOLEAN_REQUIRED if not flag_any(p, keys)]
    missing.extend(missing_concrete(p))
    if external_requested(p) and not external_confirmed(p):
        missing.append("externalThreadConcreteSendConfirmationReadbackAndResponse")
    if missing:
        return row(INSUFFICIENT_PLAN, INSUFFICIENT_PLAN, concrete_evidence(p) or missing, True, "missing safe-plan evidence", False, missing)

    ev = concrete_evidence(p)
    if not flag(p, "preAuthorized"):
        return row(PLAN_ACCEPTED, "state-requiring-user-gen0-agreement", ev or ["preAuthorized"], False, "safe plan lacks pre-authorization", False)
    return row(PLAN_ACCEPTED, "state-allowed-to-proceed-without-extra-user-agreement", ev, False, None, True)


classify_plan = evaluate_plan_value
evaluate_plan = evaluate_plan_value
classify = evaluate_plan_value
safe_auto_continue_allowed = lambda payload: evaluate_plan_value(payload).get("classification") == PLAN_ACCEPTED and evaluate_plan_value(payload).get("autoContinue") is True
