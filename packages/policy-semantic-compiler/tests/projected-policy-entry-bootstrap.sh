#!/usr/bin/env bash
set -euo pipefail

bootstrap_root="${BOOTSTRAP_ROOT:-/home/nixos/repos/bootstrap/.worktrees/policy-git-boundary-deletion-gates-260619}"
work="${1:-$(mktemp -d)}"

if [ ! -f "$bootstrap_root/policy-entry.sh" ]; then
  echo "bootstrap policy-entry.sh missing: $bootstrap_root" >&2
  exit 2
fi

mkdir -p "$work/real" "$work/fixture"

policy-semantic-compiler project-policy-entry \
  --out-dir "$work/real" > "$work/real.stdout.json"

set +e
real_output="$(
  POLICY_ENTRY_SOURCE_MODE=projected \
  PROJECTED_POLICY_ENTRY_DIR="$work/real" \
  bash "$bootstrap_root/policy-entry.sh" 2>&1
)"
real_ec=$?
set -e

if [ "$real_ec" -eq 0 ]; then
  echo "bootstrap unexpectedly consumed unaccepted real projection" >&2
  echo "$real_output" >&2
  exit 1
fi
echo "$real_output" | grep -q 'projected policy entry is not accepted and locked'

policy-semantic-compiler project-policy-entry \
  --out-dir "$work/fixture" \
  --fixture-accepted \
  --fixture-reason "bootstrap projected-mode contract test" > "$work/fixture.stdout.json"

fixture_output="$(
  POLICY_ENTRY_SOURCE_MODE=projected \
  PROJECTED_POLICY_ENTRY_DIR="$work/fixture" \
  bash "$bootstrap_root/policy-entry.sh"
)"

echo "$fixture_output" | grep -q 'projected policy entry candidate'
grep -q 'POLICY_ENTRY_FIXTURE_ONLY=true' "$work/fixture/policy-entry.accepted.env"

printf '{"ok":true,"bootstrapRoot":"%s","workDir":"%s"}\n' "$bootstrap_root" "$work"
