#!/usr/bin/env bash
set -euo pipefail

manifest="${1:?usage: manual-restore.sh <manifest> <repoId> <branch> <staging-bare>}"
repo_id="${2:?usage: manual-restore.sh <manifest> <repoId> <branch> <staging-bare>}"
branch="${3:?usage: manual-restore.sh <manifest> <repoId> <branch> <staging-bare>}"
staging_bare="${4:?usage: manual-restore.sh <manifest> <repoId> <branch> <staging-bare>}"

exec ops-refs-vault restore-bare-one \
  --manifest "$manifest" \
  --repo-id "$repo_id" \
  --branch "$branch" \
  --staging-bare "$staging_bare"
