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

export function validateIssue(value, label, repository) {
  const row = object(value, label);
  exactKeys(row, [
    "bodySha256",
    "databaseId",
    "marker",
    "nodeId",
    "number",
    "repository",
    "state",
    "updatedAt",
    "url",
  ], label);
  assert.equal(row.repository, repository, `${label}.repository mismatch`);
  positiveInteger(row.number, `${label}.number`);
  positiveInteger(row.databaseId, `${label}.databaseId`);
  nonEmpty(row.nodeId, `${label}.nodeId`);
  assert.equal(row.state, "open", `${label}.state must be open`);
  timestamp(row.updatedAt, `${label}.updatedAt`);
  nonEmpty(row.marker, `${label}.marker`);
  digest(row.bodySha256, `${label}.bodySha256`);
  assert.equal(row.url, `https://github.com/${repository}/issues/${row.number}`, `${label}.url mismatch`);
  return row;
}

export function validatePullRequest(value, label, repository, stage) {
  const row = object(value, label);
  exactKeys(row, [
    "base",
    "draft",
    "evaluated",
    "merge",
    "number",
    "repository",
    "state",
    "terminal",
    "url",
  ], label);
  assert.equal(row.repository, repository, `${label}.repository mismatch`);
  positiveInteger(row.number, `${label}.number`);
  assert.equal(row.url, `https://github.com/${repository}/pull/${row.number}`, `${label}.url mismatch`);
  boolean(row.draft, `${label}.draft`);
  assert.equal(row.draft, false, `${label}.draft must be false at terminal gate`);
  validateCommitTree(row.base, `${label}.base`);
  validateCommitTree(row.terminal, `${label}.terminal`, "head", "tree");
  validateCommitTree(row.evaluated, `${label}.evaluated`);
  const merge = object(row.merge, `${label}.merge`);
  exactKeys(merge, ["commit", "state", "tree"], `${label}.merge`);

  if (stage === "candidate") {
    assert.equal(row.state, "open", `${label}.state must be open at candidate stage`);
    assert.equal(merge.state, "unmerged", `${label}.merge.state mismatch`);
    assert.equal(merge.commit, null, `${label}.merge.commit must be null before merge`);
    assert.equal(merge.tree, null, `${label}.merge.tree must be null before merge`);
    assert.equal(row.evaluated.commit, row.terminal.head, `${label}.evaluated commit must equal terminal head`);
    assert.equal(row.evaluated.tree, row.terminal.tree, `${label}.evaluated tree must equal terminal tree`);
  } else {
    assert.equal(stage, "merged", "provider snapshot stage changed");
    assert.equal(row.state, "closed", `${label}.state must be closed at merged stage`);
    assert.equal(merge.state, "merged", `${label}.merge.state mismatch`);
    sha1(merge.commit, `${label}.merge.commit`);
    sha1(merge.tree, `${label}.merge.tree`);
    assert.equal(row.evaluated.commit, merge.commit, `${label}.evaluated commit must equal merge commit`);
    assert.equal(row.evaluated.tree, merge.tree, `${label}.evaluated tree must equal merge tree`);
  }
  return row;
}

