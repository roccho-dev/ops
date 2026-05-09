#!/usr/bin/env bash
set -euo pipefail

repo_dir="${1:?usage: push-ref.sh <repo-dir> <remote> <repoId> <branch> [local-ref]}"
remote="${2:?usage: push-ref.sh <repo-dir> <remote> <repoId> <branch> [local-ref]}"
repo_id="${3:?usage: push-ref.sh <repo-dir> <remote> <repoId> <branch> [local-ref]}"
branch="${4:?usage: push-ref.sh <repo-dir> <remote> <repoId> <branch> [local-ref]}"
local_ref="${5:-HEAD}"
refspec="${local_ref}:refs/heads/repos/${repo_id}/${branch}"

case "$remote" in
  git@github.com:*|ssh://git@github.com/*)
    exec ops-tailnet-github-egress push-local \
      --long-transfer \
      --timeout "${OPS_REFS_VAULT_GITHUB_PUSH_TIMEOUT:-600}" \
      --repo-dir "$repo_dir" \
      --remote "$remote" \
      --refspec "$refspec" \
      --json
    ;;
esac

git -C "$repo_dir" push "$remote" "$refspec"
