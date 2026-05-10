from .state_model import next_action_for, permissions_for
UNSUPPORTED = ["not sent", "thread not created", "not in project", "cannot connect"]
REQUIRED = "planComplete localBaseEvidenceValid successConditionsPresent failureConditionsPresent gatesPresent reportableEvidencePresent worktreeBranchAbsent noMerge noPush noOverwrite".split()
def truthy(v):
    return v is True or (isinstance(v, str) and v.strip().lower() in {"true", "yes", "ok", "pass", "valid", "present", "1"})
def concrete(v):
    if v is None or isinstance(v, bool) or isinstance(v, (int, float)): return False
    if isinstance(v, str): return bool(v.strip())
    if isinstance(v, dict): return any(concrete(x) for x in v.values())
    if isinstance(v, list): return any(concrete(x) for x in v)
    return False
def flag(p, key): return isinstance(p, dict) and truthy(p.get(key))
def evidence(p, *keys): return any(concrete(p.get(k)) for k in keys) if isinstance(p, dict) else False
def row(kind, state, ev=None, retry=False, reason=None, auto=None):
    out = {
        "kind": "ops-thread-fsm.classification.v1",
        "classification": kind,
        "nextStateKind": state,
        "evidence": ev or [],
        "retry": retry,
        "retryReason": reason,
        "permissions": permissions_for(state),
        "writes": False,
        "sends": False,
        "nextAction": next_action_for(state),
    }
    if auto is not None: out["autoContinue"] = auto
    return out
def destructive(p):
    text = "\n".join(str(p.get(k, "")) for k in ("scope", "requestedActions", "text")).lower()
    out = []
    if p.get("noMerge") is False or flag(p, "mergeRequested") or flag(p, "canonicalMergeRequested") or ("merge" in text and "no merge" not in text): out.append("merge-scope")
    if p.get("noPush") is False or flag(p, "pushRequested") or ("push" in text and "no push" not in text): out.append("push-scope")
    if p.get("noOverwrite") is False or flag(p, "overwriteRequested") or ("overwrite" in text and "no overwrite" not in text): out.append("overwrite-scope")
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
    if claim and flag(p, "readbackDisprovesBlocker"): return row("false-blocker", "accepted-plan", [claim], auto=False)
    if claim and flag(p, "blockerEvidence"): return row("real-blocker", "real-blocker", [claim], True, "evidence-backed blocker", False)
    if claim and any(token in lower for token in UNSUPPORTED): return row("insufficient-plan", "insufficient-plan", [claim], True, "unsupported blocker claim lacks evidence", False)
    bad = destructive(p)
    if bad: return row("escalation-needed", "escalation-needed", bad, False, "merge/push/overwrite scope requires human judgment", False)
    missing = [key for key in REQUIRED if not flag(p, key)]
    if external_requested(p) and not external_confirmed(p): missing.append("externalThreadConcreteSendConfirmationReadbackAndResponse")
    if missing: return row("insufficient-plan", "insufficient-plan", missing, True, "missing safe-plan evidence", False)
    if not flag(p, "preAuthorized"): return row("accepted-plan", "state-requiring-user-gen0-agreement", ["preAuthorized"], False, "safe plan lacks pre-authorization", False)
    return row("accepted-plan", "state-allowed-to-proceed-without-extra-user-agreement", ["complete pre-authorized non-destructive plan"], False, None, True)
