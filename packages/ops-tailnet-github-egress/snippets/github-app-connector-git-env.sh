#!/usr/bin/env bash
set -euo pipefail

# Source this file before GitHub Git operations that must use the tag:github
# App Connector path.
export GIT_SSH_COMMAND='ssh -4 -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=5 -o ServerAliveCountMax=1 -o StrictHostKeyChecking=accept-new -o KexAlgorithms=curve25519-sha256 -o HostKeyAlgorithms=ssh-ed25519'
