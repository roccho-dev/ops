#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

: "${REQUEST_PATH:?}"
: "${ARTIFACT:?}"
: "${EDIT_WORKSPACE:?}"

SELECTED_REPOSITORY=""
SELECTED_COMMIT=""
SELECTED_TREE=""
SELECTED_REF=""
finalized=0

finalize() {
  status=$?
  if test "$finalized" -eq 1; then
    exit "$status"
  fi
  finalized=1
  trap - EXIT INT TERM
  set +e
  mkdir -p "$ARTIFACT/source" "$ARTIFACT/product"

  if test -d "$EDIT_WORKSPACE/.git" && git -C "$EDIT_WORKSPACE" rev-parse --verify HEAD >/dev/null 2>&1; then
    git -C "$EDIT_WORKSPACE" bundle create \
      "$ARTIFACT/source/edits-vim-nix-current.git.bundle" refs/heads/exact \
      > "$ARTIFACT/source/bundle-create.stdout" 2> "$ARTIFACT/source/bundle-create.stderr"
    bundle_status=$?
    if test "$bundle_status" -eq 0; then
      git -C "$EDIT_WORKSPACE" bundle verify \
        "$ARTIFACT/source/edits-vim-nix-current.git.bundle" \
        > "$ARTIFACT/source/bundle-verify.txt" 2>&1
      test $? -eq 0 || status=1
    else
      status=1
    fi
    git -C "$EDIT_WORKSPACE" archive --format=tar.gz \
      --prefix="edits-${SELECTED_COMMIT:-unknown}/" HEAD \
      > "$ARTIFACT/source/edits-vim-nix-current.source.tar.gz"
    test $? -eq 0 || status=1
    git -C "$EDIT_WORKSPACE" status --porcelain=v1 \
      > "$ARTIFACT/source/git-status.txt"
    test ! -s "$ARTIFACT/source/git-status.txt" || status=1
  fi

  cp "$REQUEST_PATH" "$ARTIFACT/source/request.json" 2>/dev/null || true
  printf '%s\n' "$SELECTED_COMMIT" > "$ARTIFACT/source/selected-commit.txt"
  printf '%s\n' "$SELECTED_TREE" > "$ARTIFACT/source/selected-tree.txt"
  printf '%s\n' "$SELECTED_REF" > "$ARTIFACT/source/selected-ref.txt"
  printf '%s\n' "$status" > "$ARTIFACT/proof-step-exit-status.txt"

  if test -s "$ARTIFACT/product/store-path.txt"; then
    product="$(cat "$ARTIFACT/product/store-path.txt")"
    if test -e "$product"; then
      printf '%s\n' "$product" > "$ARTIFACT/product/store-path.readback.txt"
      nix-store -qR "$product" | sort > "$ARTIFACT/product/closure-paths.readback.txt"
      if test ${PIPESTATUS[0]} -ne 0; then status=1; fi
      sed 's#^/##' "$ARTIFACT/product/closure-paths.readback.txt" \
        > "$ARTIFACT/product/closure-relative-paths.txt"
      tar --sort=name --mtime='@0' --owner=0 --group=0 --numeric-owner \
        --zstd -C / -cf "$ARTIFACT/product/product-store-closure.tar.zst" \
        -T "$ARTIFACT/product/closure-relative-paths.txt"
      test $? -eq 0 || status=1
      rm -rf "$ARTIFACT/nix-cache"
      if nix copy --to "file://$ARTIFACT/nix-cache" "$product" \
          > "$ARTIFACT/nix-copy.stdout" 2> "$ARTIFACT/nix-copy.stderr"; then
        printf 'PASS\n' > "$ARTIFACT/nix-cache-export.txt"
      else
        printf 'FAIL\n' > "$ARTIFACT/nix-cache-export.txt"
        status=1
      fi
    else
      printf 'declared product store path is absent\n' > "$ARTIFACT/product/store-path.readback.error.txt"
      status=1
    fi
  fi

  SELECTED_REPOSITORY="$SELECTED_REPOSITORY" \
  SELECTED_COMMIT="$SELECTED_COMMIT" \
  SELECTED_TREE="$SELECTED_TREE" \
  SELECTED_REF="$SELECTED_REF" \
  FINAL_STATUS="$status" \
  python3 - <<'PY'
import json, os, pathlib
root = pathlib.Path(os.environ['ARTIFACT'])
status = int(os.environ['FINAL_STATUS'])
value = {
    'schema': 'ops.vimNixRuntimeMaterializationReceipt/1',
    'status': 'PASS' if status == 0 else 'FAIL',
    'authority': False,
    'issue': 238,
    'source': {
        'repository': os.environ['SELECTED_REPOSITORY'],
        'commit': os.environ['SELECTED_COMMIT'],
        'tree': os.environ['SELECTED_TREE'],
        'ref': os.environ['SELECTED_REF'],
        'acquisition': 'exact-git-depth-1',
        'clean': (root / 'source/git-status.txt').is_file()
                 and not (root / 'source/git-status.txt').read_bytes(),
    },
    'proofExitStatus': status,
    'objects': {
        'productStorePath': (root / 'product/store-path.txt').read_text().strip()
            if (root / 'product/store-path.txt').is_file() else None,
        'dockerArchive': (root / 'vim-nix-herdr-hq.docker.tar').is_file(),
        'ociArchive': (root / 'vim-nix-herdr-hq.oci.tar').is_file(),
        'dockerRuntimeReceipt': (root / 'evidence-docker/receipt.json').is_file(),
        'ociRuntimeReceipt': (root / 'evidence-oci/receipt.json').is_file(),
        'nixCache': (root / 'nix-cache').is_dir(),
        'portableStoreClosure': (root / 'product/product-store-closure.tar.zst').is_file(),
    },
    'claimBoundary': {
        'productComplete': status == 0,
        'physicalWslcReadback': False,
        'modelRepairAllowed': False,
    },
}
(root / 'materialization-receipt.json').write_text(
    json.dumps(value, indent=2, sort_keys=True) + '\n', encoding='utf-8')
PY
  test $? -eq 0 || status=1

  printf '%s\n' "$status" > "$ARTIFACT/final-exit-status.txt"
  du -sh "$ARTIFACT" > "$ARTIFACT/artifact-size.txt" 2>&1 || true
  readback="$RUNNER_TEMP/vim-nix-sha256-readback.txt"
  (
    cd "$ARTIFACT" || exit 1
    find . -type f ! -name SHA256SUMS ! -name sha256-readback.txt -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS
    sha256sum --check SHA256SUMS
  ) > "$readback" 2>&1
  test $? -eq 0 || status=1
  cp "$readback" "$ARTIFACT/sha256-readback.txt"
  printf '%s\n' "$status" > "$ARTIFACT/final-exit-status.txt"
  exit "$status"
}
trap finalize EXIT INT TERM

readarray -t request < <(python3 - "$REQUEST_PATH" <<'PY'
import json, pathlib, re, sys
x = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
assert x['schema'] == 'ops.vimNixRuntimeMaterializationRequest/1'
assert x['authority'] is False
assert x['issue'] == 238
assert x['repository'] == 'roccho-dev/edits'
assert x['ref'] == 'refs/heads/proof/vim-nix-herdr-oci-current-20260821'
assert x['handoffSha256'] == 'sha256:6a88215c073a43b82f6e584466b07f6c8265e7d4b48ff5e92acbd14626248d38'
assert x['effects'] == {
    'networkDuringMaterialization': True,
    'sourceMutation': False,
    'modelRepair': False,
    'publishRelease': False,
}
for key in ('commit', 'tree'):
    assert re.fullmatch(r'[0-9a-f]{40}', x[key]), key
print(x['repository'])
print(x['commit'])
print(x['tree'])
print(x['ref'])
PY
)
test "${#request[@]}" -eq 4
SELECTED_REPOSITORY=${request[0]}
SELECTED_COMMIT=${request[1]}
SELECTED_TREE=${request[2]}
SELECTED_REF=${request[3]}

rm -rf "$EDIT_WORKSPACE" "$ARTIFACT"
mkdir -p "$EDIT_WORKSPACE" "$ARTIFACT/source"
remote="https://github.com/$SELECTED_REPOSITORY.git"
ref_head="$(git ls-remote "$remote" "$SELECTED_REF" | awk 'NR == 1 { print $1 }')"
test "$ref_head" = "$SELECTED_COMMIT"

git -C "$EDIT_WORKSPACE" init --quiet
git -C "$EDIT_WORKSPACE" remote add origin "$remote"
git -C "$EDIT_WORKSPACE" fetch --quiet --depth=1 origin "$SELECTED_COMMIT"
test "$(git -C "$EDIT_WORKSPACE" rev-parse FETCH_HEAD^{commit})" = "$SELECTED_COMMIT"
git -C "$EDIT_WORKSPACE" checkout --quiet -b exact FETCH_HEAD
test "$(git -C "$EDIT_WORKSPACE" rev-parse HEAD^{tree})" = "$SELECTED_TREE"
test "$(git -C "$EDIT_WORKSPACE" rev-list --count HEAD)" = 1
test "$(git -C "$EDIT_WORKSPACE" rev-parse --is-shallow-repository)" = true
test -z "$(git -C "$EDIT_WORKSPACE" status --porcelain=v1)"
git -C "$EDIT_WORKSPACE" fsck --no-dangling

export GITHUB_WORKSPACE="$EDIT_WORKSPACE"
export GITHUB_SHA="$SELECTED_COMMIT"
cat "$EDIT_WORKSPACE"/proofs/vim-nix/ci.parts/*.sh > "$RUNNER_TEMP/vim-nix-ci.sh"
chmod 0700 "$RUNNER_TEMP/vim-nix-ci.sh"
"$RUNNER_TEMP/vim-nix-ci.sh"
