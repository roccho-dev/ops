#!/usr/bin/env bash
set -euo pipefail

dest="${1:?usage: manual-restore.sh <dest> <remote> <repoId> <branch>}"
remote="${2:?usage: manual-restore.sh <dest> <remote> <repoId> <branch>}"
repo_id="${3:?usage: manual-restore.sh <dest> <remote> <repoId> <branch>}"
branch="${4:?usage: manual-restore.sh <dest> <remote> <repoId> <branch>}"
remote_name="${REFS_REMOTE_NAME:-refs-vault}"

mkdir -p "$dest"
if [ ! -d "$dest/.git" ]; then
  git init -q -b "$branch" "$dest"
fi

cd "$dest"
if git remote get-url "$remote_name" >/dev/null 2>&1; then
  git remote set-url "$remote_name" "$remote"
else
  git remote add "$remote_name" "$remote"
fi

git fetch --no-tags "$remote_name" \
  "+refs/heads/repos/${repo_id}/${branch}:refs/remotes/${remote_name}/${branch}"
git checkout -q -B "$branch" "refs/remotes/${remote_name}/${branch}"
git status --short
