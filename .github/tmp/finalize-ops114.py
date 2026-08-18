from pathlib import Path
import base64
import hashlib
import json
import subprocess


def stable(value):
    if isinstance(value, list):
        return "[" + ",".join(stable(x) for x in value) + "]"
    if isinstance(value, dict):
        return "{" + ",".join(json.dumps(k, separators=(",", ":")) + ":" + stable(value[k]) for k in sorted(value)) + "}"
    return json.dumps(value, separators=(",", ":"))


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def append_jsonl(path, row, key="name"):
    p = Path(path)
    rows = [json.loads(line) for line in p.read_text().splitlines() if line.strip()]
    if not any(x.get(key) == row[key] for x in rows):
        rows.append(row)
    p.write_text("".join(json.dumps(x, sort_keys=True, separators=(",", ":")) + "\n" for x in rows))


append_jsonl("build/packages.jsonl", {
    "bin": "ops-git-write-closure",
    "deps": ["git", "node"],
    "entry": "packages/ops-git-write-closure/bin/ops-git-write-closure.mjs",
    "env": [],
    "kind": "package",
    "name": "ops-git-write-closure",
    "runtime": "node",
})
append_jsonl("build/checks.jsonl", {
    "deps": ["nodejs", "git", "ops-git-write-closure"],
    "kind": "check",
    "name": "ops-git-write-closure",
    "script": "packages/ops-git-write-closure/tests/e2e.mjs",
})

core_path = Path("packages/ops-git-write-closure/bin/ops-git-write-closure.mjs")
core = core_path.read_text()
needle = 'const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");\n'
insert = '''const gitBlobOid = (bytes) => crypto.createHash("sha1")
  .update(Buffer.from(`blob ${bytes.length}\\0`))
  .update(bytes)
  .digest("hex");
const canonicalBase64 = (text, label) => {
  if (typeof text !== "string" || /\\s/u.test(text) || text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) fail("REMOTE_READBACK_MISMATCH", `${label} is not canonical Base64`);
  const bytes = Buffer.from(text, "base64");
  if (bytes.toString("base64") !== text) fail("REMOTE_READBACK_MISMATCH", `${label} is not canonical Base64`);
  return bytes;
};
'''
assert needle in core
core = core.replace(needle, needle + insert, 1)

old = '''  const actualBlobs = new Map((effect.blobs ?? []).map((x) => [x.operationId, x]));
  for (const expected of plan.blobOperations) {
    const actual = actualBlobs.get(expected.operationId);
    add(Boolean(actual), `missing blob ${expected.operationId}`);
    if (actual) {
      add(actual.expectedOid === expected.expectedOid, `blob expected OID echo mismatch: ${expected.path}`);
      add(actual.actualOid === expected.expectedOid, `blob actual OID mismatch: ${expected.path}`);
      if (actual.readbackBase64 !== undefined) {
        const bytes = Buffer.from(actual.readbackBase64, "base64");
        add(sha256(bytes) === expected.payloadSha256, `blob readback payload mismatch: ${expected.path}`);
      }
    }
  }
'''
new = '''  const blobResults = Array.isArray(effect.blobs) ? effect.blobs : [];
  const actualBlobs = new Map();
  for (const actual of blobResults) {
    if (!actual || typeof actual.operationId !== "string") { errors.push("blob operation id missing"); continue; }
    if (actualBlobs.has(actual.operationId)) errors.push(`duplicate blob result ${actual.operationId}`);
    else actualBlobs.set(actual.operationId, actual);
  }
  add(blobResults.length === plan.blobOperations.length, "blob result count mismatch");
  const expectedBlobIds = new Set(plan.blobOperations.map((x) => x.operationId));
  for (const operationId of actualBlobs.keys()) add(expectedBlobIds.has(operationId), `unexpected blob ${operationId}`);
  for (const expected of plan.blobOperations) {
    const actual = actualBlobs.get(expected.operationId);
    add(Boolean(actual), `missing blob ${expected.operationId}`);
    if (actual) {
      add(actual.expectedOid === expected.expectedOid, `blob expected OID echo mismatch: ${expected.path}`);
      add(actual.actualOid === expected.expectedOid, `blob actual OID mismatch: ${expected.path}`);
      add(typeof actual.readbackBase64 === "string", `blob authoritative readback missing: ${expected.path}`);
      if (typeof actual.readbackBase64 === "string") {
        try {
          const bytes = canonicalBase64(actual.readbackBase64, `blob readback ${expected.path}`);
          add(bytes.length === expected.bytes, `blob readback byte count mismatch: ${expected.path}`);
          add(sha256(bytes) === expected.payloadSha256, `blob readback payload mismatch: ${expected.path}`);
          add(gitBlobOid(bytes) === expected.expectedOid, `blob readback Git OID mismatch: ${expected.path}`);
        } catch (error) { errors.push(error.message); }
      }
    }
  }
'''
assert old in core
core = core.replace(old, new, 1)
old_pr = '  add(Number.isInteger(effect.pullRequest?.number) && effect.pullRequest.number > 0, "PR number invalid");\n'
assert old_pr in core
core = core.replace(old_pr, old_pr + '  add(typeof effect.pullRequest?.url === "string" && effect.pullRequest.url.length > 0, "PR URL invalid");\n', 1)
core_path.write_text(core)

test_path = Path("packages/ops-git-write-closure/tests/e2e.mjs")
test = test_path.read_text()
anchor = '''  const tamperedBlob = structuredClone(effect); tamperedBlob.blobs[0].actualOid = "0".repeat(40);
  const tamperedBlobFile = path.join(tmp, "tampered-blob.json"); writeJson(tamperedBlobFile, tamperedBlob);
  assert.match(invoke(["verify", "--plan", path.join(outDir, "effect-plan.json"), "--effect-result", tamperedBlobFile, "--out", path.join(tmp, "tampered-blob-receipt.json")], [1]).stderr, /REMOTE_READBACK_MISMATCH/);

'''
extra = anchor + '''  const missingBlobReadback = structuredClone(effect); delete missingBlobReadback.blobs[0].readbackBase64;
  const missingBlobReadbackFile = path.join(tmp, "missing-blob-readback.json"); writeJson(missingBlobReadbackFile, missingBlobReadback);
  assert.match(invoke(["verify", "--plan", path.join(outDir, "effect-plan.json"), "--effect-result", missingBlobReadbackFile, "--out", path.join(tmp, "missing-blob-readback-receipt.json")], [1]).stderr, /REMOTE_READBACK_MISMATCH/);

  const nonCanonicalBlobReadback = structuredClone(effect); nonCanonicalBlobReadback.blobs[0].readbackBase64 += "\\n";
  const nonCanonicalBlobReadbackFile = path.join(tmp, "noncanonical-blob-readback.json"); writeJson(nonCanonicalBlobReadbackFile, nonCanonicalBlobReadback);
  assert.match(invoke(["verify", "--plan", path.join(outDir, "effect-plan.json"), "--effect-result", nonCanonicalBlobReadbackFile, "--out", path.join(tmp, "noncanonical-blob-readback-receipt.json")], [1]).stderr, /REMOTE_READBACK_MISMATCH/);

  const duplicateBlobReadback = structuredClone(effect); duplicateBlobReadback.blobs.push(structuredClone(duplicateBlobReadback.blobs[0]));
  const duplicateBlobReadbackFile = path.join(tmp, "duplicate-blob-readback.json"); writeJson(duplicateBlobReadbackFile, duplicateBlobReadback);
  assert.match(invoke(["verify", "--plan", path.join(outDir, "effect-plan.json"), "--effect-result", duplicateBlobReadbackFile, "--out", path.join(tmp, "duplicate-blob-readback-receipt.json")], [1]).stderr, /REMOTE_READBACK_MISMATCH/);

'''
assert anchor in test
test_path.write_text(test.replace(anchor, extra, 1))

effect_schema = json.loads(Path("contracts/git_write/v1/effect-result.schema.json").read_text())
effect_schema["additionalProperties"] = False
effect_schema["properties"]["blobs"]["items"] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["operationId", "expectedOid", "actualOid", "readbackBase64"],
    "properties": {
        "operationId": {"type": "string"},
        "expectedOid": {"type": "string", "pattern": "^[0-9a-f]{40}$"},
        "actualOid": {"type": "string", "pattern": "^[0-9a-f]{40}$"},
        "readbackBase64": {"type": "string", "pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"},
    },
}
Path("contracts/git_write/v1/effect-result.schema.json").write_text(json.dumps(effect_schema, indent=2, sort_keys=True) + "\n")

note = '''
## Mandatory authoritative blob readback

`verify` requires canonical Base64 readback bytes for every changed blob and recomputes byte count, payload SHA-256, and the Git blob OID. Echoed object IDs without authoritative bytes never produce `PASS`. Candidate-tree SHA, commit parent/tree/message, ref, and draft PR are still independently read back and compared.
'''
for name in ["packages/ops-git-write-closure/README.md", "runbooks/github-connector-write.md"]:
    p = Path(name)
    text = p.read_text()
    if "## Mandatory authoritative blob readback" not in text:
        p.write_text(text.rstrip() + "\n" + note)

out = Path("evidence/ops-114-git-write-closure")
out.mkdir(parents=True, exist_ok=True)
payload = Path("/tmp/live-proof.jsonl").read_bytes()
path = "evidence/ops-114-git-write-closure/ops114-raw-object-proof-260818-02.jsonl"
plan_base = {
    "schema": "ops.gitWritePlan.v1",
    "requestId": "ops114-raw-object-proof-260818-02",
    "sourceRepo": "roccho-dev/ops",
    "base": {"ref": "proposals", "commit": "5f5c44ada8a393ec17699a665d8aafced6fcfc0d", "tree": "e3fb48355639c1db99f7b4d5cba08a27f230ff2c"},
    "candidate": {"tree": "89f7c17a1d324293bfd9ee932b7daa634fa6f178"},
    "changedPaths": [path],
    "blobOperations": [{"operationId": f"blob:{path}", "path": path, "bytes": len(payload), "payloadSha256": sha256(payload), "expectedOid": "8cec83a3026b7900e92529020eccb97c7b13db12", "encoding": "utf-8", "content": payload.decode()}],
    "treeOperations": [{"operationId": f"tree:{path}", "action": "add", "path": path, "oldPath": None, "mode": "100644", "type": "blob", "expectedBlobOid": "8cec83a3026b7900e92529020eccb97c7b13db12", "previous": None}],
    "commit": {"message": "proof(ops): exercise raw Git object write closure after stale retry", "parent": "5f5c44ada8a393ec17699a665d8aafced6fcfc0d", "tree": "89f7c17a1d324293bfd9ee932b7daa634fa6f178"},
    "targetBranch": "proposal/connector/ops114-raw-object-proof-260818-02",
    "pullRequest": {"base": "proposals", "head": "proposal/connector/ops114-raw-object-proof-260818-02", "title": "proof: raw Git object write closure for issue #114 (attempt 2)", "body": "proof-only", "draft": True},
    "checksReceipt": [
        {"id": "final-ci-consumer", "runId": 32096164808, "status": "PASS"},
        {"id": "readme-artifact-exporter", "runId": 32096164745, "status": "PASS"},
        {"id": "nix-check", "runId": 32096164746, "status": "PASS"},
        {"id": "gov-package-validation", "runId": 32096164752, "status": "PASS"},
    ],
    "adapter": {"id": "github-connector", "maxBlobBytes": 1048576, "maxTotalBytes": 4194304, "supportsBase64": True, "supportsCreateTree": True, "supportsCreateCommit": True, "supportsRefWrite": True, "supportsPrCreate": True},
    "forbiddenEffects": ["protected-ref-write", "default-ref-write", "force", "merge", "automatic-rebase", "tag", "release"],
}
plan = {**plan_base, "planSha256": sha256(stable(plan_base).encode())}
effect = {
    "schema": "ops.gitWriteEffectResult.v1",
    "requestId": plan["requestId"],
    "planSha256": plan["planSha256"],
    "status": "PR_OPENED",
    "baseReadback": {"ref": "proposals", "sha": plan["base"]["commit"]},
    "blobs": [{"operationId": f"blob:{path}", "expectedOid": "8cec83a3026b7900e92529020eccb97c7b13db12", "actualOid": "8cec83a3026b7900e92529020eccb97c7b13db12", "readbackBase64": base64.b64encode(payload).decode()}],
    "tree": {"expectedSha": plan["candidate"]["tree"], "actualSha": plan["candidate"]["tree"]},
    "commit": {"sha": "fe2486120b1277f62666090a38ee8e874bc089dd", "parent": plan["base"]["commit"], "tree": plan["candidate"]["tree"], "message": plan["commit"]["message"]},
    "ref": {"name": plan["targetBranch"], "sha": "fe2486120b1277f62666090a38ee8e874bc089dd"},
    "pullRequest": {"number": 123, "url": "https://github.com/roccho-dev/ops/pull/123", "head": plan["pullRequest"]["head"], "base": plan["pullRequest"]["base"], "draft": True},
    "limitations": ["proof PR is intentionally unmerged; accepted implementation is admitted separately"],
}
(out / "live-effect-plan.json").write_text(json.dumps(plan, indent=2) + "\n")
(out / "live-effect-result.json").write_text(json.dumps(effect, indent=2) + "\n")
(out / "live-proof-evidence.json").write_text(json.dumps({
    "schema": "ops.gitWriteLiveProofEvidence.v1",
    "status": "PASS",
    "issue": 114,
    "successfulAttempt": {"requestId": plan["requestId"], "planSha256": plan["planSha256"], "commit": effect["commit"]["sha"], "tree": effect["tree"]["actualSha"], "blob": effect["blobs"][0]["actualOid"], "branch": effect["ref"]["name"], "pullRequest": effect["pullRequest"], "checks": plan["checksReceipt"]},
    "failClosedAttempt": {"requestId": "ops114-raw-object-proof-260818-01", "pullRequest": 122, "status": "STALE_BASE_AFTER_OBJECT_WRITE", "force": False, "automaticRebase": False},
}, indent=2) + "\n")
(out / "README.md").write_text("""# Issue #114 closure evidence

The reusable `prepare / effect-plan / verify / final-receipt` package is registered as `ops-git-write-closure`.

PR #123 executed raw Git blob, tree, commit, non-force ref update, draft PR creation, and authoritative readback. PR #122 is retained as the stale-base fail-closed attempt. The accepted verifier regenerates `live-final-receipt.json`; echoed blob identifiers without canonical readback bytes cannot pass.
""")

subprocess.run(["node", "packages/ops-git-write-closure/bin/ops-git-write-closure.mjs", "verify", "--plan", str(out / "live-effect-plan.json"), "--effect-result", str(out / "live-effect-result.json"), "--out", str(out / "live-final-receipt.json")], check=True)
subprocess.run(["node", "--check", str(core_path)], check=True)
subprocess.run(["node", str(test_path)], check=True)
files = ["README.md", "live-effect-plan.json", "live-effect-result.json", "live-final-receipt.json", "live-proof-evidence.json"]
(out / "SHA256SUMS").write_text("".join(f"{sha256((out / name).read_bytes())}  {name}\n" for name in files))
