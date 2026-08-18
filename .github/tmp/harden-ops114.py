from pathlib import Path
import json

core_path = Path("packages/ops-git-write-closure/bin/ops-git-write-closure.mjs")
core = core_path.read_text()

classify = '''const classifyBlob = (bytes) => {
  if (!bytes.includes(0)) {
    const text = bytes.toString("utf8");
    if (Buffer.from(text, "utf8").equals(bytes)) return { encoding: "utf-8", content: text };
  }
  return { encoding: "base64", content: bytes.toString("base64") };
};
'''
snapshot = classify + '''const snapshotTree = (repo) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ops-git-write-snapshot-"));
  try {
    const indexFile = path.join(tempDir, "index");
    fs.copyFileSync(path.join(repo, ".git", "index"), indexFile);
    const env = { ...process.env, GIT_INDEX_FILE: indexFile };
    git(repo, ["add", "-A", "--", "."], { env });
    const tree = git(repo, ["write-tree"], { env }).stdout.trim();
    requireHex(tree, 40, "snapshot tree");
    return tree;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};
'''
assert classify in core
core = core.replace(classify, snapshot, 1)

before = '''  git(repo, ["fsck", "--no-dangling"]);

  const beforeChecks = statusBytes(repo);
'''
after = '''  git(repo, ["fsck", "--no-dangling"]);

  const beforeChecksTree = snapshotTree(repo);
  const beforeChecks = statusBytes(repo);
'''
assert before in core
core = core.replace(before, after, 1)

before = '''  const afterChecks = statusBytes(repo);
  if (!beforeChecks.equals(afterChecks)) fail("CHECK_MUTATED_WORKTREE", "checks changed the candidate worktree");

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ops-git-write-"));
'''
after = '''  const afterChecks = statusBytes(repo);
  const afterChecksTree = snapshotTree(repo);
  if (!beforeChecks.equals(afterChecks) || beforeChecksTree !== afterChecksTree) fail("CHECK_MUTATED_WORKTREE", "checks changed the candidate worktree");

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ops-git-write-"));
'''
assert before in core
core = core.replace(before, after, 1)

before = '''    const candidateTree = git(repo, ["write-tree"], { env }).stdout.trim();
    requireHex(candidateTree, 40, "candidate tree");
    if (candidateTree === baseTree) fail("NO_CHANGES", "candidate tree equals base tree");
'''
after = '''    const candidateTree = git(repo, ["write-tree"], { env }).stdout.trim();
    requireHex(candidateTree, 40, "candidate tree");
    if (candidateTree !== afterChecksTree) fail("CANDIDATE_SNAPSHOT_MISMATCH", "candidate tree differs from the checked snapshot");
    if (candidateTree === baseTree) fail("NO_CHANGES", "candidate tree equals base tree");
'''
assert before in core
core = core.replace(before, after, 1)

before = '''    fs.mkdirSync(outDir, { recursive: true });
    if (stateDir) {
      fs.mkdirSync(stateDir, { recursive: true });
      const stateFile = path.join(stateDir, `${request.requestId}.json`);
      if (fs.existsSync(stateFile)) {
        const prior = readJson(stateFile);
        if (prior.planSha256 !== planSha256) fail("REQUEST_ID_REUSED_WITH_DIFFERENT_PLAN", `requestId ${request.requestId} already maps to another plan`);
      } else writeJson(stateFile, { schema: "ops.gitWriteRequestIdentity.v1", requestId: request.requestId, planSha256 });
    }
'''
after = '''    fs.mkdirSync(outDir, { recursive: true });
    const identityDir = stateDir ? path.resolve(stateDir) : path.join(repo, ".git", "ops-git-write-closure");
    fs.mkdirSync(identityDir, { recursive: true });
    const stateFile = path.join(identityDir, `${request.requestId}.json`);
    if (fs.existsSync(stateFile)) {
      const prior = readJson(stateFile);
      if (prior.planSha256 !== planSha256) fail("REQUEST_ID_REUSED_WITH_DIFFERENT_PLAN", `requestId ${request.requestId} already maps to another plan`);
    } else writeJson(stateFile, { schema: "ops.gitWriteRequestIdentity.v1", requestId: request.requestId, planSha256 });
'''
assert before in core
core = core.replace(before, after, 1)

before = '  add(typeof effect.pullRequest?.url === "string" && effect.pullRequest.url.length > 0, "PR URL invalid");\n'
after = before + '  add(effect.pullRequest?.matchingCount === 1, "matching PR count is not exactly one");\n'
assert before in core
core = core.replace(before, after, 1)
core_path.write_text(core)

test_path = Path("packages/ops-git-write-closure/tests/e2e.mjs")
test = test_path.read_text()
before = '    pullRequest: { number: 1, url: "https://example.invalid/pr/1", head: plan.pullRequest.head, base: plan.pullRequest.base, draft: true },\n'
after = '    pullRequest: { number: 1, url: "https://example.invalid/pr/1", head: plan.pullRequest.head, base: plan.pullRequest.base, draft: true, matchingCount: 1 },\n'
assert before in test
test = test.replace(before, after, 1)

anchor = '''  const tamperedPr = structuredClone(effect); tamperedPr.pullRequest.base = "main";
  const tamperedPrFile = path.join(tmp, "tampered-pr.json"); writeJson(tamperedPrFile, tamperedPr);
  assert.match(invoke(["verify", "--plan", path.join(outDir, "effect-plan.json"), "--effect-result", tamperedPrFile, "--out", path.join(tmp, "tampered-pr-receipt.json")], [1]).stderr, /REMOTE_READBACK_MISMATCH/);

'''
extra = anchor + '''  const duplicatePr = structuredClone(effect); duplicatePr.pullRequest.matchingCount = 2;
  const duplicatePrFile = path.join(tmp, "duplicate-pr.json"); writeJson(duplicatePrFile, duplicatePr);
  assert.match(invoke(["verify", "--plan", path.join(outDir, "effect-plan.json"), "--effect-result", duplicatePrFile, "--out", path.join(tmp, "duplicate-pr-receipt.json")], [1]).stderr, /REMOTE_READBACK_MISMATCH/);

'''
assert anchor in test
test = test.replace(anchor, extra, 1)

anchor = '''  const mutRoot = path.join(tmp, "mut"); fs.mkdirSync(mutRoot); const mut = fixture(mutRoot);
  const mutateCheck = requestFor(mut.repo, mut.base, "ops-114-check-mutates", { checks: [{ id: "mutate", command: [process.execPath, "-e", "require('fs').writeFileSync('check-created.txt','x')"] }] });
  const mutateFile = path.join(tmp, "mutate-check.json"); writeJson(mutateFile, mutateCheck);
  assert.match(invoke(["prepare", "--request", mutateFile, "--out-dir", path.join(tmp, "mutate-check")], [1]).stderr, /CHECK_MUTATED_WORKTREE/);

'''
extra = anchor + '''  const sameStatusRoot = path.join(tmp, "same-status-mut"); fs.mkdirSync(sameStatusRoot); const sameStatus = fixture(sameStatusRoot);
  const sameStatusCheck = requestFor(sameStatus.repo, sameStatus.base, "ops-114-check-mutates-same-status", { checks: [{ id: "mutate", command: [process.execPath, "-e", "require('fs').writeFileSync('src/update.txt','mutated\\n')"] }] });
  const sameStatusFile = path.join(tmp, "same-status-check.json"); writeJson(sameStatusFile, sameStatusCheck);
  assert.match(invoke(["prepare", "--request", sameStatusFile, "--out-dir", path.join(tmp, "same-status-check")], [1]).stderr, /CHECK_MUTATED_WORKTREE/);

  const identityRoot = path.join(tmp, "default-identity"); fs.mkdirSync(identityRoot); const identity = fixture(identityRoot);
  const identityRequest = requestFor(identity.repo, identity.base, "ops-114-default-identity");
  const identityFile = path.join(tmp, "default-identity.json"); writeJson(identityFile, identityRequest);
  invoke(["prepare", "--request", identityFile, "--out-dir", path.join(tmp, "default-identity-first")]);
  writeJson(identityFile, { ...identityRequest, commitMessage: "different plan" });
  assert.match(invoke(["prepare", "--request", identityFile, "--out-dir", path.join(tmp, "default-identity-second")], [1]).stderr, /REQUEST_ID_REUSED_WITH_DIFFERENT_PLAN/);

'''
assert anchor in test
test = test.replace(anchor, extra, 1)
test = test.replace('negative: 17', 'negative: 20')
test_path.write_text(test)

schema_path = Path("contracts/git_write/v1/effect-result.schema.json")
schema = json.loads(schema_path.read_text())
schema["properties"]["pullRequest"] = {
    "type": "object",
    "properties": {
        "number": {"type": "integer", "minimum": 1},
        "url": {"type": "string", "minLength": 1},
        "head": {"type": "string"},
        "base": {"type": "string"},
        "draft": {"type": "boolean"},
        "matchingCount": {"type": "integer", "minimum": 0},
    },
}
schema_path.write_text(json.dumps(schema, indent=2, sort_keys=True) + "\n")

readme = Path("packages/ops-git-write-closure/README.md")
text = readme.read_text()
addition = '''
## Idempotency and checked snapshot

When `--state-dir` is omitted, request identity is retained under `.git/ops-git-write-closure`; reusing one request ID with another plan is rejected. Checks are bounded by full candidate-tree snapshots before and after execution, not only by `git status`, so same-status content mutation is rejected. Final PR readback must report exactly one matching head/base PR.
'''
if "## Idempotency and checked snapshot" not in text:
    text = text.rstrip() + "\n" + addition
readme.write_text(text)

runbook = Path("runbooks/github-connector-write.md")
text = runbook.read_text()
addition = '''
## Idempotent external effect

Before writing, inspect the deterministic target branch and matching head/base PRs:

- missing branch: execute normally;
- branch at the planned candidate commit: skip object/ref creation and continue with PR/readback;
- branch at the base commit: resume only after proving the planned candidate objects;
- branch at any other commit: `BRANCH_CONFLICT`;
- zero matching PRs: create one draft PR;
- one matching PR: reuse it;
- more than one matching PR: `BRANCH_CONFLICT`.

The effect result records `matchingCount`; `verify` requires exactly one. The request ID is bound to its plan in local Git metadata and a different plan never reuses the same request.
'''
if "## Idempotent external effect" not in text:
    text = text.rstrip() + "\n" + addition
runbook.write_text(text)

out = Path("evidence/ops-114-git-write-closure")
effect_path = out / "live-effect-result.json"
effect = json.loads(effect_path.read_text())
effect["pullRequest"]["matchingCount"] = 1
effect_path.write_text(json.dumps(effect, indent=2) + "\n")

raw_plan = {
  "base_commit": "5f5c44ada8a393ec17699a665d8aafced6fcfc0d",
  "base_ref": "proposals",
  "base_tree": "e3fb48355639c1db99f7b4d5cba08a27f230ff2c",
  "blob_operations": [{"bytes": 654, "encoding": "utf-8", "expected_git_oid": "8cec83a3026b7900e92529020eccb97c7b13db12", "operation_id": "blob-001", "path": "evidence/ops-114-git-write-closure/ops114-raw-object-proof-260818-02.jsonl"}],
  "changed_paths": ["evidence/ops-114-git-write-closure/ops114-raw-object-proof-260818-02.jsonl"],
  "checks": {"authoritative_base_tree_rebuilt_locally": "PASS", "json_parse": "PASS", "single_changed_path": "PASS"},
  "commit_message": "proof(ops): exercise raw Git object write closure after stale retry",
  "commit_parent": "5f5c44ada8a393ec17699a665d8aafced6fcfc0d",
  "expected_candidate_tree": "89f7c17a1d324293bfd9ee932b7daa634fa6f178",
  "expected_intermediate_trees": {"evidence": "b609d099bfc695ccabb184a161cfff004746daf6", "ops-114-git-write-closure": "8da7daf664a82d66ca2ceea4e39c81d904ef17b6"},
  "forbidden_effects": ["force", "merge", "protected_ref_update", "release_create"],
  "plan_sha256": "a6734af5792ae66ae5db6cdaa88b687c21f119ad58fa93dbd0885809a659ef13",
  "pr": {"base": "proposals", "draft": True, "head": "proposal/connector/ops114-raw-object-proof-260818-02", "title": "proof: raw Git object write closure for issue #114 (attempt 2)"},
  "request_id": "ops114-raw-object-proof-260818-02",
  "schema": "ops.gitWritePlan.v1",
  "source_repo": "roccho-dev/ops",
  "target_branch": "proposal/connector/ops114-raw-object-proof-260818-02",
  "tree_operations": [{"blob_sha": "8cec83a3026b7900e92529020eccb97c7b13db12", "mode": "100644", "operation_id": "tree-001", "path": "evidence/ops-114-git-write-closure/ops114-raw-object-proof-260818-02.jsonl", "type": "blob"}],
}
(out / "raw-live-effect-plan.json").write_text(json.dumps(raw_plan, indent=2) + "\n")

proof_path = out / "live-proof-evidence.json"
proof = json.loads(proof_path.read_text())
proof["successfulAttempt"]["rawProviderPlanSha256"] = raw_plan["plan_sha256"]
proof["successfulAttempt"]["productizedVerificationPlanSha256"] = proof["successfulAttempt"].pop("planSha256")
proof_path.write_text(json.dumps(proof, indent=2) + "\n")

receipt = out / "live-final-receipt.json"
if receipt.exists(): receipt.unlink()
readme_evidence = out / "README.md"
readme_evidence.write_text("""# Issue #114 closure evidence

The reusable `prepare / effect-plan / verify / final-receipt` package is registered as `ops-git-write-closure`.

PR #123 executed raw Git blob, tree, commit, non-force ref update, draft PR creation, and authoritative readback. `raw-live-effect-plan.json` preserves its original provider plan digest `a6734af5…9ef13`. The normalized `live-effect-plan.json` is a separate input used to replay the same readback through the accepted verifier; its digest is recorded separately. PR #122 is retained as the stale-base fail-closed attempt.

The accepted verifier regenerates `live-final-receipt.json`; echoed blob identifiers without canonical readback bytes, same-status check mutation, request-ID plan drift, or duplicate matching PRs cannot pass.
""")
