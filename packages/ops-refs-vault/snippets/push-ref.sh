#!/usr/bin/env bash
set -euo pipefail

manifest="${1:?usage: push-ref.sh <manifest> <repoId> <branch>}"
repo_id="${2:?usage: push-ref.sh <manifest> <repoId> <branch>}"
branch="${3:?usage: push-ref.sh <manifest> <repoId> <branch>}"

exec ops-refs-vault backup-one \
  --manifest "$manifest" \
  --repo-id "$repo_id" \
  --branch "$branch"
