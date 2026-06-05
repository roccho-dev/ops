#!/usr/bin/env node
// Unit tests for plan/blocker classification (Node port of
// test_plan_review_blockers.py). Imports the lib modules directly.

import process from "node:process";

import { classify as coreClassify } from "../lib/core.mjs";
import { evaluatePlanValue } from "../lib/plan.mjs";
import { PLAN_ACCEPTED, canonicalStateKind } from "../lib/state_model.mjs";

process.on("unhandledRejection", (e) => {
  console.error(e);
  process.exit(1);
});

function assert(cond, message) {
  if (!cond) {
    throw new Error("AssertionError" + (message ? ": " + message : ""));
  }
}

function completePayload(overrides = {}) {
  const payload = {
    planComplete: true,
    localBaseEvidenceValid: true,
    successConditionsPresent: true,
    failureConditionsPresent: true,
    gatesPresent: true,
    reportableEvidencePresent: true,
    worktreeBranchAbsent: true,
    noMerge: true,
    noPush: true,
    noOverwrite: true,
    preAuthorized: true,
    localBaseEvidence: "local base abc123 from git merge-base readback",
    baseEvidence: "base origin/main abc123",
    upstreamEvidence: "upstream origin/main def456",
    headEvidence: "candidate head 56977c1",
    worktreeEvidence: "worktree /tmp/wt is isolated",
    branchEvidence: "branch task/ops-fsm-safe-continue-20260509",
    successConditionsEvidence: "success requires impl-review acceptance",
    failureConditionsEvidence: "failure if merge/push/overwrite is requested",
    gatesEvidence: "run pytest for ops-thread-fsm",
    reportableEvidence: "report changed files and gate results",
  };
  Object.assign(payload, overrides);
  return payload;
}

const TESTS = {
  test_plan_accepted_is_canonical_for_legacy_state_kind_alias() {
    assert(canonicalStateKind("accepted" + "-plan") === PLAN_ACCEPTED);
    const result = coreClassify(null, { stateKind: "accepted" + "-plan" });
    assert(result.classification === "plan-accepted");
    assert(result.stateKind === "plan-accepted");
  },
  test_safe_auto_continue_requires_concrete_evidence_not_only_booleans() {
    const payload = completePayload({ localBaseEvidence: true });
    const result = evaluatePlanValue(payload);
    assert(result.classification === "insufficient-plan");
    assert(result.missingEvidence.includes("localBase"));
  },
  test_safe_auto_continue_accepts_only_with_all_concrete_evidence() {
    const result = evaluatePlanValue(completePayload());
    assert(result.classification === "plan-accepted");
    assert(result.stateKind === "plan-accepted");
    assert(result.autoContinue === true);
    assert(Object.prototype.hasOwnProperty.call(result.evidence, "localBase"));
    assert(Object.prototype.hasOwnProperty.call(result.evidence, "reportableEvidence"));
  },
  test_false_blocker_requires_readback_evidence() {
    const result = evaluatePlanValue({
      readbackDisprovesBlocker: true,
      blockerClaim: "review claimed worktree evidence is absent",
    });
    assert(result.classification === "insufficient-plan");
    assert(result.missingEvidence.includes("readbackEvidence"));
  },
  test_false_blocker_emits_readback_evidence_when_present() {
    const result = evaluatePlanValue({
      readbackDisprovesBlocker: true,
      blockerClaim: "review claimed worktree evidence is absent",
      readbackEvidence: "review readback line shows worktree evidence is present",
    });
    assert(result.classification === "false-blocker");
    assert(Object.prototype.hasOwnProperty.call(result.evidence, "readbackEvidence"));
  },
  test_destructive_scope_takes_precedence_over_false_blocker() {
    const result = evaluatePlanValue({
      readbackDisprovesBlocker: true,
      blockerClaim: "review claimed worktree evidence is absent",
      readbackEvidence: "review readback line shows worktree evidence is present",
      mergeRequested: true,
      noMerge: false,
    });
    assert(result.classification === "escalation-needed");
    assert(result.nextStateKind === "escalation-needed");
  },
};

const names = Object.keys(TESTS).sort();
for (const name of names) {
  TESTS[name]();
  process.stdout.write(`ok ${name}\n`);
}
process.stdout.write(`ran ${names.length} tests\n`);
