import assert from "node:assert/strict";
import {
  array,
  boolean,
  digest,
  exactKeys,
  httpsUrl,
  nonEmpty,
  nonNegativeInteger,
  object,
  positiveInteger,
  sha1,
  timestamp,
  validateCommitTree,
} from "./contract-core.mjs";

export function validateCheckEvidence(value, label, expected, repository) {
  const row = object(value, label);
  exactKeys(row, [
    "actualHead",
    "actualTree",
    "conclusion",
    "context",
    "evidenceSha256",
    "expectedHead",
    "expectedTree",
    "jobId",
    "jobUrl",
    "runAttempt",
    "runId",
    "runUrl",
  ], label);
  nonEmpty(row.context, `${label}.context`);
  positiveInteger(row.runId, `${label}.runId`);
  positiveInteger(row.runAttempt, `${label}.runAttempt`);
  positiveInteger(row.jobId, `${label}.jobId`);
  assert.equal(row.runUrl, `https://github.com/${repository}/actions/runs/${row.runId}`, `${label}.runUrl mismatch`);
  assert.equal(row.jobUrl, `https://github.com/${repository}/actions/runs/${row.runId}/job/${row.jobId}`, `${label}.jobUrl mismatch`);
  digest(row.evidenceSha256, `${label}.evidenceSha256`);
  sha1(row.expectedHead, `${label}.expectedHead`);
  sha1(row.actualHead, `${label}.actualHead`);
  sha1(row.expectedTree, `${label}.expectedTree`);
  sha1(row.actualTree, `${label}.actualTree`);
  assert.equal(row.conclusion, "success", `${label}.conclusion must be success`);
  assert.equal(row.expectedHead, expected.commit, `${label}.expectedHead mismatch`);
  assert.equal(row.actualHead, expected.commit, `${label}.actualHead mismatch`);
  assert.equal(row.expectedTree, expected.tree, `${label}.expectedTree mismatch`);
  assert.equal(row.actualTree, expected.tree, `${label}.actualTree mismatch`);
  return row;
}

export function validateCheckSet(value, label, expected, repository) {
  const row = object(value, label);
  exactKeys(row, ["evidence", "required"], label);
  const required = array(row.required, `${label}.required`);
  assert(required.length > 0, `${label}.required must not be empty`);
  for (const [index, context] of required.entries()) nonEmpty(context, `${label}.required[${index}]`);
  assert.equal(new Set(required).size, required.length, `${label}.required contains duplicates`);
  const evidence = array(row.evidence, `${label}.evidence`);
  assert.equal(evidence.length, required.length, `${label}.evidence count mismatch`);
  const contexts = evidence.map((item, index) => validateCheckEvidence(item, `${label}.evidence[${index}]`, expected, repository).context);
  assert.deepEqual([...contexts].sort(), [...required].sort(), `${label} required/evidence contexts mismatch`);
  return row;
}

export function validateReview(value, label, pr, role) {
  const row = object(value, label);
  const expectedKeys = role === "r"
    ? ["conclusion", "id", "targetHead", "targetTree", "unresolved", "url"]
    : ["conclusion", "id", "targetHead", "targetTree", "url"];
  exactKeys(row, expectedKeys, label);
  positiveInteger(row.id, `${label}.id`);
  httpsUrl(row.url, `${label}.url`);
  sha1(row.targetHead, `${label}.targetHead`);
  sha1(row.targetTree, `${label}.targetTree`);
  assert.equal(row.targetHead, pr.terminal.head, `${label}.targetHead mismatch`);
  assert.equal(row.targetTree, pr.terminal.tree, `${label}.targetTree mismatch`);
  const fragment = role === "r" ? "pullrequestreview" : "issuecomment";
  assert.equal(row.url, `${pr.url}#${fragment}-${row.id}`, `${label}.url mismatch`);
  if (role === "r") {
    assert.equal(row.conclusion, "GREEN", `${label}.conclusion must be GREEN`);
    nonNegativeInteger(row.unresolved, `${label}.unresolved`);
    assert.equal(row.unresolved, 0, `${label}.unresolved must be 0`);
  } else {
    assert.equal(row.conclusion, "READY_FOR_R", `${label}.conclusion must be READY_FOR_R`);
  }
  return row;
}

