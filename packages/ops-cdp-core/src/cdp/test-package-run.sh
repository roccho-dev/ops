#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
qjs_bin="${HQ_CDP_QJS:-qjs}"
root="$(mktemp -d /tmp/cdp-package-run-test.XXXXXX)"
trap 'rm -rf "$root"' EXIT
repo="$root/repo"
artifacts="$root/artifacts"
patch_wt="$root/patch-worktree"
mbox_wt="$root/mbox-worktree"
bundle_wt="$root/bundle-worktree"

mkdir -p "$repo" "$artifacts"
git -C "$repo" init -q
git -C "$repo" config user.email cdp-test@example.invalid
git -C "$repo" config user.name 'CDP Test'
printf 'old\n' > "$repo/file.txt"
git -C "$repo" add file.txt
git -C "$repo" commit -q -m base
base_rev="$(git -C "$repo" rev-parse HEAD)"

printf 'new\n' > "$repo/file.txt"
git -C "$repo" diff --binary > "$artifacts/thread-a.changes.patch"
git -C "$repo" checkout -q -- file.txt
cat > "$artifacts/thread-a.result.json" <<EOF_JSON
{"worker":"thread-a","baseRev":"$base_rev","status":"ready","filesChanged":["file.txt"]}
EOF_JSON

"$qjs_bin" --std -m ./chromium-cdp-package-run.mjs \
  --inbox "$artifacts" \
  --worker thread-a \
  --format patch \
  --repo "$repo" \
  --worktree "$patch_wt" \
  --branch worker/package-run-patch \
  --expectedBaseRev "$base_rev" \
  --noTest \
  --json > "$root/patch.json"
git -C "$patch_wt" show HEAD:file.txt | grep -qx 'new'

git -C "$repo" format-patch --stdout "$base_rev"..refs/heads/worker/package-run-patch > "$artifacts/thread-a.series.mbox"
cat > "$artifacts/thread-a.series.json" <<EOF_JSON
{"worker":"thread-a","baseRev":"$base_rev","status":"ready","patchFormat":"git-format-patch-mbox","patchCount":1,"filesChanged":["file.txt"]}
EOF_JSON
"$qjs_bin" --std -m ./chromium-cdp-package-run.mjs \
  --format mbox \
  --series "$artifacts/thread-a.series.json" \
  --mbox "$artifacts/thread-a.series.mbox" \
  --repo "$repo" \
  --worktree "$mbox_wt" \
  --branch worker/package-run-mbox \
  --expectedBaseRev "$base_rev" \
  --noTest \
  --json > "$root/mbox.json"
git -C "$mbox_wt" show HEAD:file.txt | grep -qx 'new'

git -C "$repo" bundle create "$artifacts/thread-a.repo.bundle" refs/heads/worker/package-run-patch
cat > "$artifacts/thread-a.bundle.result.json" <<EOF_JSON
{"worker":"thread-a","baseRev":"$base_rev","status":"ready","bundleRef":"refs/heads/worker/package-run-patch","filesChanged":["file.txt"]}
EOF_JSON
"$qjs_bin" --std -m ./chromium-cdp-package-run.mjs \
  --format bundle \
  --result "$artifacts/thread-a.bundle.result.json" \
  --bundle "$artifacts/thread-a.repo.bundle" \
  --repo "$repo" \
  --worktree "$bundle_wt" \
  --branch worker/package-run-bundle \
  --expectedBaseRev "$base_rev" \
  --noTest \
  --json > "$root/bundle.json"
git -C "$bundle_wt" show HEAD:file.txt | grep -qx 'new'

python3 - <<PY
import json, pathlib
root = pathlib.Path('$root')
for name in ['patch', 'mbox', 'bundle']:
    data = json.loads((root / f'{name}.json').read_text())
    assert data['ok'] is True, data
    assert data['applied']['ok'] is True, data
print('PASS: package-run patch/mbox/bundle host orchestration')
PY
