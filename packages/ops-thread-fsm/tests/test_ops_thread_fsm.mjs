#!/usr/bin/env node
// Behavior tests for ops-thread-fsm (Node port of test_ops_thread_fsm.py).
// Spawns the bin via node and asserts on parsed JSON output.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

process.on("unhandledRejection", (e) => {
  console.error(e);
  process.exit(1);
});

const R = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const B = path.join(R, "bin", "ops-thread-fsm.mjs");
const C = JSON.parse(fs.readFileSync(path.join(R, "tests", "fixtures", "cases.json"), "utf-8"));

function assert(cond, message) {
  if (!cond) {
    throw new Error("AssertionError" + (message ? ": " + message : ""));
  }
}
function assertEqual(a, b, message) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`AssertionError: ${JSON.stringify(a)} != ${JSON.stringify(b)}${message ? " (" + message + ")" : ""}`);
  }
}
function assertNotEqual(a, b, message) {
  if (JSON.stringify(a) === JSON.stringify(b)) {
    throw new Error(`AssertionError: ${JSON.stringify(a)} == ${JSON.stringify(b)}${message ? " (" + message + ")" : ""}`);
  }
}
function assertTrue(v, m) {
  assert(v === true || (v && v !== false), m);
}
function assertFalse(v, m) {
  assert(!v, m);
}
function assertIn(needle, haystack, m) {
  if (Array.isArray(haystack)) {
    assert(haystack.includes(needle), m);
  } else {
    assert(String(haystack).includes(needle), m);
  }
}

let tmpDir;
function setUp() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ops-thread-fsm-test-"));
}
function tearDown() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function f(name, x) {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, typeof x === "string" ? x : JSON.stringify(x));
  return p;
}

function j(...a) {
  const proc = spawnSync(process.execPath, [B, ...a], { encoding: "utf-8" });
  return JSON.parse(proc.stdout);
}

function cr(x, k = "work", ph = "impl") {
  return j("classify-readback", "--input", f("r.json", x), "--phase", ph, "--request-kind", k, "--json");
}
function pl(x) {
  return j("evaluate-plan", "--input", f("p.json", x), "--json");
}

function safe(overrides = {}) {
  const p = {
    planComplete: true,
    preAuthorized: true,
    localBaseEvidenceValid: true,
    successConditionsPresent: true,
    failureConditionsPresent: true,
    gatesPresent: true,
    reportableEvidencePresent: true,
    worktreeBranchAbsent: true,
    noMerge: true,
    noPush: true,
    noOverwrite: true,
    localBaseEvidence: "local base abc123",
    baseEvidence: "ops/specs base",
    upstreamEvidence: "local upstream",
    headEvidence: "candidate head",
    worktreeEvidence: "absent worktree",
    branchEvidence: "absent branch",
    successConditionsEvidence: "success conditions",
    failureConditionsEvidence: "failure conditions",
    gatesEvidence: "required gates",
    reportableEvidence: "reportable evidence",
  };
  Object.assign(p, overrides);
  return p;
}

const TESTS = {
  test_request_sent_sleep_900_no_writes_or_sends() {
    const r = j("next", "--state-kind", "request-sent", "--dry-run", "--json");
    assertIn("sleep 900", r.nextAction);
    assertFalse(r.writes);
    assertFalse(r.sends);
  },
  test_streaming_and_gate_specific_review_verdicts() {
    assertEqual(cr(C.streaming).nextStateKind, "sleeping-900");
    assertEqual(cr({ text: "impl-review-pass\nok" }, "impl-review").classification, "impl-review-pass");
    assertEqual(cr({ text: "verdict: merge-review-pass\nok" }, "merge-review", "merge").classification, "merge-review-pass");
    for (const x of ["review-pass 合格", "pass", "not impl-review-pass", "do not emit impl-review-pass"]) {
      assertNotEqual(cr({ text: x }, "impl-review").classification, "impl-review-pass");
    }
    assertNotEqual(cr({ text: "impl-review-pass\nok" }, "merge-review", "merge").classification, "merge-review-pass");
  },
  test_false_and_real_blocker() {
    assertEqual(
      pl({ blockerClaim: "cannot connect", readbackDisprovesBlocker: true, readbackEvidence: "thread exists" }).classification,
      "false-blocker",
    );
    assertEqual(pl({ blockerClaim: "cannot connect", blockerEvidence: true }).classification, "real-blocker");
    assertEqual(pl({ blockerClaim: "thread not created" }).classification, "insufficient-plan");
  },
  test_safe_auto_continue_and_missing_safety_proofs() {
    let r = pl(safe());
    assertEqual(r.nextStateKind, "state-allowed-to-proceed-without-extra-user-agreement");
    assertTrue(r.autoContinue);
    for (const k of ["noMerge", "noPush", "noOverwrite"]) {
      const p = safe();
      delete p[k];
      r = pl(p);
      assertEqual(r.classification, "insufficient-plan");
      assertIn(k, r.missingEvidence);
      r = pl(safe({ [k]: false }));
      assertEqual(r.classification, "escalation-needed");
      assertFalse(r.permissions.implement);
    }
    r = pl(safe({ preAuthorized: false }));
    assertEqual(r.nextStateKind, "state-requiring-user-gen0-agreement");
    assertFalse(r.autoContinue);
  },
  test_allowed_to_implement_is_not_merge_or_handoff() {
    const p = j("next", "--state-kind", "allowed-to-implement", "--dry-run", "--json").permissions;
    assertTrue(p.implement);
    for (const k of [
      "createWorktree",
      "returnArtifact",
      "sendReview",
      "readyForMergeReview",
      "mergeReady",
      "canonicalMerge",
      "push",
      "overwrite",
    ]) {
      assertFalse(p[k]);
    }
  },
  test_handoff_created_is_nonterminal_and_localize_classifier() {
    const h = j("next", "--state-kind", "handoff-created", "--dry-run", "--json");
    assertFalse(Object.values(h.permissions).some((v) => v));
    assertIn("non-terminal", h.nextAction);
    const stale = j("classify-localize", "--input", f("stale.json", { policyFresh: false }), "--json");
    assertEqual(stale.stateKind, "stale-policy-claim");
    const drift = j("classify-localize", "--input", f("drift.json", { policyFresh: true, canonicalNoDrift: false }), "--json");
    assertEqual(drift.stateKind, "stale-canonical-head");
    const project = j(
      "classify-localize",
      "--input",
      f("project.json", { policyFresh: true, canonicalNoDrift: true, projectHandoffSent: true }),
      "--json",
    );
    assertEqual(project.stateKind, "project-handoff-sent");
    const ready = j(
      "classify-localize",
      "--input",
      f("ready.json", { policyFresh: true, canonicalNoDrift: true, mergeReviewPass: true, localGatePass: true, runReportPresent: true }),
      "--json",
    );
    assertEqual(ready.stateKind, "localizer-ready");
    assertTrue(ready.ready);
  },
  test_ready_for_review_and_merge_review_boundary() {
    const m = f("m.json", C.manifest);
    const i = f("i.json", { text: "impl-review-pass\nok" });
    const g = f("g.json", { ok: true });
    const r = f("RUN_REPORT.md", "ok\n");
    const a = ["check-ready", "--delivery", m, "--impl-review", i, "--local-gate", g, "--run-report", r, "--json"];
    let x = j(...a);
    assertTrue(x.readyForMergeReview);
    assertFalse(x.mergeReady);
    const aPrefix = a.slice(0, -1);
    x = j(...aPrefix, "--merge-review", f("mr.json", { text: "review-pass 合格" }), "--target", "merge-ready", "--json");
    assertFalse(x.mergeReady);
    x = j(...aPrefix, "--merge-review", f("mr2.json", { text: "merge-review-pass\nok" }), "--target", "merge-ready", "--json");
    assertTrue(x.mergeReady);
  },
  test_discussion_same_revision_gate() {
    const base = { discussionId: "d1", proposalRevision: "r3", noObjectionsRequiredFrom: ["A", "B"] };
    const ok = {
      ...base,
      responses: [
        { actorId: "A", proposalRevision: "r3", verdict: "NO_UNRESOLVED_OBJECTIONS" },
        { actorId: "B", proposalRevision: "r3", verdict: "NO_UNRESOLVED_OBJECTIONS" },
      ],
    };
    let x = j("check-discussion", "--input", f("d-ok.json", ok), "--json");
    assertEqual(x.classification, "discussion-no-objections-confirmed");
    assertTrue(x.discussionComplete);
    const missing = { ...base, responses: [{ actorId: "A", proposalRevision: "r3", verdict: "NO_UNRESOLVED_OBJECTIONS" }] };
    x = j("check-discussion", "--input", f("d-missing.json", missing), "--json");
    assertEqual(x.classification, "discussion-response-required");
    assertEqual(x.missingCounterparties, ["B"]);
    const stale = {
      ...base,
      responses: [
        { actorId: "A", proposalRevision: "r2", verdict: "NO_UNRESOLVED_OBJECTIONS" },
        { actorId: "B", proposalRevision: "r3", verdict: "NO_UNRESOLVED_OBJECTIONS" },
      ],
    };
    x = j("check-discussion", "--input", f("d-stale.json", stale), "--json");
    assertEqual(x.classification, "discussion-response-required");
    assertEqual(x.missingCounterparties, ["A"]);
    const obj = {
      ...base,
      responses: [
        { actorId: "A", proposalRevision: "r3", verdict: "NO_UNRESOLVED_OBJECTIONS" },
        { actorId: "B", proposalRevision: "r3", verdict: "UNRESOLVED_OBJECTIONS", objections: [{ objectionId: "B1", objectionText: "missing continuation states" }] },
      ],
    };
    x = j("check-discussion", "--input", f("d-obj.json", obj), "--json");
    assertEqual(x.classification, "discussion-objections-present");
    assertFalse(x.discussionComplete);
    const parent = {
      ...base,
      responses: [
        { actorId: "A", proposalRevision: "r3", verdict: "NO_UNRESOLVED_OBJECTIONS" },
        { actorId: "B", proposalRevision: "r3", verdict: "UNRESOLVED_OBJECTIONS", objections: [{ objectionId: "B2", objectionText: "needs user choice", requiresParentDecision: true }] },
      ],
    };
    x = j("check-discussion", "--input", f("d-parent.json", parent), "--json");
    assertEqual(x.classification, "discussion-blocked-needs-parent");
  },
  test_facilitate_discussion_wrapper() {
    const base = {
      discussionId: "d2",
      proposalRevision: "v4",
      projectSourceEntrypoint: "ROUND.md",
      versionedProposalRef: "ROUND.md",
      policySnapshotRef: "POLICY.md",
      purposeLineage: { 3: "exact MMD accepted", 2: "two-thread review convergence", 1: "shared UI/MCP design", 0: "recoverable actor/repo operation" },
      reviewQualityChecks: ["KISS", "DRY", "SOLID", "YAGNI"],
      threads: [
        { actorId: "A", threadUrl: "https://example/A", threadFunction: "impl-review" },
        { actorId: "B", threadUrl: "https://example/B", threadFunction: "impl-review" },
      ],
    };
    let x = j("facilitate-discussion", "--input", f("fac-start.json", base), "--json");
    assertEqual(x.classification, "facilitation-round-send-required");
    assertEqual(x.missingCounterparties, ["A", "B"]);
    assertEqual(x.threadControls.length, 2);
    assertIn("Project Source", x.nextAction);
    const ok = {
      ...base,
      acceptedMarkers: ["exact corrected MMD accepted"],
      objectionMarkers: ["exact corrected MMD has objections"],
      responses: [
        { actorId: "A", proposalRevision: "v4", assistantText: "exact corrected MMD accepted" },
        { actorId: "B", proposalRevision: "v4", assistantText: "proposalVersion: accepted\nexact corrected MMD accepted" },
      ],
    };
    x = j("facilitate-discussion", "--input", f("fac-ok.json", ok), "--json");
    assertEqual(x.classification, "facilitation-no-objections-confirmed");
    assertTrue(x.discussionComplete);
    const obj = {
      ...base,
      acceptedMarkers: ["accepted"],
      objectionMarkers: ["has objections"],
      responses: [
        { actorId: "A", proposalRevision: "v4", assistantText: "accepted" },
        { actorId: "B", proposalRevision: "v4", assistantText: "has objections", objections: [{ objectionText: "label unclear" }] },
      ],
    };
    x = j("facilitate-discussion", "--input", f("fac-obj.json", obj), "--json");
    assertEqual(x.classification, "facilitation-revision-update-required");
    assertEqual(x.requiredNextArtifact, "new versioned proposal with accepted/rejected/modified objection handling");
  },
  test_facilitate_discussion_requires_bootstrap_context() {
    const x = j("facilitate-discussion", "--input", f("fac-missing.json", { discussionId: "d3", proposalRevision: "v1" }), "--json");
    assertEqual(x.classification, "facilitation-context-incomplete");
    assertIn("purposeLineage depth 3..0", x.missingFields);
  },
};

function run() {
  const names = Object.keys(TESTS).sort();
  for (const name of names) {
    setUp();
    try {
      TESTS[name]();
    } finally {
      tearDown();
    }
    process.stdout.write(`ok ${name}\n`);
  }
  process.stdout.write(`ran ${names.length} tests\n`);
}

run();
