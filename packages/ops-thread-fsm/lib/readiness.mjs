// Readiness checks for ops-thread-fsm.
//
// This module only inspects evidence files. It does not run gates, materialize
// artifacts, send reviews, push, merge, or perform CDP/external-thread work.
//
// Node ESM port of readiness.py (stdlib only, behavior-identical).

import fs from "node:fs";

import { classifyReadbackValue, deliveryManifestOk, loadValue, readableFile } from "./core.mjs";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function get(obj, key) {
  if (isPlainObject(obj) && Object.prototype.hasOwnProperty.call(obj, key)) {
    return obj[key];
  }
  return undefined;
}

function _emit(value, jsonMode, scalarKey = "stateKind") {
  if (jsonMode) {
    process.stdout.write(JSON.stringify(value, null, 2) + "\n");
  } else {
    process.stdout.write(String(value[scalarKey]) + "\n");
  }
}

function _read(path) {
  if (!path || !fs.existsSync(path)) {
    return null;
  }
  return loadValue(path);
}

function _reviewOk(path, requestKind) {
  const value = _read(path);
  if (value === null) {
    return false;
  }
  const result = classifyReadbackValue(value, requestKind === "merge-review" ? "merge" : "impl", requestKind);
  return result.classification === `${requestKind}-pass`;
}

function _localGateOk(path) {
  if (!path) {
    return false;
  }
  if (!fs.existsSync(path)) {
    return false;
  }
  const value = loadValue(path);
  if (isPlainObject(value) && value.ok === true) {
    return true;
  }
  const raw = fs.readFileSync(path).toString("utf8").toLowerCase();
  const failMarkers = ["local-gate-fail", "local gate fail", "test fail", "tests failed"];
  const passMarkers = ["local-gate-pass", "local gate pass", "tests passed"];
  return passMarkers.some((marker) => raw.includes(marker)) && !failMarkers.some((marker) => raw.includes(marker));
}

export function buildReadyReport(args) {
  const deliveryPath = args.delivery || args.materialize_manifest;
  const delivery = deliveryManifestOk(deliveryPath);
  const implReview = _reviewOk(args.impl_review || args.review, "impl-review");
  const localGate = _localGateOk(args.local_gate);
  const runReport = readableFile(args.run_report);
  const readyForMergeReview = delivery && implReview && localGate && runReport;
  const mergeReview = _reviewOk(args.merge_review, "merge-review");
  const mergeReady = readyForMergeReview && mergeReview;
  const target = args.target || "ready-for-merge-review";
  const ready = target === "merge-ready" ? mergeReady : readyForMergeReview;
  let state;
  if (target === "merge-ready" && mergeReady) {
    state = "merge-ready";
  } else if (readyForMergeReview) {
    state = "ready-for-merge-review";
  } else {
    state = "not-ready";
  }
  return {
    kind: "ops-thread-fsm.ready.v1",
    ready,
    target,
    stateKind: state,
    readyForMergeReview,
    mergeReady,
    dryRun: Boolean(args.dry_run),
    writes: false,
    sends: false,
    checks: {
      delivery,
      implReview,
      localGate,
      runReport,
      mergeReview,
    },
  };
}

export function cmdCheckReady(args) {
  const report = buildReadyReport(args);
  _emit(report, Boolean(args.json));
  return report.ready ? 0 : 1;
}

function _truthy(value) {
  return (
    value === true ||
    (typeof value === "string" && ["true", "yes", "ok", "pass", "present"].includes(value.trim().toLowerCase()))
  );
}

function _getBool(value, ...keys) {
  for (const key of keys) {
    if (isPlainObject(value) && Object.prototype.hasOwnProperty.call(value, key)) {
      return _truthy(value[key]);
    }
  }
  return false;
}

export function buildLocalizeReport(args) {
  let value = _read(args.input);
  if (!isPlainObject(value)) {
    value = {};
  }
  const evidence = isPlainObject(get(value, "evidence")) ? value.evidence : value;
  const policyFresh = _getBool(evidence, "policyFresh", "latestPolicyRead", "policyReadFresh");
  const canonicalFresh = _getBool(evidence, "canonicalNoDrift", "canonicalHeadMatchesReviewBase", "noDrift");
  const mergeReviewPass = _getBool(evidence, "mergeReviewPass", "merge-review-pass", "mergeReviewPassReceived");
  const localGate = _getBool(evidence, "localGatePass", "localGateOk");
  const runReport =
    _getBool(evidence, "runReportPresent", "runReportReadable") || readableFile(get(value, "runReport"));
  const projectHandoff = _getBool(evidence, "projectHandoffSent", "projectTransportOk");
  const projectReviewReady = _getBool(evidence, "projectReviewReady", "reviewArtifactPresent");
  const localHandoff = _getBool(evidence, "localHandoffReady", "handoffManifestPresent");

  let state;
  let ready;
  let owner;
  let missing;
  if (!policyFresh) {
    state = "stale-policy-claim";
    ready = false;
    owner = "claim-writer";
    missing = ["policyFresh"];
  } else if (!canonicalFresh) {
    state = "stale-canonical-head";
    ready = false;
    owner = "localizer-or-parentActor";
    missing = ["canonicalNoDrift"];
  } else if (mergeReviewPass && localGate && runReport) {
    state = "localizer-ready";
    ready = true;
    owner = "parentActor";
    missing = [];
  } else if (mergeReviewPass) {
    state = "merge-review-pass-received";
    ready = false;
    owner = "localizer-or-parentActor";
    missing = [
      ["localGatePass", localGate],
      ["runReportPresent", runReport],
    ]
      .filter(([, ok]) => !ok)
      .map(([item]) => item);
  } else if (projectReviewReady) {
    state = "project-review-ready";
    ready = false;
    owner = "merge-review";
    missing = ["mergeReviewPass"];
  } else if (projectHandoff) {
    state = "project-handoff-sent";
    ready = false;
    owner = "project-operator";
    missing = ["projectReviewReady", "mergeReviewPass"];
  } else if (localHandoff) {
    state = "local-handoff-ready";
    ready = false;
    owner = "impl-review-or-merge-review";
    missing = ["mergeReviewPass"];
  } else {
    state = "blocked-transport";
    ready = false;
    owner = "ops-cdp-core-or-handoff-owner";
    missing = ["projectHandoffSent or localHandoffReady"];
  }

  return {
    kind: "ops-thread-fsm.localizeReadiness.v1",
    ready,
    stateKind: state,
    requiredOwner: owner,
    missing,
    writes: false,
    sends: false,
    checks: {
      policyFresh,
      canonicalNoDrift: canonicalFresh,
      mergeReviewPass,
      localGatePass: localGate,
      runReportPresent: runReport,
      projectHandoffSent: projectHandoff,
      projectReviewReady,
      localHandoffReady: localHandoff,
    },
  };
}

export function cmdClassifyLocalize(args) {
  const report = buildLocalizeReport(args);
  _emit(report, Boolean(args.json));
  return report.ready ? 0 : 1;
}
