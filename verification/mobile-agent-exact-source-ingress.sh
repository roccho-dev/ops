#!/usr/bin/env bash
set -euo pipefail

: "${GH_TOKEN:?GH_TOKEN is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
: "${ISSUE_NUMBER:?ISSUE_NUMBER is required}"
: "${PR_NUMBER:?PR_NUMBER is required}"
: "${TARGET_REF:?TARGET_REF is required}"
: "${ORIGINAL_COMMIT:?ORIGINAL_COMMIT is required}"
: "${ORIGINAL_TREE:?ORIGINAL_TREE is required}"
: "${ORIGINAL_BUNDLE_SHA256:?ORIGINAL_BUNDLE_SHA256 is required}"
: "${EXPECTED_SOURCE_COMMIT:?EXPECTED_SOURCE_COMMIT is required}"
: "${EXPECTED_SOURCE_TREE:?EXPECTED_SOURCE_TREE is required}"

out="$RUNNER_TEMP/mobile-agent-source-ingress"
mkdir -p "$out"

gh api "repos/$GITHUB_REPOSITORY/issues/$ISSUE_NUMBER/comments?per_page=100" \
  > "$out/current-comments.json"
for hour in 8 9 10 11 12; do
  curl --fail --location --retry 3 --retry-delay 2 \
    "https://data.gharchive.org/2026-08-22-$hour.json.gz" \
    --output "$out/gharchive-2026-08-22-$hour.json.gz"
done

python3 verification/mobile-agent-exact-source-ingress.py recover \
  --comments "$out/current-comments.json" \
  --archives "$out"/gharchive-*.json.gz \
  --out "$out" \
  --original-commit "$ORIGINAL_COMMIT" \
  --original-tree "$ORIGINAL_TREE" \
  --bundle-sha256 "$ORIGINAL_BUNDLE_SHA256"

root="$(cat "$out/source-root")"
(cd "$root" && node tests/pattern_test.mjs)
(cd "$root" && node tests/protocol_test.mjs)
if [ -x "$root/verify.sh" ]; then
  (cd "$root" && ./verify.sh)
fi
(cd "$root" && ./build.sh)
python3 verification/mobile-agent-exact-source-ingress.py verify-build \
  --root "$root" \
  --expected verification/mobile-agent-preset-app/expected.json \
  --receipt "$out/build-receipt.json"

rm -rf "$root/dist" "$root/.git"
git -C "$root" init --quiet
git -C "$root" config user.name 'roccho source authority'
git -C "$root" config user.email 'source-authority@roccho.invalid'
git -C "$root" add -A
export GIT_AUTHOR_NAME='roccho source authority'
export GIT_AUTHOR_EMAIL='source-authority@roccho.invalid'
export GIT_AUTHOR_DATE='2026-08-21T00:00:00Z'
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME"
export GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
export GIT_COMMITTER_DATE="$GIT_AUTHOR_DATE"
git -C "$root" commit --quiet -m 'chore: promote exact Mobile Agent preset source'

commit="$(git -C "$root" rev-parse HEAD)"
tree="$(git -C "$root" rev-parse 'HEAD^{tree}')"
printf 'source commit: %s\nsource tree: %s\n' "$commit" "$tree"
test "$commit" = "$EXPECTED_SOURCE_COMMIT"
test "$tree" = "$EXPECTED_SOURCE_TREE"
test "$(git -C "$root" rev-list --count HEAD)" = 1
test -z "$(git -C "$root" status --porcelain)"

remote="https://x-access-token:$GH_TOKEN@github.com/$GITHUB_REPOSITORY.git"
git -C "$root" remote add origin "$remote"
current="$(git ls-remote "$remote" "refs/heads/$TARGET_REF" | awk 'NR==1 {print $1}')"
if [ -n "$current" ]; then
  test "$current" = "$commit"
else
  git -C "$root" push --quiet origin "HEAD:refs/heads/$TARGET_REF"
fi

readback="$RUNNER_TEMP/mobile-agent-source-readback"
rm -rf "$readback"
git init --quiet "$readback"
git -C "$readback" remote add origin "$remote"
git -C "$readback" fetch --quiet --depth=1 origin "$TARGET_REF"
git -C "$readback" checkout --quiet --detach FETCH_HEAD
test "$(git -C "$readback" rev-parse HEAD)" = "$commit"
test "$(git -C "$readback" rev-parse 'HEAD^{tree}')" = "$tree"
test "$(git -C "$readback" rev-list --count HEAD)" = 1
test -z "$(git -C "$readback" status --porcelain)"
git -C "$readback" fsck --no-dangling

python3 verification/mobile-agent-exact-source-ingress.py finalize \
  --out "$out" \
  --ref "$TARGET_REF" \
  --commit "$commit" \
  --tree "$tree"

cat > "$out/pr-comment.md" <<EOF
## Exact Mobile Agent source ingress — PASS

- ref: \`$TARGET_REF\`
- commit: \`$commit\`
- tree: \`$tree\`
- recovered historical parts: \`04/10\`, \`05/10\` from immutable GH Archive events
- source manifest: **657/657 exact hashes PASS**
- existing tests / verify / exact build: **PASS**
- generated projection: **54/54 exact files PASS**
- implementation rewrite / generated dist committed: \`false / false\`
EOF
gh pr comment "$PR_NUMBER" --repo "$GITHUB_REPOSITORY" --body-file "$out/pr-comment.md"
