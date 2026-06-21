#!/usr/bin/env bash
set -euo pipefail
LAW_JSONL="${1:-}"
OP_JSONL="${2:-}"
REPORT="${3:-}"
if [ -z "$LAW_JSONL" ] || [ -z "$OP_JSONL" ]; then echo "usage: $0 <law.jsonl> <operation-log.jsonl> [report.json]" >&2; exit 2; fi
if [ -n "$REPORT" ]; then
  mkdir -p "$(dirname "$REPORT")"
  jq -n --slurpfile law "$LAW_JSONL" --slurpfile ops "$OP_JSONL" -f "$(dirname "$0")/../lib/validate-chatgpt-operation-log.jq" > "$REPORT"
  jq -e '.status == "PASS"' "$REPORT" >/dev/null
else
  jq -n --slurpfile law "$LAW_JSONL" --slurpfile ops "$OP_JSONL" -f "$(dirname "$0")/../lib/validate-chatgpt-operation-log.jq"
fi
