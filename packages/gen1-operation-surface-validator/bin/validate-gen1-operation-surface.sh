#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 INPUT.jsonl REPORT.json" >&2
  exit 2
fi

input=$1
report=$2
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root=$(CDPATH= cd -- "$script_dir/.." && pwd)

jq -s -f "$root/lib/validate-gen1-operation-surface.jq" "$input" > "$report"
if [ "$(jq -r '.ok' "$report")" = "true" ]; then
  exit 0
fi
exit 1
