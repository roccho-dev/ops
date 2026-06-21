import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  ProjectionError,
  decodeRepoKey,
  encodeRepoPath,
  logicalHeadId,
  normalizeRepoPath,
  parseManagedRemoteRef,
  projectHeadRef,
  repoPathFromBare,
} from "../lib/ref-projection.mjs";

const CASES = [
  "ops",
  "team/a",
  "space repo",
  "日本語/資料",
  "percent%path",
  "tilde~path",
  ".hidden/repo",
  "a..b/c.locked",
  "mixed/Ångström_1-2",
];

test("repo path codec is deterministic, reversible, and one-component", () => {
  const keys = new Set();
  for (const repoPath of CASES) {
    const key = encodeRepoPath(repoPath);
    assert.match(key, /^=r1-[^/]+$/);
    assert.equal(decodeRepoKey(key), normalizeRepoPath(repoPath));
    assert.equal(encodeRepoPath(decodeRepoKey(key)), key);
    assert.equal(keys.has(key), false, `collision for ${repoPath}`);
    keys.add(key);
  }
});

test("path/branch boundary collision is impossible", () => {
  const a = projectHeadRef(encodeRepoPath("a"), "b/main");
  const b = projectHeadRef(encodeRepoPath("a/b"), "main");
  assert.notEqual(a, b);
});

test("current remote refs round-trip to logical identity", () => {
  const repoPath = "group/repo";
  const branch = "proposal/x/y";
  const ref = projectHeadRef(encodeRepoPath(repoPath), branch);
  const parsed = parseManagedRemoteRef(ref);
  assert.equal(parsed.schema, "current-r1");
  assert.equal(parsed.repoPath, repoPath);
  assert.equal(parsed.branch, branch);
  assert.equal(parsed.logicalId, logicalHeadId(repoPath, branch));
});

test("legacy and unknown refs are classified without guessing", () => {
  assert.deepEqual(
    parseManagedRemoteRef("refs/heads/repos/ops/proposal/old"),
    {
      schema: "legacy-repos-v0",
      ref: "refs/heads/repos/ops/proposal/old",
      repoPath: "ops",
      branch: "proposal/old",
    },
  );
  assert.equal(parseManagedRemoteRef("refs/heads/ops/proposal/old").schema, "legacy-flat-v0");
  assert.equal(parseManagedRemoteRef("refs/heads/r1-ops/main").schema, "legacy-flat-v0");
  assert.equal(parseManagedRemoteRef("refs/heads/single").schema, "unknown");
  assert.equal(parseManagedRemoteRef("refs/tags/v1").schema, "outside-managed-root");
});

test("filesystem-schema path is derived from bare root", () => {
  const root = path.join(path.sep, "srv", "bare");
  assert.equal(repoPathFromBare(root, path.join(root, "team", "api.git")), "team/api");
  assert.throws(() => repoPathFromBare(root, path.join(path.sep, "other", "api.git")), ProjectionError);
});

test("non-canonical keys fail closed", () => {
  assert.throws(() => decodeRepoKey("ops"), ProjectionError);
  assert.throws(() => decodeRepoKey("=r1-a%2fb"), ProjectionError);
  assert.throws(() => decodeRepoKey("=r1-a~b"), ProjectionError);
});
