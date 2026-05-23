"""Discussion loop checks for ops-thread-fsm.

This module does not run ChatGPT or send messages. It only classifies whether a
discussion-required task has enough same-revision responses to converge.
"""
from __future__ import annotations

from typing import Any

from .state_model import next_action_for, permissions_for

NO_OBJECTIONS = "NO_UNRESOLVED_OBJECTIONS"
UNRESOLVED = "UNRESOLVED_OBJECTIONS"


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def _token(value: Any) -> str:
    return str(value or "").strip()


def _row(
    classification: str,
    next_state: str,
    *,
    discussion_id: str = "",
    proposal_revision: str = "",
    evidence: list[str] | None = None,
    missing: list[str] | None = None,
    objections: list[dict[str, Any]] | None = None,
    responses: list[dict[str, Any]] | None = None,
    retry: bool = False,
    reason: str | None = None,
    discussion_complete: bool = False,
) -> dict[str, Any]:
    return {
        "kind": "ops-thread-fsm.discussionCheck.v1",
        "classification": classification,
        "stateKind": classification,
        "nextStateKind": next_state,
        "discussionId": discussion_id,
        "proposalRevision": proposal_revision,
        "discussionComplete": discussion_complete,
        "missingCounterparties": missing or [],
        "objections": objections or [],
        "responses": responses or [],
        "evidence": evidence or [],
        "retry": retry,
        "retryReason": reason,
        "permissions": permissions_for(next_state),
        "writes": False,
        "sends": False,
        "nextAction": next_action_for(next_state),
    }


def _verdict(response: dict[str, Any]) -> str:
    for key in ("verdict", "status", "result", "classification"):
        value = _token(response.get(key))
        if value in {NO_OBJECTIONS, UNRESOLVED}:
            return value
    text = _token(response.get("text"))
    first = next((line.strip() for line in text.splitlines() if line.strip()), "")
    if first in {NO_OBJECTIONS, UNRESOLVED}:
        return first
    return ""


def check_discussion_value(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return _row("insufficient-plan", "discussion-response-required", reason="input must be an object")

    discussion_id = _token(value.get("discussionId"))
    revision = _token(value.get("proposalRevision"))
    required = [_token(item) for item in _as_list(value.get("noObjectionsRequiredFrom")) if _token(item)]
    responses = [item for item in _as_list(value.get("responses")) if isinstance(item, dict)]

    missing_fields = []
    if not discussion_id:
        missing_fields.append("discussionId")
    if not revision:
        missing_fields.append("proposalRevision")
    if not required:
        missing_fields.append("noObjectionsRequiredFrom")
    if missing_fields:
        return _row(
            "insufficient-plan",
            "discussion-response-required",
            discussion_id=discussion_id,
            proposal_revision=revision,
            missing=missing_fields,
            retry=True,
            reason="missing discussion loop fields",
        )

    same_revision_by_actor: dict[str, dict[str, Any]] = {}
    stale_or_wrong_revision = []
    for response in responses:
        actor = _token(response.get("actorId") or response.get("actor") or response.get("thread"))
        response_revision = _token(response.get("proposalRevision"))
        if not actor:
            continue
        if response_revision != revision:
            stale_or_wrong_revision.append(actor)
            continue
        same_revision_by_actor[actor] = response

    missing = [actor for actor in required if actor not in same_revision_by_actor]
    if missing:
        evidence = []
        if stale_or_wrong_revision:
            evidence.append("stale-or-wrong-revision:" + ",".join(sorted(stale_or_wrong_revision)))
        return _row(
            "discussion-response-required",
            "discussion-response-required",
            discussion_id=discussion_id,
            proposal_revision=revision,
            missing=missing,
            responses=list(same_revision_by_actor.values()),
            evidence=evidence,
            retry=True,
            reason="missing same-revision response",
        )

    objections = []
    needs_parent = []
    no_objections = []
    for actor in required:
        response = same_revision_by_actor[actor]
        verdict = _verdict(response)
        if verdict == NO_OBJECTIONS:
            no_objections.append(actor)
            continue
        if verdict == UNRESOLVED:
            entries = _as_list(response.get("objections"))
            if not entries and response.get("objectionText"):
                entries = [response]
            for entry in entries:
                if isinstance(entry, dict):
                    objection = dict(entry)
                else:
                    objection = {"objectionText": str(entry)}
                objection.setdefault("actorId", actor)
                objection.setdefault("proposalRevision", revision)
                objections.append(objection)
                if objection.get("requiresParentDecision") is True or objection.get("classification") == "needs-parent":
                    needs_parent.append(objection)
            if not entries:
                objections.append(
                    {
                        "actorId": actor,
                        "proposalRevision": revision,
                        "objectionText": "unresolved objections declared without structured objection entries",
                    }
                )
            continue
        objections.append(
            {
                "actorId": actor,
                "proposalRevision": revision,
                "objectionText": "missing explicit NO_UNRESOLVED_OBJECTIONS or UNRESOLVED_OBJECTIONS verdict",
            }
        )

    if needs_parent:
        return _row(
            "discussion-blocked-needs-parent",
            "discussion-blocked-needs-parent",
            discussion_id=discussion_id,
            proposal_revision=revision,
            objections=objections,
            responses=list(same_revision_by_actor.values()),
            reason="one or more objections require parent decision",
        )

    if objections:
        return _row(
            "discussion-objections-present",
            "discussion-objections-present",
            discussion_id=discussion_id,
            proposal_revision=revision,
            objections=objections,
            responses=list(same_revision_by_actor.values()),
            retry=True,
            reason="same-revision unresolved objections remain",
        )

    return _row(
        "discussion-no-objections-confirmed",
        "discussion-no-objections-confirmed",
        discussion_id=discussion_id,
        proposal_revision=revision,
        evidence=[f"same-revision-no-objections:{','.join(required)}"],
        responses=list(same_revision_by_actor.values()),
        discussion_complete=True,
    )


__all__ = ["NO_OBJECTIONS", "UNRESOLVED", "check_discussion_value"]
