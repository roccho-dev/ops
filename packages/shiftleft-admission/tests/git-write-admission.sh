#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
POLICYCTL=${POLICYCTL:-policyctl}
NODE=${NODE:-node}
WRITE_CLI=${GIT_WRITE_CLOSURE_SCRIPT:-"$ROOT/../ops-git-write-closure/bin/ops-git-write-closure.mjs"}
POLICY_REF=${POLICY_REF:-0123456789abcdef0123456789abcdef01234567}

command -v "$POLICYCTL" >/dev/null 2>&1 || {
  printf 'policyctl not found: %s\n' "$POLICYCTL" >&2
  exit 127
}
command -v "$NODE" >/dev/null 2>&1 || {
  printf 'node not found: %s\n' "$NODE" >&2
  exit 127
}
command -v git >/dev/null 2>&1 || {
  printf 'git not found\n' >&2
  exit 127
}
test -f "$WRITE_CLI"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
REPO="$TMP/repo"
git init --quiet --initial-branch=proposals "$REPO"
git -C "$REPO" config user.name shiftleft-proof
git -C "$REPO" config user.email shiftleft-proof@example.invalid
mkdir -p "$REPO/src"
printf 'before\n' > "$REPO/src/value.txt"
git -C "$REPO" add .
git -C "$REPO" -c commit.gpgsign=false commit --quiet -m base
BASE_SHA=$(git -C "$REPO" rev-parse HEAD)
BASE_TREE=$(git -C "$REPO" rev-parse 'HEAD^{tree}')
printf 'after\n' > "$REPO/src/value.txt"
printf 'new\n' > "$REPO/src/new.txt"

INDEX="$TMP/candidate.index"
GIT_INDEX_FILE="$INDEX" git -C "$REPO" read-tree HEAD
GIT_INDEX_FILE="$INDEX" git -C "$REPO" add -A -- .
CANDIDATE_TREE=$(GIT_INDEX_FILE="$INDEX" git -C "$REPO" write-tree)
POLICY_HASH=$("$POLICYCTL" hash --bundle "$ROOT/policy")

GOOD_PROOF="$TMP/good-proof"
"$POLICYCTL" proof \
  --bundle "$ROOT/policy" \
  --fixtures "$ROOT/fixtures" \
  --policy-ref "$POLICY_REF" \
  --base-tree "git-tree-sha1:$BASE_TREE" \
  --candidate-tree "git-tree-sha1:$CANDIDATE_TREE" \
  --out-dir "$GOOD_PROOF" > "$TMP/good-proof.stdout"
GOOD_RECEIPT="$GOOD_PROOF/receipt.1.json"

make_request() {
  local request_id=$1
  local receipt=$2
  local out=$3
  REQUEST_ID="$request_id" RECEIPT="$receipt" REQUEST_OUT="$out" \
  REPO="$REPO" BASE_SHA="$BASE_SHA" POLICYCTL="$POLICYCTL" POLICY_HASH="$POLICY_HASH" \
    "$NODE" <<'NODE'
const fs = require('node:fs');
const requestId = process.env.REQUEST_ID;
const targetBranch = `proposal/connector/${requestId}`;
const request = {
  schema: 'ops.gitWriteRequest.v1',
  requestId,
  sourceRepo: 'roccho-dev/ops',
  baseRef: 'proposals',
  baseSha: process.env.BASE_SHA,
  worktree: process.env.REPO,
  targetBranch,
  commitMessage: 'proof: shiftleft-gated candidate',
  force: false,
  pullRequest: {
    base: 'proposals',
    head: targetBranch,
    title: 'proof: shiftleft admission',
    body: 'local proof only',
    draft: true,
  },
  checks: [
    {
      id: 'shiftleft-admission',
      command: [
        process.env.POLICYCTL,
        'verify-worktree',
        '--receipt', process.env.RECEIPT,
        '--policy-sha256', process.env.POLICY_HASH,
        '--repo', process.env.REPO,
      ],
      timeoutSeconds: 120,
    },
    { id: 'git-diff-check', command: ['git', 'diff', '--check'], timeoutSeconds: 30 },
  ],
  adapter: {
    id: 'local-proof',
    maxBlobBytes: 1048576,
    maxTotalBytes: 4194304,
    supportsBase64: true,
    supportsCreateTree: true,
    supportsCreateCommit: true,
    supportsRefWrite: true,
    supportsPrCreate: true,
  },
};
fs.writeFileSync(process.env.REQUEST_OUT, `${JSON.stringify(request, null, 2)}\n`);
NODE
}

GOOD_REQUEST="$TMP/good-request.json"
GOOD_OUT="$TMP/good-out"
make_request shiftleft-write-pass "$GOOD_RECEIPT" "$GOOD_REQUEST"
"$NODE" "$WRITE_CLI" prepare \
  --request "$GOOD_REQUEST" \
  --out-dir "$GOOD_OUT" \
  --state-dir "$TMP/good-state" > "$TMP/good-prepare.stdout"
test -s "$GOOD_OUT/effect-plan.json"

PLAN="$GOOD_OUT/effect-plan.json"
PLAN_BASE=$(PLAN="$PLAN" "$NODE" -e 'const p=require(process.env.PLAN); process.stdout.write(p.base.tree)')
PLAN_CANDIDATE=$(PLAN="$PLAN" "$NODE" -e 'const p=require(process.env.PLAN); process.stdout.write(p.candidate.tree)')
test "$PLAN_BASE" = "$BASE_TREE"
test "$PLAN_CANDIDATE" = "$CANDIDATE_TREE"
PLAN="$PLAN" POLICY_HASH="$POLICY_HASH" RECEIPT_DIGEST=$(RECEIPT="$GOOD_RECEIPT" "$NODE" -e 'const r=require(process.env.RECEIPT); process.stdout.write(r.receiptDigest)') \
  "$NODE" <<'NODE'
const p = require(process.env.PLAN);
const check = p.checksReceipt.find((x) => x.id === 'shiftleft-admission');
if (!check || check.status !== 'PASS' || check.exit !== 0) throw new Error('missing PASS shiftleft check receipt');
const observed = JSON.parse(check.stdout);
if (observed.schema !== 'shiftleft-worktree-verification/1' || observed.status !== 'PASS') throw new Error('invalid worktree verification');
if (observed.policyHash !== process.env.POLICY_HASH) throw new Error('policy hash mismatch');
if (observed.baseTree !== `git-tree-sha1:${p.base.tree}`) throw new Error('base tree mismatch');
if (observed.candidateTree !== `git-tree-sha1:${p.candidate.tree}`) throw new Error('candidate tree mismatch');
if (observed.receiptDigest !== process.env.RECEIPT_DIGEST) throw new Error('receipt digest mismatch');
NODE
"$POLICYCTL" verify \
  --receipt "$GOOD_RECEIPT" \
  --policy-sha256 "$POLICY_HASH" \
  --base-tree "git-tree-sha1:$PLAN_BASE" \
  --candidate-tree "git-tree-sha1:$PLAN_CANDIDATE" > "$TMP/readback-reverify.stdout"
grep -qx 'PASS' "$TMP/readback-reverify.stdout"

WRONG_PROOF="$TMP/wrong-proof"
"$POLICYCTL" proof \
  --bundle "$ROOT/policy" \
  --fixtures "$ROOT/fixtures" \
  --policy-ref "$POLICY_REF" \
  --base-tree "git-tree-sha1:$BASE_TREE" \
  --candidate-tree 'git-tree-sha1:3333333333333333333333333333333333333333' \
  --out-dir "$WRONG_PROOF" > "$TMP/wrong-proof.stdout"
WRONG_REQUEST="$TMP/wrong-request.json"
WRONG_OUT="$TMP/wrong-out"
make_request shiftleft-write-wrong-tree "$WRONG_PROOF/receipt.1.json" "$WRONG_REQUEST"
if "$NODE" "$WRITE_CLI" prepare \
  --request "$WRONG_REQUEST" \
  --out-dir "$WRONG_OUT" \
  --state-dir "$TMP/wrong-state" > "$TMP/wrong.stdout" 2> "$TMP/wrong.stderr"
then
  printf 'wrong-tree receipt unexpectedly passed Git write prepare\n' >&2
  exit 1
fi
grep -q 'CHECK_FAILED' "$TMP/wrong.stderr"
grep -q 'CANDIDATE_TREE_MISMATCH' "$TMP/wrong.stderr"
test ! -e "$WRONG_OUT/effect-plan.json"

MISSING_REQUEST="$TMP/missing-request.json"
MISSING_OUT="$TMP/missing-out"
make_request shiftleft-write-missing-receipt "$TMP/does-not-exist.json" "$MISSING_REQUEST"
if "$NODE" "$WRITE_CLI" prepare \
  --request "$MISSING_REQUEST" \
  --out-dir "$MISSING_OUT" \
  --state-dir "$TMP/missing-state" > "$TMP/missing.stdout" 2> "$TMP/missing.stderr"
then
  printf 'missing receipt unexpectedly passed Git write prepare\n' >&2
  exit 1
fi
grep -q 'CHECK_FAILED' "$TMP/missing.stderr"
grep -q 'RECEIPT_READ_FAILED' "$TMP/missing.stderr"
test ! -e "$MISSING_OUT/effect-plan.json"

printf 'shiftleft -> #114 prepare admission: PASS\n'
