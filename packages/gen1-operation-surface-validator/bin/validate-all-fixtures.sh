#!/usr/bin/env bash
set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  if command -v nix >/dev/null 2>&1 && [ "${GEN1_OPERATION_VALIDATOR_NIX_REEXEC:-0}" != "1" ]; then
    export GEN1_OPERATION_VALIDATOR_NIX_REEXEC=1
    exec nix shell nixpkgs#jq --command "$0" "$@"
  fi
  echo "jq is required; install jq or run with nix available for nixpkgs#jq fallback" >&2
  exit 2
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
package_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
repo_root=$(CDPATH= cd -- "$package_root/../.." && pwd)
report_dir=${1:-"$repo_root/packages/ops-cdp-core/evidence/gen1-operation-surface-validator-260621/fresh-replay"}
mkdir -p "$report_dir"

results_jsonl="$report_dir/results.jsonl"
: > "$results_jsonl"

run_fixture() {
  local expected=$1
  local fixture=$2
  local name
  name=$(basename "$fixture" .jsonl)
  local fixture_rel
  fixture_rel=$(realpath --relative-to "$repo_root" "$fixture")
  local report="$report_dir/${name}.validation.json"
  local report_rel
  report_rel=$(realpath --relative-to "$repo_root" "$report")
  local rc=0

  if "$script_dir/validate-gen1-operation-surface.sh" "$fixture" "$report"; then
    rc=0
  else
    rc=$?
  fi

  local ok
  ok=$(jq -r '.ok' "$report")

  local expectation_met=false
  if [ "$expected" = "pass" ] && [ "$rc" -eq 0 ] && [ "$ok" = "true" ]; then
    expectation_met=true
  elif [ "$expected" = "fail" ] && [ "$rc" -ne 0 ] && [ "$ok" = "false" ]; then
    expectation_met=true
  fi

  jq -n -c \
    --arg fixtureRel "$fixture_rel" \
    --arg name "$name" \
    --arg expected "$expected" \
    --argjson exitCode "$rc" \
    --argjson ok "$ok" \
    --argjson expectationMet "$expectation_met" \
    --arg reportRel "$report_rel" \
    '{
      fixture: $fixtureRel,
      name: $name,
      expected: $expected,
      exitCode: $exitCode,
      reportOk: $ok,
      expectationMet: $expectationMet,
      report: $reportRel
    }' >> "$results_jsonl"
}

for fixture in "$package_root"/fixtures/pass/*.jsonl; do
  run_fixture pass "$fixture"
done

for fixture in "$package_root"/fixtures/fail/*.jsonl; do
  run_fixture fail "$fixture"
done

summary="$report_dir/fresh_replay_summary.json"
ops_head=$(git -C "$repo_root" rev-parse HEAD 2>/dev/null || printf "unknown")
jq -s \
  --arg jqVersion "$(jq --version)" \
  --arg nixFallbackUsed "${GEN1_OPERATION_VALIDATOR_NIX_REEXEC:-0}" \
  --arg generatedAtUtc "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg opsHead "$ops_head" \
  '{
    schema: "gen1.operationSurface.freshReplaySummary.v1",
    generatedAtUtc: $generatedAtUtc,
    adrsLawSeedHead: "b1394e4fd6af9c2305fc27deabc554d6c391b8e2",
    opsProposalHeadAtAuthoring: "3be20ab904ffd5aa93590c793a48e1d05903eb69",
    opsProposalHeadAtReplay: $opsHead,
    replayScope: "G24 fresh Gen1/Gen2 operation-surface replay from repo evidence only",
    environment: {
      jqVersion: $jqVersion,
      nixFallbackUsed: ($nixFallbackUsed == "1")
    },
    results: .,
    passFixtures: ([.[] | select(.expected == "pass")] | length),
    failFixtures: ([.[] | select(.expected == "fail")] | length),
    expectationFailures: [.[] | select(.expectationMet != true)],
    result: (if all(.[]; .expectationMet == true) then "PASS" else "FAIL" end),
    approvalGranted: false,
    policyGitDeletionGranted: false,
    cutoverGranted: false,
    canonicalWriteGranted: false,
    ssotAdoptionGranted: false
  }' "$results_jsonl" > "$summary"

if [ "$(jq -r '.result' "$summary")" = "PASS" ]; then
  cat "$summary"
  exit 0
fi

cat "$summary"
exit 1
