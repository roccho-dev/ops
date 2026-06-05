// Plan classification helpers for ops-thread-fsm.
//
// The controller classifies supplied evidence only. It does not perform CDP,
// pushes, refs-vault operations, artifact materialization, local gate execution,
// overwrite handling, or canonical merges.
//
// Node ESM port of plan.py (stdlib only, behavior-identical).

import {
  FALSE_BLOCKER,
  INSUFFICIENT_PLAN,
  PLAN_ACCEPTED,
  nextActionFor,
  permissionsFor,
} from "./state_model.mjs";
import { pyOr } from "./pyhelpers.mjs";

export const UNSUPPORTED = ["not sent", "thread not created", "not in project", "cannot connect"];
export const BOOLEAN_REQUIRED = [
  ["planComplete"],
  ["localBaseEvidenceValid", "localBaseEvidenceValinsPresent"],
  ["successConditionsPresent"],
  ["failureConditionsPresent"],
  ["gatesPresent"],
  ["reportableEvidencePresent"],
  ["worktreeBranchAbsent"],
  ["noMerge"],
  ["noPush"],
  ["noOverwrite"],
];
export const REQUIRED_CONCRETE = {
  localBase: [
    "localBaseEvidence",
    "localBaseReadbackEvidence",
    "localBaseContent",
    "localBase",
    "localBaseValue",
    "localBaseSha",
    "localBaseCommit",
    "localBaseEvidenceValues",
    "localBaseEvidenceValins",
  ],
  base: ["baseEvidence", "baseReadbackEvidence", "baseContent", "base", "baseRef", "baseSha", "baseCommit"],
  upstream: [
    "upstreamEvidence",
    "upstreamReadbackEvidence",
    "upstreamContent",
    "upstream",
    "upstreamRef",
    "upstreamHead",
    "upstreamSha",
    "upstreamCommit",
  ],
  head: [
    "headEvidence",
    "headReadbackEvidence",
    "headContent",
    "head",
    "headSha",
    "headCommit",
    "candidateHead",
    "candidateHeadEvidence",
  ],
  worktree: [
    "worktreeEvidence",
    "worktreeReadbackEvidence",
    "worktreeContent",
    "worktree",
    "worktreePath",
    "worktreeStatus",
    "worktreeCleanEvidence",
  ],
  branch: [
    "branchEvidence",
    "branchReadbackEvidence",
    "branchContent",
    "branch",
    "branchName",
    "candidateBranch",
    "candidateBranchEvidence",
  ],
  successConditions: [
    "successConditionsEvidence",
    "successConditionEvidence",
    "successConditionsContent",
    "successConditions",
    "successCriteria",
    "successCriteriaEvidence",
  ],
  failureConditions: [
    "failureConditionsEvidence",
    "failureConditionEvidence",
    "failureConditionsContent",
    "failureConditions",
    "failureCriteria",
    "failureCriteriaEvidence",
  ],
  gates: [
    "gatesEvidence",
    "gateEvidence",
    "gatesContent",
    "gates",
    "requiredGates",
    "requiredGatesEvidence",
    "gateList",
  ],
  reportableEvidence: [
    "reportableEvidence",
    "reportableEvidenceEvidence",
    "reportableEvidenceContent",
    "reportEvidence",
    "responseEvidence",
    "readbackResponseEvidence",
    "externalThreadResponseEvidence",
  ],
};
export const FALSE_BLOCKER_READBACK = [
  "readbackEvidence",
  "readbackContent",
  "readbackProof",
  "readbackTranscript",
  "blockerReadbackEvidence",
  "disprovingReadbackEvidence",
  "disprovingReadbackContent",
  "responseEvidence",
  "readbackResponseEvidence",
];
export const PLACEHOLDERS = new Set([
  "",
  "true",
  "false",
  "yes",
  "no",
  "ok",
  "pass",
  "valid",
  "present",
  "1",
  "0",
  "provided",
  "available",
  "evidence",
  "none",
  "null",
  "missing",
  "absent",
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Mirror dict.get: returns the value for key or undefined.
function get(p, key) {
  if (isPlainObject(p) && Object.prototype.hasOwnProperty.call(p, key)) {
    return p[key];
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

export function truthy(v) {
  return (
    v === true ||
    (typeof v === "string" &&
      ["true", "yes", "ok", "pass", "valid", "present", "1"].includes(v.trim().toLowerCase()))
  );
}

export function concrete(v) {
  if (v === null || v === undefined || typeof v === "boolean") {
    return false;
  }
  if (typeof v === "number") {
    return true;
  }
  if (typeof v === "string") {
    return Boolean(v.trim()) && !PLACEHOLDERS.has(v.trim().toLowerCase());
  }
  if (isPlainObject(v)) {
    return Object.values(v).some((x) => concrete(x));
  }
  if (Array.isArray(v)) {
    return v.some((x) => concrete(x));
  }
  return true;
}

export function flag(p, key) {
  return isPlainObject(p) && truthy(get(p, key));
}

export function flagAny(p, keys) {
  return keys.some((key) => flag(p, key));
}

export function evidence(p, ...keys) {
  return isPlainObject(p) ? keys.some((k) => concrete(get(p, k))) : false;
}

export function firstEvidence(p, keys) {
  if (!isPlainObject(p)) {
    return [null, null];
  }
  for (const key of keys) {
    const value = get(p, key);
    if (concrete(value)) {
      return [key, value];
    }
  }
  return [null, null];
}

export function concreteEvidence(p) {
  const found = {};
  for (const [category, keys] of Object.entries(REQUIRED_CONCRETE)) {
    const [key, value] = firstEvidence(p, keys);
    if (key) {
      found[category] = { field: key, value };
    }
  }
  return found;
}

export function missingConcrete(p) {
  const found = concreteEvidence(p);
  return Object.keys(REQUIRED_CONCRETE).filter(
    (category) => !Object.prototype.hasOwnProperty.call(found, category),
  );
}

export function row(kind, state, ev = null, retry = false, reason = null, auto = null, missing = null) {
  const out = {
    kind: "ops-thread-fsm.classification.v1",
    classification: kind,
    stateKind: kind,
    nextStateKind: state,
    evidence: ev !== null && ev !== undefined ? ev : [],
    retry,
    retryReason: reason,
    permissions: permissionsFor(state),
    writes: false,
    sends: false,
    nextAction: nextActionFor(state),
  };
  if (auto !== null) {
    out.autoContinue = auto;
  }
  if (missing) {
    out.missingEvidence = [...missing];
  }
  return out;
}

export function destructive(p) {
  const parts = ["scope", "requestedActions", "text"].map((k) => {
    const v = get(p, k);
    return pyStr(v === undefined ? "" : v);
  });
  const text = parts.join("\n").toLowerCase();
  const out = [];
  if (
    get(p, "noMerge") === false ||
    flag(p, "mergeRequested") ||
    flag(p, "canonicalMergeRequested") ||
    (text.includes("merge") && !text.includes("no merge"))
  ) {
    out.push("merge-scope");
  }
  if (
    get(p, "noPush") === false ||
    flag(p, "pushRequested") ||
    (text.includes("push") && !text.includes("no push"))
  ) {
    out.push("push-scope");
  }
  if (
    get(p, "noOverwrite") === false ||
    flag(p, "overwriteRequested") ||
    (text.includes("overwrite") && !text.includes("no overwrite"))
  ) {
    out.push("overwrite-scope");
  }
  return out;
}

export function externalRequested(p) {
  const ext = get(p, "externalThread");
  const n = isPlainObject(ext) ? ext : {};
  const keys = [
    "externalThreadWork",
    "externalThreadRequired",
    "externalThreadRequested",
    "work",
    "required",
    "requested",
  ];
  for (const x of [p, n]) {
    for (const k of keys) {
      if (flag(x, k)) {
        return true;
      }
    }
  }
  return false;
}

export function externalConfirmed(p) {
  const ext = get(p, "externalThread");
  const n = isPlainObject(ext) ? ext : {};
  const send =
    evidence(p, "sendConfirmationEvidence", "sendConfirmationContent", "externalSendConfirmationEvidence") ||
    evidence(n, "sendConfirmationEvidence", "sentEvidence");
  const readback =
    evidence(p, "readbackEvidence", "readbackContent", "externalReadbackEvidence") ||
    evidence(n, "readbackEvidence", "readback");
  const response =
    evidence(p, "responseEvidence", "responseContent", "externalResponseEvidence") ||
    evidence(n, "responseEvidence", "response");
  return send && readback && response;
}

export function evaluatePlanValue(value) {
  const p = isPlainObject(value) ? value : { text: pyStr(pyOr(value, "")) };
  const claimRaw =
    get(p, "blockerClaim") !== undefined
      ? get(p, "blockerClaim")
      : get(p, "claim") !== undefined
        ? get(p, "claim")
        : get(p, "blocker") !== undefined
          ? get(p, "blocker")
          : "";
  const claim = pyStr(claimRaw).trim();
  const lower = claim.toLowerCase();

  const bad = destructive(p);
  if (bad.length) {
    return row(
      "escalation-needed",
      "escalation-needed",
      bad,
      false,
      "merge/push/overwrite scope requires human judgment",
      false,
    );
  }

  if (claim && flag(p, "readbackDisprovesBlocker")) {
    const [readbackKey, readbackValue] = firstEvidence(p, FALSE_BLOCKER_READBACK);
    if (!readbackKey) {
      return row(
        INSUFFICIENT_PLAN,
        INSUFFICIENT_PLAN,
        { blockerClaim: claim },
        true,
        "readbackDisprovesBlocker requires concrete readback evidence",
        false,
        ["readbackEvidence"],
      );
    }
    return row(
      FALSE_BLOCKER,
      PLAN_ACCEPTED,
      {
        blockerClaim: claim,
        readbackEvidence: { field: readbackKey, value: readbackValue },
      },
      false,
      "readback evidence disproves blocker claim",
      false,
    );
  }

  if (claim && flag(p, "blockerEvidence")) {
    return row("real-blocker", "real-blocker", [claim], true, "evidence-backed blocker", false);
  }
  if (claim && UNSUPPORTED.some((token) => lower.includes(token))) {
    return row(INSUFFICIENT_PLAN, INSUFFICIENT_PLAN, [claim], true, "unsupported blocker claim lacks evidence", false);
  }

  const missing = BOOLEAN_REQUIRED.filter((keys) => !flagAny(p, keys)).map((keys) => keys[0]);
  for (const item of missingConcrete(p)) {
    missing.push(item);
  }
  if (externalRequested(p) && !externalConfirmed(p)) {
    missing.push("externalThreadConcreteSendConfirmationReadbackAndResponse");
  }
  if (missing.length) {
    return row(
      INSUFFICIENT_PLAN,
      INSUFFICIENT_PLAN,
      pyOr(concreteEvidence(p), missing),
      true,
      "missing safe-plan evidence",
      false,
      missing,
    );
  }

  const ev = concreteEvidence(p);
  if (!flag(p, "preAuthorized")) {
    return row(
      PLAN_ACCEPTED,
      "state-requiring-user-gen0-agreement",
      pyOr(ev, ["preAuthorized"]),
      false,
      "safe plan lacks pre-authorization",
      false,
    );
  }
  return row(PLAN_ACCEPTED, "state-allowed-to-proceed-without-extra-user-agreement", ev, false, null, true);
}

export const classifyPlan = evaluatePlanValue;
export const evaluatePlan = evaluatePlanValue;
export const classify = evaluatePlanValue;
export const safeAutoContinueAllowed = (payload) =>
  evaluatePlanValue(payload).classification === PLAN_ACCEPTED &&
  evaluatePlanValue(payload).autoContinue === true;
