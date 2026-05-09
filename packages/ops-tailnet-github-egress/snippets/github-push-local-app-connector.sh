#!/usr/bin/env bash
set -euo pipefail

repo_dir="${1:?usage: github-push-local-app-connector.sh <repo-dir> <remote> <refspec>}"
remote="${2:?usage: github-push-local-app-connector.sh <repo-dir> <remote> <refspec>}"
refspec="${3:?usage: github-push-local-app-connector.sh <repo-dir> <remote> <refspec>}"

"$(dirname "$0")/github-route-check.sh" github.com tailscale0
source "$(dirname "$0")/github-app-connector-git-env.sh"

git -C "$repo_dir" push "$remote" "$refspec"
