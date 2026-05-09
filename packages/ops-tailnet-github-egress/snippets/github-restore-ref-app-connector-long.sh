#!/usr/bin/env bash
set -euo pipefail

dest_dir="${1:?usage: github-restore-ref-app-connector-long.sh <dest-dir> <remote> <remote-ref> <local-branch>}"
remote="${2:?usage: github-restore-ref-app-connector-long.sh <dest-dir> <remote> <remote-ref> <local-branch>}"
remote_ref="${3:?usage: github-restore-ref-app-connector-long.sh <dest-dir> <remote> <remote-ref> <local-branch>}"
local_branch="${4:?usage: github-restore-ref-app-connector-long.sh <dest-dir> <remote> <remote-ref> <local-branch>}"

if [[ -e "${dest_dir}/.git" ]]; then
  echo "destination already has .git: ${dest_dir}" >&2
  exit 1
fi

script_dir="$(dirname "$0")"
github_ip="$("${script_dir}/github-route-check.sh" github.com tailscale0 --print-selected-ip)"

old_tcp_mtu_probing="$(sysctl -n net.ipv4.tcp_mtu_probing)"
restore_tcp_mtu_probing() {
  sudo -n sysctl -w "net.ipv4.tcp_mtu_probing=${old_tcp_mtu_probing}" >/dev/null || true
}
trap restore_tcp_mtu_probing EXIT

sudo -n sysctl -w net.ipv4.tcp_mtu_probing=2 >/dev/null

export GIT_SSH_COMMAND="ssh -4 -o HostName=${github_ip} -o HostKeyAlias=github.com -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=30 -o ServerAliveCountMax=4 -o StrictHostKeyChecking=accept-new -o KexAlgorithms=curve25519-sha256 -o HostKeyAlgorithms=ssh-ed25519"

mkdir -p "$dest_dir"
git -C "$dest_dir" init
git -C "$dest_dir" remote add origin "$remote"
git -C "$dest_dir" fetch --progress origin "${remote_ref}:refs/heads/${local_branch}"
git -C "$dest_dir" checkout "$local_branch"
git -C "$dest_dir" status --short
