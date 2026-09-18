import assert from "node:assert/strict";
import { PROVIDER_SNAPSHOT_SCHEMA, digest, exactKeys, object, timestamp, validateCommitTree } from "./contract-core.mjs";
import { validateIssue, validatePullRequest } from "./provider-targets.mjs";
import { validateCheckSet, validateReview } from "./provider-evidence.mjs";

export function validateProviderSnapshot(value) {
  const snapshot = object(value, "provider snapshot");
  exactKeys(snapshot, [
    "authority",
    "capturedAt",
    "checks",
    "issues",
    "pullRequests",
    "repositories",
    "reviews",
    "schema",
    "source",
    "stage",
  ], "provider snapshot");
  assert.equal(snapshot.schema, PROVIDER_SNAPSHOT_SCHEMA, "provider snapshot schema mismatch");
  assert.equal(snapshot.authority, false, "provider snapshot must not claim authority");
  assert(["candidate", "merged"].includes(snapshot.stage), "provider snapshot stage changed");
  timestamp(snapshot.capturedAt, "provider snapshot.capturedAt");
  const source = object(snapshot.source, "provider snapshot.source");
  exactKeys(source, ["collectorRole", "provider", "rawSha256"], "provider snapshot.source");
  assert(["D", "R"].includes(source.collectorRole), "provider snapshot collectorRole must be D or R");
  assert.equal(source.provider, "github", "provider snapshot provider mismatch");
  digest(source.rawSha256, "provider snapshot.source.rawSha256");

  const issues = object(snapshot.issues, "provider snapshot.issues");
  exactKeys(issues, ["ops", "ui"], "provider snapshot.issues");
  validateIssue(issues.ui, "provider snapshot.issues.ui", "roccho-dev/ui");
  validateIssue(issues.ops, "provider snapshot.issues.ops", "roccho-dev/ops");

  const pullRequests = object(snapshot.pullRequests, "provider snapshot.pullRequests");
  exactKeys(pullRequests, ["ops", "ui"], "provider snapshot.pullRequests");
  const uiPr = validatePullRequest(pullRequests.ui, "provider snapshot.pullRequests.ui", "roccho-dev/ui", snapshot.stage);
  const opsPr = validatePullRequest(pullRequests.ops, "provider snapshot.pullRequests.ops", "roccho-dev/ops", snapshot.stage);

  const repositories = object(snapshot.repositories, "provider snapshot.repositories");
  exactKeys(repositories, ["mobileAgent"], "provider snapshot.repositories");
  const mobile = object(repositories.mobileAgent, "provider snapshot.repositories.mobileAgent");
  exactKeys(mobile, ["evaluated", "repository"], "provider snapshot.repositories.mobileAgent");
  assert.equal(mobile.repository, "roccho-dev/mobile-agent", "mobileAgent repository mismatch");
  validateCommitTree(mobile.evaluated, "provider snapshot.repositories.mobileAgent.evaluated");

  const checks = object(snapshot.checks, "provider snapshot.checks");
  exactKeys(checks, ["mobileAgent", "ops", "ui"], "provider snapshot.checks");
  validateCheckSet(checks.mobileAgent, "provider snapshot.checks.mobileAgent", mobile.evaluated, mobile.repository);
  validateCheckSet(checks.ui, "provider snapshot.checks.ui", uiPr.evaluated, uiPr.repository);
  validateCheckSet(checks.ops, "provider snapshot.checks.ops", opsPr.evaluated, opsPr.repository);

  const reviews = object(snapshot.reviews, "provider snapshot.reviews");
  exactKeys(reviews, ["ops", "ui"], "provider snapshot.reviews");
  for (const [name, pr] of [["ui", uiPr], ["ops", opsPr]]) {
    const lane = object(reviews[name], `provider snapshot.reviews.${name}`);
    exactKeys(lane, ["r", "w"], `provider snapshot.reviews.${name}`);
    validateReview(lane.w, `provider snapshot.reviews.${name}.w`, pr, "w");
    validateReview(lane.r, `provider snapshot.reviews.${name}.r`, pr, "r");
  }
  return snapshot;
}


export function findCheck(snapshot, lane, context) {
  const check = snapshot.checks[lane].evidence.find((row) => row.context === context);
  assert(check, `${lane} required check context not found: ${context}`);
  return check;
}

