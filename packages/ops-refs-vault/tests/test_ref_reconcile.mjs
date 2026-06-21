import assert from "node:assert/strict";
import test from "node:test";

import { reconcileRefSets } from "../lib/ref-reconcile.mjs";

const expectedBase = {
  logicalId: "ops\0heads\0main",
  repoPath: "ops",
  repoKey: "=r1-ops",
  sourceBarePath: "/bare/ops.git",
  branch: "main",
  sourceRef: "refs/heads/main",
  sourceOid: "a".repeat(40),
  remoteRef: "refs/heads/=r1-ops/main",
};

test("full outer join classifies equal, missing, and relation states", () => {
  const equal = reconcileRefSets([expectedBase], [{ remoteRef: expectedBase.remoteRef, remoteOid: expectedBase.sourceOid, parsed: { schema: "current-r1" } }]);
  assert.equal(equal.ok, true);
  assert.equal(equal.counts.equal, 1);

  const missing = reconcileRefSets([expectedBase], []);
  assert.equal(missing.rows[0].classification, "missing-remote");
  assert.equal(missing.backupSafe, true);

  const ahead = reconcileRefSets(
    [expectedBase],
    [{ remoteRef: expectedBase.remoteRef, remoteOid: "b".repeat(40), parsed: { schema: "current-r1" } }],
    new Map([[expectedBase.remoteRef, { classification: "remote-ahead-candidate" }]]),
  );
  assert.equal(ahead.rows[0].classification, "remote-ahead-candidate");
  assert.equal(ahead.backupSafe, false);
});

test("managed extras retain schema classification", () => {
  const result = reconcileRefSets([], [
    { remoteRef: "refs/heads/=r1-ops/main", remoteOid: "a".repeat(40), parsed: { schema: "current-r1" } },
    { remoteRef: "refs/heads/repos/ops/main", remoteOid: "b".repeat(40), parsed: { schema: "legacy-repos-v0" } },
    { remoteRef: "refs/heads/unparseable", remoteOid: "c".repeat(40), parsed: { schema: "unknown" } },
  ]);
  assert.deepEqual(result.counts, {
    "extra-current-schema": 1,
    "extra-legacy-schema": 1,
    "unknown-managed-extra": 1,
  });
  assert.equal(result.backupSafe, false);
});
