"""State-kind vocabulary for the ops thread FSM controller.

The specs and runbooks use ``plan-accepted`` as the canonical token.  A
legacy caller may still pass the earlier spelling through user-facing entry
points, but every public result emitted by this package is canonicalised to
``plan-accepted``.
"""

from __future__ import annotations

from enum import Enum
from typing import Iterable

PLAN_ACCEPTED = "plan-accepted"
LEGACY_ACCEPTED_PLAN = "accepted" + "-plan"
INSUFFICIENT_PLAN = "insufficient-plan"
FALSE_BLOCKER = "false-blocker"


class StateKind(str, Enum):
    """Canonical state/classification tokens emitted by the controller."""

    INSUFFICIENT_PLAN = INSUFFICIENT_PLAN
    PLAN_ACCEPTED = PLAN_ACCEPTED
    FALSE_BLOCKER = FALSE_BLOCKER


STATE_KINDS: tuple[str, ...] = tuple(kind.value for kind in StateKind)
ALL_STATE_KINDS = STATE_KINDS
VALID_STATE_KINDS = STATE_KINDS
STATES = STATE_KINDS
ALL_STATES = STATE_KINDS
VALID_STATES = STATE_KINDS

STATE_KIND_ALIASES: dict[str, str] = {
    LEGACY_ACCEPTED_PLAN: PLAN_ACCEPTED,
    "accepted_plan": PLAN_ACCEPTED,
    "plan_accepted": PLAN_ACCEPTED,
}
STATE_ALIASES = STATE_KIND_ALIASES

SUCCESS_CLASSIFICATIONS: tuple[str, ...] = (PLAN_ACCEPTED,)
SUCCESS_STATES = SUCCESS_CLASSIFICATIONS


def canonical_state_kind(value: object) -> str:
    """Return the canonical state-kind string for *value*.

    Compatibility aliases are accepted at the boundary so that older
    ``plxt --state-kind`` invocations do not leak legacy vocabulary into FSM
    output.
    """

    if isinstance(value, StateKind):
        return value.value
    if value is None:
        return ""
    token = str(value).strip()
    normalised = token.lower().replace(" ", "-")
    return STATE_KIND_ALIASES.get(token, STATE_KIND_ALIASES.get(normalised, normalised))


normalize_state_kind = canonical_state_kind
normalise_state_kind = canonical_state_kind
canonicalize_state_kind = canonical_state_kind
canonicalise_state_kind = canonical_state_kind


def is_known_state_kind(value: object) -> bool:
    return canonical_state_kind(value) in STATE_KINDS


def is_success_classification(value: object) -> bool:
    return canonical_state_kind(value) in SUCCESS_CLASSIFICATIONS


def canonical_state_kinds(values: Iterable[object]) -> tuple[str, ...]:
    return tuple(canonical_state_kind(value) for value in values)


# Backwards-compatible exported names.  The value is intentionally canonical.
ACCEPTED_PLAN = PLAN_ACCEPTED
State = StateKind
