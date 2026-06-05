// State and permission vocabulary for ops-thread-fsm.
//
// `plan-accepted` is the canonical accepted-plan token emitted by this package.
// The legacy spelling is accepted only as a boundary alias so older callers can
// still pass `--state-kind accepted-plan` without leaking that token into output.
//
// Node ESM port of state_model.py (stdlib only, behavior-identical).

import { pyOr } from "./pyhelpers.mjs";

export const PLAN_ACCEPTED = "plan-accepted";
export const ACCEPTED_PLAN = PLAN_ACCEPTED;
export const LEGACY_ACCEPTED_PLAN = "accepted" + "-plan";
export const FALSE_BLOCKER = "false-blocker";
export const INSUFFICIENT_PLAN = "insufficient-plan";

export const STATE_ALIASES = {
  [LEGACY_ACCEPTED_PLAN]: PLAN_ACCEPTED,
  accepted_plan: PLAN_ACCEPTED,
  "accepted plan": PLAN_ACCEPTED,
  plan_accepted: PLAN_ACCEPTED,
  "plan accepted": PLAN_ACCEPTED,
};
export const STATE_KIND_ALIASES = STATE_ALIASES;

export function canonicalStateKind(value) {
  const token = String(value === null || value === undefined || value === false ? "" : value).trim();
  const normalized = token.toLowerCase().replace(/_/g, "-").replace(/ /g, "-");
  if (Object.prototype.hasOwnProperty.call(STATE_ALIASES, token)) {
    return STATE_ALIASES[token];
  }
  if (Object.prototype.hasOwnProperty.call(STATE_ALIASES, normalized)) {
    return STATE_ALIASES[normalized];
  }
  return normalized;
}

export const normalizeStateKind = canonicalStateKind;
export const normaliseStateKind = canonicalStateKind;
export const canonicalizeStateKind = canonicalStateKind;
export const canonicaliseStateKind = canonicalStateKind;

export const STATE_KINDS = [
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
];
export const ALL_STATE_KINDS = STATE_KINDS;
export const VALID_STATE_KINDS = STATE_KINDS;
export const STATES = STATE_KINDS;
export const ALL_STATES = STATE_KINDS;
export const VALID_STATES = STATE_KINDS;
export const SUCCESS_CLASSIFICATIONS = [PLAN_ACCEPTED];
export const SUCCESS_STATES = SUCCESS_CLASSIFICATIONS;

export const PERMISSION_KEYS = [
  "createWorktree",
  "implement",
  "returnArtifact",
  "sendReview",
  "readyForMergeReview",
  "mergeReady",
  "canonicalMerge",
  "push",
  "overwrite",
];

export const NEXT_ACTIONS = {
  "request-sent": "sleep 900; then delegated readback via ops-cdp-core",
  "sleeping-900": "perform delegated readback via ops-cdp-core",
  "real-blocker": "stop normal flow; report evidence-backed blocker",
  [FALSE_BLOCKER]: "correct blocker classification and resume",
  [INSUFFICIENT_PLAN]: "fail closed; collect missing plan evidence",
  [PLAN_ACCEPTED]: "evaluate safe auto-continue boundary",
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
  "handoff-created":
    "non-terminal source handoff; verify worker-readable readback and explicit next owner before work",
  "local-handoff-ready":
    "local handoff evidence is present; review next required owner before localizer",
  "project-handoff-sent":
    "Project handoff transport evidence exists; wait for worker readback or review evidence",
  "project-review-ready":
    "Project review evidence is present but merge-review pass is not yet localizer input",
  "merge-review-pass-received":
    "merge-review pass received; run no-drift and localizer preflight before localizer-ready",
  "localizer-ready":
    "merge-review pass plus fresh policy/canonical evidence; localizer may request explicit approval",
  "blocked-transport": "Project/source/artifact transport evidence is missing or failed",
  "stale-policy-claim": "policy snapshot is stale; reread policy and refresh claim",
  "stale-canonical-head": "canonical head drifted; refresh no-drift evidence before localizer",
  "impl-review": "wait for explicit impl-review-pass or impl-review-reject",
  "merge-review": "wait for explicit merge-review-pass or merge-review-reject",
  "discussion-requested": "collect proposal revision and required counterparties",
  "proposal-revision-present":
    "request same-revision responses from all required counterparties",
  "discussion-objections-present":
    "synthesize objections into the next proposal revision or escalate",
  "discussion-response-required":
    "request missing same-revision responses; do not complete discussion",
  "discussion-no-objections-candidate":
    "verify all required counterparties answered no-objections on the same revision",
  "discussion-no-objections-confirmed":
    "discussion converged for this revision; not implementation or merge approval",
  "discussion-blocked-needs-parent": "stop discussion loop and ask parent for a decision",
  "planner-targets-ready": "create the required next handoff or escalate missing destination",
  "merge-request-required": "send merge request to the declared merge-work owner",
  "merge-request-sent": "sleep/readback merge-work response; not terminal success",
  "merge-send-confirmed": "wait for merge readback; not terminal success",
  "merge-readback": "classify merge-work readback; not terminal success",
  "merge-output-materialized": "verify merge output and local gates before review",
  "merge-review-request-required": "send candidate to merge-review owner",
  "merge-review-request-sent": "sleep/readback merge-review response; not terminal success",
  "merge-review-readback":
    "classify merge-review response; only explicit merge-review-pass can advance",
};

export function isKnownStateKind(state) {
  return STATE_KINDS.includes(canonicalStateKind(state));
}

export function isSuccessClassification(value) {
  return SUCCESS_CLASSIFICATIONS.includes(canonicalStateKind(value));
}

export function permissionsFor(state) {
  state = canonicalStateKind(state);
  const p = {};
  for (const key of PERMISSION_KEYS) {
    p[key] = false;
  }
  if (state === "allowed-to-create-worktree") {
    p.createWorktree = true;
  } else if (state === "allowed-to-implement") {
    p.implement = true;
  } else if (state === "allowed-to-return-artifact") {
    p.returnArtifact = true;
  } else if (state === "allowed-to-send-review") {
    p.sendReview = true;
  } else if (state === "ready-for-merge-review") {
    p.readyForMergeReview = true;
  } else if (state === "merge-ready") {
    p.mergeReady = true;
  }
  return p;
}

export function nextActionFor(state) {
  const key = canonicalStateKind(state);
  if (Object.prototype.hasOwnProperty.call(NEXT_ACTIONS, key)) {
    return NEXT_ACTIONS[key];
  }
  return "fail closed if state transition is unclear";
}

export function resultRow(
  classification,
  nextState,
  evidence = null,
  retry = false,
  reason = null,
  auto = null,
) {
  classification = canonicalStateKind(classification);
  nextState = canonicalStateKind(nextState);
  const row = {
    kind: "ops-thread-fsm.classification.v1",
    classification,
    stateKind: classification,
    nextStateKind: nextState,
    evidence: pyOr(evidence, []),
    retry,
    retryReason: reason,
    permissions: permissionsFor(nextState),
    writes: false,
    sends: false,
    nextAction: nextActionFor(nextState),
  };
  if (auto !== null) {
    row.autoContinue = auto;
  }
  return row;
}
