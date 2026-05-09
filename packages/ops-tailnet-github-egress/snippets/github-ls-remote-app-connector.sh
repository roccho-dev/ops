#!/usr/bin/env bash
set -euo pipefail

remote="${1:-git@github.com:roccho-dev/refs.git}"
ref="${2:-HEAD}"

"$(dirname "$0")/github-route-check.sh" github.com tailscale0
source "$(dirname "$0")/github-app-connector-git-env.sh"

git ls-remote "$remote" "$ref"
