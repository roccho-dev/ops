// Discussion loop checks for ops-thread-fsm.
//
// This module does not run ChatGPT or send messages. It only classifies whether a
// discussion-required task has enough same-revision responses to converge and
// renders controller-owned facilitation actions.
//
// Node ESM port of discussion.py (stdlib only, behavior-identical).

import { nextActionFor, permissionsFor } from "./state_model.mjs";
import { pyOr, splitlines } from "./pyhelpers.mjs";

export const NO_OBJECTIONS = "NO_UNRESOLVED_OBJECTIONS";
export const UNRESOLVED = "UNRESOLVED_OBJECTIONS";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function get(obj, key) {
  if (isPlainObject(obj) && Object.prototype.hasOwnProperty.call(obj, key)) {
    return obj[key];
  }
  return undefined;
}

function pyStr(value) {
  if (typeof value === "string") return value;
  if (value === true) return "True";
  if (value === false) return "False";
  if (value === null || value === undefined) return "None";
  if (typeof value === "number") return String(value);
  return JSON.stringify(value);
}

function _asList(value) {
  if (value === null || value === undefined) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  return [value];
}

function _token(value) {
  return pyStr(pyOr(value, "")).trim();
}

function _row(
  classification,
  nextState,
  {
    discussionId = "",
    proposalRevision = "",
    evidence = null,
    missing = null,
    objections = null,
    responses = null,
    retry = false,
    reason = null,
    discussionComplete = false,
  } = {},
) {
  return {
    kind: "ops-thread-fsm.discussionCheck.v1",
    classification,
    stateKind: classification,
    nextStateKind: nextState,
    discussionId,
    proposalRevision,
    discussionComplete,
    missingCounterparties: pyOr(missing, []),
    objections: pyOr(objections, []),
    responses: pyOr(responses, []),
    evidence: pyOr(evidence, []),
    retry,
    retryReason: reason,
    permissions: permissionsFor(nextState),
    writes: false,
    sends: false,
    nextAction: nextActionFor(nextState),
  };
}

function _verdict(response) {
  for (const key of ["verdict", "status", "result", "classification"]) {
    const value = _token(get(response, key));
    if (value === NO_OBJECTIONS || value === UNRESOLVED) {
      return value;
    }
  }
  const text = _token(get(response, "text"));
  let first = "";
  for (const line of splitlines(text)) {
    if (line.trim()) {
      first = line.trim();
      break;
    }
  }
  if (first === NO_OBJECTIONS || first === UNRESOLVED) {
    return first;
  }
  return "";
}

function _textContainsAny(text, markers) {
  const haystack = text.toLowerCase();
  return markers.some((marker) => marker && haystack.includes(marker.toLowerCase()));
}

function _normalizeMarkerResponses(value) {
  let accepted = _asList(get(value, "acceptedMarkers")).map((item) => _token(item)).filter((item) => item);
  let rejected = _asList(get(value, "objectionMarkers")).map((item) => _token(item)).filter((item) => item);
  accepted = pyOr(accepted, [NO_OBJECTIONS]);
  rejected = pyOr(rejected, [UNRESOLVED]);

  const responses = [];
  for (const response of _asList(get(value, "responses"))) {
    if (!isPlainObject(response)) {
      continue;
    }
    const item = { ...response };
    if (_verdict(item)) {
      responses.push(item);
      continue;
    }
    const text = _token(
      pyOr(get(item, "assistantText"), pyOr(get(item, "text"), get(item, "responseText"))),
    );
    const hasObjection = _textContainsAny(text, rejected);
    const hasAcceptance = _textContainsAny(text, accepted);
    if (hasObjection) {
      item.verdict = UNRESOLVED;
      if (!Object.prototype.hasOwnProperty.call(item, "objections")) {
        item.objections = [{ objectionText: "objection marker matched" }];
      }
    } else if (hasAcceptance) {
      item.verdict = NO_OBJECTIONS;
    }
    responses.push(item);
  }
  return responses;
}

export function checkDiscussionValue(value) {
  if (!isPlainObject(value)) {
    return _row("insufficient-plan", "discussion-response-required", { reason: "input must be an object" });
  }

  const discussionId = _token(get(value, "discussionId"));
  const revision = _token(get(value, "proposalRevision"));
  const required = _asList(get(value, "noObjectionsRequiredFrom"))
    .map((item) => _token(item))
    .filter((item) => item);
  const responses = _asList(get(value, "responses")).filter((item) => isPlainObject(item));

  const missingFields = [];
  if (!discussionId) {
    missingFields.push("discussionId");
  }
  if (!revision) {
    missingFields.push("proposalRevision");
  }
  if (!required.length) {
    missingFields.push("noObjectionsRequiredFrom");
  }
  if (missingFields.length) {
    return _row("insufficient-plan", "discussion-response-required", {
      discussionId,
      proposalRevision: revision,
      missing: missingFields,
      retry: true,
      reason: "missing discussion loop fields",
    });
  }

  const sameRevisionByActor = new Map();
  const staleOrWrongRevision = [];
  for (const response of responses) {
    const actor = _token(
      pyOr(get(response, "actorId"), pyOr(get(response, "actor"), get(response, "thread"))),
    );
    const responseRevision = _token(get(response, "proposalRevision"));
    if (!actor) {
      continue;
    }
    if (responseRevision !== revision) {
      staleOrWrongRevision.push(actor);
      continue;
    }
    sameRevisionByActor.set(actor, response);
  }

  const missing = required.filter((actor) => !sameRevisionByActor.has(actor));
  if (missing.length) {
    const evidence = [];
    if (staleOrWrongRevision.length) {
      evidence.push("stale-or-wrong-revision:" + [...staleOrWrongRevision].sort().join(","));
    }
    return _row("discussion-response-required", "discussion-response-required", {
      discussionId,
      proposalRevision: revision,
      missing,
      responses: [...sameRevisionByActor.values()],
      evidence,
      retry: true,
      reason: "missing same-revision response",
    });
  }

  const objections = [];
  const needsParent = [];
  const noObjections = [];
  for (const actor of required) {
    const response = sameRevisionByActor.get(actor);
    const verdict = _verdict(response);
    if (verdict === NO_OBJECTIONS) {
      noObjections.push(actor);
      continue;
    }
    if (verdict === UNRESOLVED) {
      let entries = _asList(get(response, "objections"));
      if (!entries.length && get(response, "objectionText")) {
        entries = [response];
      }
      for (const entry of entries) {
        let objection;
        if (isPlainObject(entry)) {
          objection = { ...entry };
        } else {
          objection = { objectionText: pyStr(entry) };
        }
        if (!Object.prototype.hasOwnProperty.call(objection, "actorId")) {
          objection.actorId = actor;
        }
        if (!Object.prototype.hasOwnProperty.call(objection, "proposalRevision")) {
          objection.proposalRevision = revision;
        }
        objections.push(objection);
        if (
          get(objection, "requiresParentDecision") === true ||
          get(objection, "classification") === "needs-parent"
        ) {
          needsParent.push(objection);
        }
      }
      if (!entries.length) {
        objections.push({
          actorId: actor,
          proposalRevision: revision,
          objectionText: "unresolved objections declared without structured objection entries",
        });
      }
      continue;
    }
    objections.push({
      actorId: actor,
      proposalRevision: revision,
      objectionText: "missing explicit NO_UNRESOLVED_OBJECTIONS or UNRESOLVED_OBJECTIONS verdict",
    });
  }

  if (needsParent.length) {
    return _row("discussion-blocked-needs-parent", "discussion-blocked-needs-parent", {
      discussionId,
      proposalRevision: revision,
      objections,
      responses: [...sameRevisionByActor.values()],
      reason: "one or more objections require parent decision",
    });
  }

  if (objections.length) {
    return _row("discussion-objections-present", "discussion-objections-present", {
      discussionId,
      proposalRevision: revision,
      objections,
      responses: [...sameRevisionByActor.values()],
      retry: true,
      reason: "same-revision unresolved objections remain",
    });
  }

  return _row("discussion-no-objections-confirmed", "discussion-no-objections-confirmed", {
    discussionId,
    proposalRevision: revision,
    evidence: [`same-revision-no-objections:${required.join(",")}`],
    responses: [...sameRevisionByActor.values()],
    discussionComplete: true,
  });
}

function _threadActorIds(value) {
  const threadIds = [];
  for (const thread of _asList(get(value, "threads"))) {
    if (isPlainObject(thread)) {
      const actorId = _token(
        pyOr(get(thread, "actorId"), pyOr(get(thread, "actor"), get(thread, "thread"))),
      );
      if (actorId) {
        threadIds.push(actorId);
      }
    }
  }
  return threadIds;
}

function _hasPurposeLineage(value) {
  const lineage = get(value, "purposeLineage");
  if (!isPlainObject(lineage)) {
    return false;
  }
  if (["purpose", "metaPurpose", "metaMetaPurpose", "metaMetaMetaPurpose"].every((key) => _token(get(lineage, key)))) {
    return true;
  }
  const depthsRaw = get(lineage, "depths");
  const depths = isPlainObject(depthsRaw) ? depthsRaw : lineage;
  return [3, 2, 1, 0].every((depth) =>
    _token(pyOr(get(depths, String(depth)), pyOr(get(depths, depth), get(depths, `purposeDepth=${depth}`)))),
  );
}

function _missingFacilitationFields(value) {
  const missing = [];
  for (const key of ["discussionId", "proposalRevision"]) {
    if (!_token(get(value, key))) {
      missing.push(key);
    }
  }
  if (!_token(pyOr(get(value, "versionedProposalRef"), get(value, "projectSourceEntrypoint")))) {
    missing.push("versionedProposalRef or projectSourceEntrypoint");
  }
  if (!_token(get(value, "policySnapshotRef")) && !_asList(get(value, "policyRefs")).length) {
    missing.push("policySnapshotRef or policyRefs");
  }
  if (!_hasPurposeLineage(value)) {
    missing.push("purposeLineage depth 3..0");
  }
  if (!_asList(get(value, "reviewQualityChecks")).length) {
    missing.push("reviewQualityChecks");
  }
  if (_threadActorIds(value).length < 2) {
    missing.push("threads[2+] with actorId");
  }
  return missing;
}

function _controlForThread(value, thread) {
  const actorId = _token(pyOr(get(thread, "actorId"), pyOr(get(thread, "actor"), get(thread, "thread"))));
  const threadFunction = _token(
    pyOr(get(thread, "threadFunction"), pyOr(get(value, "threadFunction"), "impl-review")),
  );
  return {
    actorId,
    threadUrl: _token(pyOr(get(thread, "threadUrl"), get(thread, "url"))),
    threadFunction,
    sendVia: "ops-cdp-core:project-thread-send",
    inlinePolicy: "pointer-only",
    controlText: [
      `role.chatgpt.thread: ${threadFunction}`,
      "",
      "Read the Project Source entrypoint: " +
        _token(pyOr(get(value, "projectSourceEntrypoint"), get(value, "versionedProposalRef"))),
      "This is direct cross-discussion. Read peer replies directly, not facilitator synthesis.",
      "If objections remain, return UNRESOLVED_OBJECTIONS with structured objections.",
      "If no objections remain for proposalRevision " +
        _token(get(value, "proposalRevision")) +
        ", return NO_UNRESOLVED_OBJECTIONS.",
    ].join("\n"),
  };
}

export function facilitateDiscussionValue(value) {
  if (!isPlainObject(value)) {
    return {
      kind: "ops-thread-fsm.discussionFacilitation.v1",
      classification: "facilitation-context-incomplete",
      missingFields: ["input object"],
      writes: false,
      sends: false,
      nextAction: "provide a discussion facilitation object",
    };
  }

  const missing = _missingFacilitationFields(value);
  const discussionId = _token(get(value, "discussionId"));
  const revision = _token(get(value, "proposalRevision"));
  let required = _asList(get(value, "noObjectionsRequiredFrom"))
    .map((item) => _token(item))
    .filter((item) => item);
  required = pyOr(required, _threadActorIds(value));

  if (missing.length) {
    return {
      kind: "ops-thread-fsm.discussionFacilitation.v1",
      classification: "facilitation-context-incomplete",
      discussionId,
      proposalRevision: revision,
      missingFields: missing,
      writes: false,
      sends: false,
      nextAction: "add the missing Project Source bootstrap fields before starting discussion",
    };
  }

  const normalized = { ...value };
  normalized.noObjectionsRequiredFrom = required;
  normalized.responses = _normalizeMarkerResponses(value);
  const check = checkDiscussionValue(normalized);

  const controls = _asList(get(value, "threads"))
    .filter((thread) => isPlainObject(thread))
    .map((thread) => _controlForThread(value, thread));
  const base = {
    kind: "ops-thread-fsm.discussionFacilitation.v1",
    discussionId,
    proposalRevision: revision,
    requiredCounterparties: required,
    versionedProposalRef: _token(pyOr(get(value, "versionedProposalRef"), get(value, "projectSourceEntrypoint"))),
    policySnapshotRef: _token(get(value, "policySnapshotRef")),
    projectSourceRequired: true,
    writes: false,
    sends: false,
    transportPackage: "ops-cdp-core",
    fsmPackage: "ops-thread-fsm",
  };

  if (check.classification === "discussion-no-objections-confirmed") {
    return {
      ...base,
      classification: "facilitation-no-objections-confirmed",
      discussionComplete: true,
      acceptedProposalRef: _token(
        pyOr(get(value, "versionedProposalRef"), get(value, "projectSourceEntrypoint")),
      ),
      evidence: check.evidence,
      responses: check.responses,
      nextAction:
        "import this verdict as review evidence; this is not localize, merge, push, or cleanup approval",
    };
  }

  if (check.classification === "discussion-objections-present") {
    return {
      ...base,
      classification: "facilitation-revision-update-required",
      discussionComplete: false,
      objections: check.objections,
      responses: check.responses,
      requiredNextArtifact: "new versioned proposal with accepted/rejected/modified objection handling",
      nextAction:
        "create a new proposalRevision in Project Source and run another direct cross-discussion round",
    };
  }

  if (check.classification === "discussion-blocked-needs-parent") {
    return {
      ...base,
      classification: "facilitation-parent-decision-required",
      discussionComplete: false,
      objections: check.objections,
      responses: check.responses,
      nextAction: "ask parentActor to decide the needs-parent objection before continuing",
    };
  }

  return {
    ...base,
    classification: "facilitation-round-send-required",
    discussionComplete: false,
    missingCounterparties: check.missingCounterparties,
    threadControls: controls,
    readbackPolicy: "wait >=300s before semantic readback",
    nextAction:
      "upload/update Project Source if needed, send pointer-only controls, wait >=300s, then import assistant replies and re-run",
  };
}
