#!/usr/bin/env bash
set -euo pipefail

repo_dir="${1:?usage: github-push-local-app-connector-long.sh <repo-dir> <remote> <refspec>}"
remote="${2:?usage: github-push-local-app-connector-long.sh <repo-dir> <remote> <refspec>}"
refspec="${3:?usage: github-push-local-app-connector-long.sh <repo-dir> <remote> <refspec>}"

script_dir="$(dirname "$0")"
github_ip="$("${script_dir}/github-route-check.sh" github.com tailscale0 --print-selected-ip)"

old_tcp_mtu_probing="$(sysctl -n net.ipv4.tcp_mtu_probing)"
restore_tcp_mtu_probing() {
  sudo -n sysctl -w "net.ipv4.tcp_mtu_probing=${old_tcp_mtu_probing}" >/dev/null || true
}
trap restore_tcp_mtu_probing EXIT

sudo -n sysctl -w net.ipv4.tcp_mtu_probing=2 >/dev/null

export GIT_SSH_COMMAND="ssh -4 -o HostName=${github_ip} -o HostKeyAlias=github.com -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=30 -o ServerAliveCountMax=4 -o StrictHostKeyChecking=accept-new -o KexAlgorithms=curve25519-sha256 -o HostKeyAlgorithms=ssh-ed25519"

git -C "$repo_dir" \
  -c pack.threads=1 \
  -c pack.window=10 \
  -c pack.depth=50 \
  push --progress "$remote" "$refspec"
