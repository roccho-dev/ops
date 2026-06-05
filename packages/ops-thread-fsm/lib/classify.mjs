// Readback classification for ops-thread-fsm.
// Node ESM port of classify.py (stdlib only, behavior-identical).

import { nextActionFor, permissionsFor } from "./state_model.mjs";
import { pyOr, splitlines } from "./pyhelpers.mjs";

export const OUTPUT_MARKERS = [
  "BEGIN_B64_FILE",
  "RUN_REPORT",
  "MATERIALIZE_MANIFEST",
  "diff --git",
  "file tree",
  "patch",
];
export const DONE_MARKERS = ["できた", "done", "complete", "completed"];
export const LOCAL_GATE_FAIL = ["local-gate-fail", "local gate fail", "test fail", "tests failed"];
export const REJECT = [
  "impl-review-reject",
  "merge-review-reject",
  "review-reject",
  "reject",
  "差し戻し",
  "failed",
];

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function _text(value) {
  if (typeof value === "string") {
    return value;
  }
  if (isPlainObject(value)) {
    return Object.values(value)
      .map((v) => _text(v))
      .join("\n");
  }
  if (Array.isArray(value)) {
    return value.map((v) => _text(v)).join("\n");
  }
  if (value === null || value === undefined) {
    return "";
  }
  // Python str() rendering for primitives.
  if (value === true) return "True";
  if (value === false) return "False";
  return String(value);
}

function _streaming(value) {
  if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (String(key).replace(/_/g, "").toLowerCase() === "isstreaming" && item === true) {
        return true;
      }
      if (_streaming(item)) {
        return true;
      }
    }
  }
  if (Array.isArray(value)) {
    return value.some((item) => _streaming(item));
  }
  return false;
}

function _firstLine(text) {
  for (let line of splitlines(text)) {
    line = line.trim();
    if (line) {
      return line;
    }
  }
  return "";
}

function _contains(text, needles) {
  const lower = text.toLowerCase();
  return needles.filter((needle) => lower.includes(needle.toLowerCase()));
}

function _structuredVerdict(line, token) {
  const low = line.toLowerCase();
  token = token.toLowerCase();
  return [
    token,
    `verdict: ${token}`,
    `verdict=${token}`,
    `status: ${token}`,
    `status=${token}`,
    `result: ${token}`,
    `result=${token}`,
  ].includes(low);
}

function _row(classification, nextState, evidence = null, retry = false, reason = null) {
  return {
    kind: "ops-thread-fsm.classification.v1",
    classification,
    nextStateKind: nextState,
    evidence: pyOr(evidence, []),
    retry,
    retryReason: reason,
    isStreaming: classification === "streaming",
    permissions: permissionsFor(nextState),
    writes: false,
    sends: false,
    nextAction: nextActionFor(nextState),
  };
}

export function classifyReadbackValue(value, phase, requestKind) {
  const text = _text(value);
  if (_streaming(value)) {
    return _row("streaming", "sleeping-900", ["isStreaming:true"], true, "readback still streaming");
  }
  const gateFail = _contains(text, LOCAL_GATE_FAIL);
  if (gateFail.length) {
    return _row("local-gate-fail", "request-sent", gateFail, true, "local gate failed");
  }
  if (requestKind === "impl-review" || requestKind === "merge-review") {
    const passToken = `${requestKind}-pass`;
    const rejectToken = `${requestKind}-reject`;
    const first = _firstLine(text);
    if (_structuredVerdict(first, rejectToken) || _contains(text, REJECT).length) {
      return _row(`${requestKind}-reject`, "request-sent", first ? [first] : [], true, "review rejected");
    }
    if (_structuredVerdict(first, passToken)) {
      return _row(passToken, passToken, [first]);
    }
    const evidence = _contains(text, ["review-pass", "pass", "passed", "合格", passToken]);
    return _row(
      `${requestKind}-pending`,
      "request-sent",
      evidence,
      true,
      `missing first-line ${passToken}/${rejectToken} verdict`,
    );
  }
  const evidence = _contains(text, OUTPUT_MARKERS);
  if (evidence.length) {
    return _row("output-candidate", "output-materialized", evidence);
  }
  return _row("output-missing", "request-sent", _contains(text, DONE_MARKERS), true, "no materializable output");
}
