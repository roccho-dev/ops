"""Plan classification helpers for the ops thread FSM controller."""

from __future__ import annotations

from dataclasses import asdict, is_dataclass
from typing import Any, Iterable, Mapping, MutableMapping, Sequence

from .state_model import FALSE_BLOCKER, INSUFFICIENT_PLAN, PLAN_ACCEPTED, canonical_state_kind

JsonMap = dict[str, Any]

_REQUIRED_CONCRETE_EVIDENCE: dict[str, tuple[str, ...]] = {
    "localBase": (
        "localBaseEvidence",
        "localBaseReadbackEvidence",
        "localBaseContent",
        "localBase",
        "localBaseValue",
        "localBaseSha",
        "localBaseCommit",
        "localBaseEvidenceValues",
        "localBaseEvidenceValins",
    ),
    "base": (
        "baseEvidence",
        "baseReadbackEvidence",
        "baseContent",
        "base",
        "baseRef",
        "baseSha",
        "baseCommit",
    ),
    "upstream": (
        "upstreamEvidence",
        "upstreamReadbackEvidence",
        "upstreamContent",
        "upstream",
        "upstreamRef",
        "upstreamHead",
        "upstreamSha",
        "upstreamCommit",
    ),
    "head": (
        "headEvidence",
        "headReadbackEvidence",
        "headContent",
        "head",
        "headSha",
        "headCommit",
        "candidateHead",
        "candidateHeadEvidence",
    ),
    "worktree": (
        "worktreeEvidence",
        "worktreeReadbackEvidence",
        "worktreeContent",
        "worktree",
        "worktreePath",
        "worktreeStatus",
        "worktreeCleanEvidence",
    ),
    "branch": (
        "branchEvidence",
        "branchReadbackEvidence",
        "branchContent",
        "branch",
        "branchName",
        "candidateBranch",
        "candidateBranchEvidence",
    ),
    "successConditions": (
        "successConditionsEvidence",
        "successConditionEvidence",
        "successConditionsContent",
        "successConditions",
        "successCriteria",
        "successCriteriaEvidence",
    ),
    "failureConditions": (
        "failureConditionsEvidence",
        "failureConditionEvidence",
        "failureConditionsContent",
        "failureConditions",
        "failureCriteria",
        "failureCriteriaEvidence",
    ),
    "gates": (
        "gatesEvidence",
        "gateEvidence",
        "gatesContent",
        "gates",
        "requiredGates",
        "requiredGatesEvidence",
        "gateList",
    ),
    "reportableEvidence": (
        "reportableEvidence",
        "reportableEvidenceEvidence",
        "reportableEvidenceContent",
        "reportEvidence",
        "responseEvidence",
        "readbackResponseEvidence",
        "externalThreadResponseEvidence",
    ),
}

_FALSE_BLOCKER_READBACK_FIELDS = (
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

_BLOCKER_CLAIM_FIELDS = (
    "blockerClaim",
    "blocker",
    "blockerEvidence",
    "claimedBlocker",
    "claim",
)

_TRUE_STRINGS = {"1", "true", "t", "yes", "y", "on", "present", "ok", "passed", "pass"}
_FALSE_STRINGS = {"", "0", "false", "f", "no", "n", "off", "none", "null", "missing", "absent", "n/a"}
_PLACEHOLDER_EVIDENCE_STRINGS = _TRUE_STRINGS | _FALSE_STRINGS | {"evidence", "provided", "available"}
_CONTAINER_KEYS = (
    "evidence",
    "proof",
    "proofs",
    "facts",
    "plan",
    "thread",
    "state",
    "readback",
    "metadata",
    "context",
)


def _mapping(value: Any) -> Mapping[str, Any]:
    if isinstance(value, Mapping):
        return value
    if is_dataclass(value):
        return asdict(value)
    if hasattr(value, "__dict__"):
        return vars(value)
    return {}


def _iter_mappings(value: Any, *, _seen: set[int] | None = None) -> Iterable[Mapping[str, Any]]:
    if _seen is None:
        _seen = set()
    if id(value) in _seen:
        return
    _seen.add(id(value))
    current = _mapping(value)
    if not current:
        return
    yield current
    for key in _CONTAINER_KEYS:
        nested = current.get(key)
        nested_mapping = _mapping(nested)
        if nested_mapping:
            yield from _iter_mappings(nested_mapping, _seen=_seen)
    for nested in current.values():
        if isinstance(nested, Mapping):
            yield from _iter_mappings(nested, _seen=_seen)


def _normalise_key(key: object) -> str:
    return str(key).replace("_", "").replace("-", "").lower()


def _lookup(payload: Any, names: Sequence[str]) -> tuple[str | None, Any]:
    wanted = {_normalise_key(name): name for name in names}
    for mapping in _iter_mappings(payload):
        direct = {str(key): key for key in mapping.keys()}
        for name in names:
            if name in direct:
                return name, mapping[direct[name]]
        normalised = {_normalise_key(key): key for key in mapping.keys()}
        for wanted_key, display_name in wanted.items():
            if wanted_key in normalised:
                return display_name, mapping[normalised[wanted_key]]
    return None, None


def _truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        token = value.strip().lower()
        if token in _TRUE_STRINGS:
            return True
        if token in _FALSE_STRINGS:
            return False
        return bool(token)
    return _has_concrete_evidence(value)


def _has_concrete_evidence(value: Any) -> bool:
    if value is None or isinstance(value, bool):
        return False
    if isinstance(value, (int, float)):
        return True
    if isinstance(value, str):
        token = value.strip()
        if not token:
            return False
        return token.lower() not in _PLACEHOLDER_EVIDENCE_STRINGS
    if isinstance(value, Mapping):
        return any(_has_concrete_evidence(item) for item in value.values())
    if isinstance(value, (list, tuple, set, frozenset)):
        return any(_has_concrete_evidence(item) for item in value)
    return True


def _first_concrete(payload: Any, names: Sequence[str]) -> tuple[str | None, Any]:
    field, value = _lookup(payload, names)
    if _has_concrete_evidence(value):
        return field, value
    return None, None


def concrete_evidence(payload: Any) -> JsonMap:
    """Return the concrete safe-auto-continue evidence found in *payload*."""

    found: JsonMap = {}
    for category, aliases in _REQUIRED_CONCRETE_EVIDENCE.items():
        field, value = _first_concrete(payload, aliases)
        if field is not None:
            found[category] = {"field": field, "value": value}
    return found


def missing_concrete_evidence(payload: Any) -> list[str]:
    found = concrete_evidence(payload)
    return [category for category in _REQUIRED_CONCRETE_EVIDENCE if category not in found]


def _payload_flag(payload: Any, name: str, default: bool = False) -> bool:
    _, value = _lookup(payload, (name,))
    if value is None:
        return default
    return _truthy(value)


def _required_boolean_flags_present(payload: Any) -> bool:
    """Preserve the previous safety gates while strengthening their evidence."""

    required_true = (
        "planComplete",
        "localBaseEvidenceValinsPresent",
        "failureConditionsPresent",
        "gatesPresent",
        "reportableEvidencePresent",
        "worktreeBranchAbsent",
        "noMerge",
        "noPush",
        "noOverwrite",
    )
    return all(_payload_flag(payload, name) for name in required_true)


def row(
    state_kind: object,
    reason: str = "",
    evidence: Any | None = None,
    *,
    autoContinue: bool = False,
    missing: Sequence[str] | None = None,
    **extra: Any,
) -> JsonMap:
    """Build a result row with canonical state/classification tokens."""

    canonical = canonical_state_kind(state_kind)
    result: JsonMap = {
        "state": canonical,
        "stateKind": canonical,
        "classification": canonical,
        "reason": reason,
        "evidence": evidence if evidence is not None else {},
        "autoContinue": bool(autoContinue),
    }
    if missing:
        result["missingEvidence"] = list(missing)
    result.update(extra)
    return result


plan_row = row
build_plan_row = row


def _false_blocker_row(payload: Any) -> JsonMap | None:
    _, disproves = _lookup(payload, ("readbackDisprovesBlocker",))
    if not _truthy(disproves):
        return None

    claim_field, claim = _first_concrete(payload, _BLOCKER_CLAIM_FIELDS)
    readback_field, readback = _first_concrete(payload, _FALSE_BLOCKER_READBACK_FIELDS)
    evidence: JsonMap = {}
    if claim_field is not None:
        evidence["blockerClaim"] = {"field": claim_field, "value": claim}

    if readback_field is None:
        return row(
            INSUFFICIENT_PLAN,
            "readbackDisprovesBlocker requires concrete readback evidence before false-blocker can be emitted",
            evidence,
            missing=["readbackEvidence"],
        )

    evidence["readbackEvidence"] = {"field": readback_field, "value": readback}
    return row(
        FALSE_BLOCKER,
        "readback evidence disproves the blocker claim",
        evidence,
        autoContinue=False,
    )


def _accepted_plan_row(payload: Any) -> JsonMap | None:
    if not _required_boolean_flags_present(payload):
        return None

    missing = missing_concrete_evidence(payload)
    if missing:
        return row(
            INSUFFICIENT_PLAN,
            "safe auto-continue requires concrete readback/evidence for every required plan field",
            concrete_evidence(payload),
            missing=missing,
        )

    return row(
        PLAN_ACCEPTED,
        "safe auto-continue plan accepted with concrete controller evidence",
        concrete_evidence(payload),
        autoContinue=True,
    )


def classify_plan(payload: Any) -> JsonMap:
    """Classify a candidate plan payload.

    The controller never performs CDP, pushes, merges, local gate execution,
    overwrite handling, or canonical merge operations.  It only classifies the
    supplied evidence and emits a canonical state row.
    """

    false_blocker = _false_blocker_row(payload)
    if false_blocker is not None:
        return false_blocker

    accepted = _accepted_plan_row(payload)
    if accepted is not None:
        return accepted

    if _payload_flag(payload, "planComplete"):
        missing = missing_concrete_evidence(payload)
        return row(
            INSUFFICIENT_PLAN,
            "plan is complete, but safe auto-continue evidence or safety flags are incomplete",
            concrete_evidence(payload),
            missing=missing or ["safeAutoContinueFlags"],
        )

    return row(
        INSUFFICIENT_PLAN,
        "insufficient evidence to accept the plan",
        concrete_evidence(payload),
        missing=missing_concrete_evidence(payload),
    )


classify = classify_plan
evaluate_plan = classify_plan
evaluate = classify_plan
classify_safe_continue = classify_plan


def safe_auto_continue_allowed(payload: Any) -> bool:
    return classify_plan(payload).get("classification") == PLAN_ACCEPTED


safe_auto_continue = safe_auto_continue_allowed
