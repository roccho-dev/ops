// Command handlers and public helpers for ops-thread-fsm.
//
// Node ESM port of core.py (stdlib only, behavior-identical).

import { classifyReadbackValue } from "./classify.mjs";
import { checkDiscussionValue, facilitateDiscussionValue } from "./discussion.mjs";
import { deliveryManifestOk, loadValue, readableFile } from "./evidence.mjs";
import { evaluatePlanValue } from "./plan.mjs";
import {
  PLAN_ACCEPTED,
  STATE_KINDS,
  canonicalStateKind,
  nextActionFor,
  permissionsFor,
} from "./state_model.mjs";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function emit(value, jsonMode, scalarKey = null) {
  if (jsonMode) {
    process.stdout.write(JSON.stringify(value, null, 2) + "\n");
  } else if (scalarKey !== null && isPlainObject(value)) {
    process.stdout.write(String(pyDisplay(value[scalarKey])) + "\n");
  } else {
    process.stdout.write(pyDisplay(value) + "\n");
  }
}

// Replicate Python print() of a dict/value when not in JSON mode. The CLI only
// reaches the non-JSON dict path via scalar_key extraction; the bare-dict path
// mirrors Python's repr for dicts (single-quoted) — preserved for parity.
function pyDisplay(value) {
  if (typeof value === "string") return value;
  if (value === true) return "True";
  if (value === false) return "False";
  if (value === null || value === undefined) return "None";
  if (typeof value === "number") return String(value);
  return pyRepr(value);
}

function pyRepr(value) {
  if (typeof value === "string") return "'" + value.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
  if (value === true) return "True";
  if (value === false) return "False";
  if (value === null || value === undefined) return "None";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    return "[" + value.map((v) => pyRepr(v)).join(", ") + "]";
  }
  if (isPlainObject(value)) {
    return (
      "{" +
      Object.entries(value)
        .map(([k, v]) => pyRepr(k) + ": " + pyRepr(v))
        .join(", ") +
      "}"
    );
  }
  return String(value);
}

export function cmdStatus(args) {
  emit(
    {
      kind: "ops-thread-fsm.status.v1",
      states: STATE_KINDS,
      controllerOnly: true,
      canonicalAcceptedPlan: PLAN_ACCEPTED,
      forbiddenMechanics: [
        "CDP",
        "push",
        "refs-vault",
        "artifact materializer",
        "local gate execution",
        "external-thread mechanics",
        "canonical merge",
      ],
    },
    args.json,
  );
  return 0;
}

export function cmdNext(args) {
  const state = canonicalStateKind(args.state_kind);
  if (!STATE_KINDS.includes(state)) {
    process.stderr.write(`unknown state-kind: ${state}\n`);
    return 2;
  }
  const classificationArg =
    args.classification !== undefined && args.classification !== null ? args.classification : null;
  emit(
    {
      kind: "ops-thread-fsm.next.v1",
      stateKind: state,
      phase: args.phase !== undefined ? args.phase : null,
      requestKind: args.request_kind !== undefined ? args.request_kind : null,
      classification: classificationArg ? canonicalStateKind(classificationArg) : null,
      dryRun: args.dry_run,
      writes: false,
      sends: false,
      permissions: permissionsFor(state),
      nextAction: nextActionFor(state),
    },
    args.json,
    "nextAction",
  );
  return 0;
}

export function cmdClassifyReadback(args) {
  const result = classifyReadbackValue(loadValue(args.input), args.phase, args.request_kind);
  emit(result, args.json, "classification");
  if (["output-candidate", "impl-review-pass", "merge-review-pass"].includes(result.classification)) {
    return 0;
  }
  return 1;
}

export function cmdEvaluatePlan(args) {
  const result = evaluatePlanValue(loadValue(args.input));
  emit(result, args.json, "classification");
  if ([PLAN_ACCEPTED, "false-blocker"].includes(result.classification)) {
    return 0;
  }
  return 1;
}

export function cmdCheckDiscussion(args) {
  const result = checkDiscussionValue(loadValue(args.input));
  emit(result, args.json, "classification");
  if (result.classification === "discussion-no-objections-confirmed") {
    return 0;
  }
  return 1;
}

export function cmdFacilitateDiscussion(args) {
  const result = facilitateDiscussionValue(loadValue(args.input));
  emit(result, args.json, "classification");
  if (result.classification === "facilitation-no-objections-confirmed") {
    return 0;
  }
  return 1;
}

export function cmdRenderPrompt() {
  process.stdout.write(
    "Return materializable full-file artifacts plus RUN_REPORT. " +
      "Review gates require first-line impl-review-pass or merge-review-pass only. " +
      "Safe auto-continue requires a complete pre-authorized plan with concrete local base, base, upstream, " +
      "head, worktree, branch, success/failure condition, gate, and reportable evidence; valid local base evidence; " +
      "no merge, no push, no overwrite, branch/worktree absence; and concrete external-thread send confirmation, " +
      "readback, and response evidence when external work is used. " +
      "readbackDisprovesBlocker can emit false-blocker only with concrete readback evidence. " +
      "The canonical accepted-plan token is plan-accepted. " +
      "request-sent means sleep 900, then delegated readback via ops-cdp-core. " +
      "Target handoff is ready-for-merge-review; final readiness additionally requires merge review. " +
      "FSM does not implement CDP, push, refs-vault, artifact materialization, local gates, external-thread mechanics, or canonical merge." +
      "\n",
  );
  return 0;
}

export function classify(payload = null, { stateKind = null } = {}) {
  if (stateKind !== null) {
    const state = canonicalStateKind(stateKind);
    return {
      kind: "ops-thread-fsm.classification.v1",
      classification: state,
      stateKind: state,
      nextStateKind: state,
      evidence: { stateKind: state },
      autoContinue: state === PLAN_ACCEPTED,
      writes: false,
      sends: false,
    };
  }
  return evaluatePlanValue(payload || {});
}

export const classifyPayload = classify;
export const evaluate = classify;
export const evaluatePlan = evaluatePlanValue;
export { checkDiscussionValue, facilitateDiscussionValue, classifyReadbackValue };
export { deliveryManifestOk, loadValue, readableFile };
