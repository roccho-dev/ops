"""Discussion loop checks for ops-thread-fsm.

This module does not run ChatGPT or send messages. It only classifies whether a
discussion-required task has enough same-revision responses to converge and
renders controller-owned facilitation actions.
"""
from __future__ import annotations

import re
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


def _text_contains_marker(text: str, marker: str) -> bool:
    marker = _token(marker)
    if not marker:
        return False
    if marker in {line.strip() for line in text.splitlines()}:
        return True
    pattern = rf"(?<![A-Za-z0-9_]){re.escape(marker)}(?![A-Za-z0-9_])"
    return re.search(pattern, text, flags=re.IGNORECASE) is not None


def _text_contains_any(text: str, markers: list[str]) -> bool:
    return any(_text_contains_marker(text, marker) for marker in markers)


def _normalize_marker_responses(value: dict[str, Any]) -> list[dict[str, Any]]:
    accepted = [_token(item) for item in _as_list(value.get("acceptedMarkers")) if _token(item)]
    rejected = [_token(item) for item in _as_list(value.get("objectionMarkers")) if _token(item)]
    accepted = accepted or [NO_OBJECTIONS]
    rejected = rejected or [UNRESOLVED]

    responses = []
    for response in _as_list(value.get("responses")):
        if not isinstance(response, dict):
            continue
        item = dict(response)
        if _verdict(item):
            responses.append(item)
            continue
        text = _token(item.get("assistantText") or item.get("text") or item.get("responseText"))
        has_objection = _text_contains_any(text, rejected)
        has_acceptance = _text_contains_any(text, accepted)
        if has_objection:
            item["verdict"] = UNRESOLVED
            item.setdefault("objections", [{"objectionText": "objection marker matched"}])
        elif has_acceptance:
            item["verdict"] = NO_OBJECTIONS
        responses.append(item)
    return responses


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


def _thread_actor_ids(value: dict[str, Any]) -> list[str]:
    thread_ids = []
    for thread in _as_list(value.get("threads")):
        if isinstance(thread, dict):
            actor_id = _token(thread.get("actorId") or thread.get("actor") or thread.get("thread"))
            if actor_id:
                thread_ids.append(actor_id)
    return thread_ids


def _has_purpose_lineage(value: dict[str, Any]) -> bool:
    lineage = value.get("purposeLineage")
    if not isinstance(lineage, dict):
        return False
    if all(_token(lineage.get(key)) for key in ("purpose", "metaPurpose", "metaMetaPurpose", "metaMetaMetaPurpose")):
        return True
    depths = lineage.get("depths") if isinstance(lineage.get("depths"), dict) else lineage
    return all(_token(depths.get(str(depth)) or depths.get(depth) or depths.get(f"purposeDepth={depth}")) for depth in (3, 2, 1, 0))


def _missing_facilitation_fields(value: dict[str, Any]) -> list[str]:
    missing = []
    for key in ("discussionId", "proposalRevision"):
        if not _token(value.get(key)):
            missing.append(key)
    if not _token(value.get("versionedProposalRef") or value.get("projectSourceEntrypoint")):
        missing.append("versionedProposalRef or projectSourceEntrypoint")
    if not _token(value.get("policySnapshotRef")) and not _as_list(value.get("policyRefs")):
        missing.append("policySnapshotRef or policyRefs")
    if not _has_purpose_lineage(value):
        missing.append("purposeLineage depth 3..0")
    if not _as_list(value.get("reviewQualityChecks")):
        missing.append("reviewQualityChecks")
    if len(_thread_actor_ids(value)) < 2:
        missing.append("threads[2+] with actorId")
    return missing


def _control_for_thread(value: dict[str, Any], thread: dict[str, Any]) -> dict[str, Any]:
    actor_id = _token(thread.get("actorId") or thread.get("actor") or thread.get("thread"))
    thread_function = _token(thread.get("threadFunction") or value.get("threadFunction") or "impl-review")
    return {
        "actorId": actor_id,
        "threadUrl": _token(thread.get("threadUrl") or thread.get("url")),
        "threadFunction": thread_function,
        "sendVia": "ops-cdp-core:project-thread-send",
        "inlinePolicy": "pointer-only",
        "controlText": "\n".join(
            [
                f"role.chatgpt.thread: {thread_function}",
                "",
                "Read the Project Source entrypoint: "
                + _token(value.get("projectSourceEntrypoint") or value.get("versionedProposalRef")),
                "This is direct cross-discussion. Read peer replies directly, not facilitator synthesis.",
                "If objections remain, return UNRESOLVED_OBJECTIONS with structured objections.",
                "If no objections remain for proposalRevision "
                + _token(value.get("proposalRevision"))
                + ", return NO_UNRESOLVED_OBJECTIONS.",
            ]
        ),
    }


def facilitate_discussion_value(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {
            "kind": "ops-thread-fsm.discussionFacilitation.v1",
            "classification": "facilitation-context-incomplete",
            "missingFields": ["input object"],
            "writes": False,
            "sends": False,
            "nextAction": "provide a discussion facilitation object",
        }

    missing = _missing_facilitation_fields(value)
    discussion_id = _token(value.get("discussionId"))
    revision = _token(value.get("proposalRevision"))
    required = [_token(item) for item in _as_list(value.get("noObjectionsRequiredFrom")) if _token(item)]
    required = required or _thread_actor_ids(value)

    if missing:
        return {
            "kind": "ops-thread-fsm.discussionFacilitation.v1",
            "classification": "facilitation-context-incomplete",
            "discussionId": discussion_id,
            "proposalRevision": revision,
            "missingFields": missing,
            "writes": False,
            "sends": False,
            "nextAction": "add the missing Project Source bootstrap fields before starting discussion",
        }

    normalized = dict(value)
    normalized["noObjectionsRequiredFrom"] = required
    normalized["responses"] = _normalize_marker_responses(value)
    check = check_discussion_value(normalized)

    controls = [_control_for_thread(value, thread) for thread in _as_list(value.get("threads")) if isinstance(thread, dict)]
    base = {
        "kind": "ops-thread-fsm.discussionFacilitation.v1",
        "discussionId": discussion_id,
        "proposalRevision": revision,
        "requiredCounterparties": required,
        "versionedProposalRef": _token(value.get("versionedProposalRef") or value.get("projectSourceEntrypoint")),
        "policySnapshotRef": _token(value.get("policySnapshotRef")),
        "projectSourceRequired": True,
        "writes": False,
        "sends": False,
        "transportPackage": "ops-cdp-core",
        "fsmPackage": "ops-thread-fsm",
    }

    if check["classification"] == "discussion-no-objections-confirmed":
        return {
            **base,
            "classification": "facilitation-no-objections-confirmed",
            "discussionComplete": True,
            "acceptedProposalRef": _token(value.get("versionedProposalRef") or value.get("projectSourceEntrypoint")),
            "evidence": check["evidence"],
            "responses": check["responses"],
            "nextAction": "import this verdict as review evidence; this is not localize, merge, push, or cleanup approval",
        }

    if check["classification"] == "discussion-objections-present":
        return {
            **base,
            "classification": "facilitation-revision-update-required",
            "discussionComplete": False,
            "objections": check["objections"],
            "responses": check["responses"],
            "requiredNextArtifact": "new versioned proposal with accepted/rejected/modified objection handling",
            "nextAction": "create a new proposalRevision in Project Source and run another direct cross-discussion round",
        }

    if check["classification"] == "discussion-blocked-needs-parent":
        return {
            **base,
            "classification": "facilitation-parent-decision-required",
            "discussionComplete": False,
            "objections": check["objections"],
            "responses": check["responses"],
            "nextAction": "ask parentActor to decide the needs-parent objection before continuing",
        }

    return {
        **base,
        "classification": "facilitation-round-send-required",
        "discussionComplete": False,
        "missingCounterparties": check["missingCounterparties"],
        "threadControls": controls,
        "readbackPolicy": "wait >=300s before semantic readback",
        "nextAction": "upload/update Project Source if needed, send pointer-only controls, wait >=300s, then import assistant replies and re-run",
    }


__all__ = ["NO_OBJECTIONS", "UNRESOLVED", "check_discussion_value", "facilitate_discussion_value"]
