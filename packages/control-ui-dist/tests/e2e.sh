#!/usr/bin/env bash
set -euo pipefail

: "${DIST:?DIST is required}"
: "${CURL:=curl}"

state="$(mktemp -d)"
log="$(mktemp)"
pid=""
cleanup() {
  if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; fi
  rm -rf "$state" "$log"
}
trap cleanup EXIT

printf '%s\n' '{"id":"policy"}' > "$state/control.jsonl"

CONTROL_STATE_DIR="$state" CONTROL_UI_ROOT="$DIST/share/control-ui" \
  "$DIST/bin/caddy" validate --config "$DIST/config/Caddyfile" --adapter caddyfile

CONTROL_STATE_DIR="$state" "$DIST/bin/control-ui-serve" >"$log" 2>&1 &
pid=$!

for _ in $(seq 1 50); do
  if "$CURL" --fail --silent http://127.0.0.1:8080/ >/dev/null 2>&1; then break; fi
  sleep 0.1
done

"$CURL" --fail --silent http://127.0.0.1:8080/ | grep -q '<title>Control</title>'
"$CURL" --fail --silent http://127.0.0.1:8080/data/control.jsonl | grep -q '"id":"policy"'
[[ "$("$CURL" --silent --output /dev/null --write-out '%{http_code}' http://127.0.0.1:8080/data/claims.jsonl)" == "404" ]]
printf '%s\n' '{"id":"report"}' > "$state/claims.jsonl"
"$CURL" --fail --silent http://127.0.0.1:8080/data/claims.jsonl | grep -q '"id":"report"'
[[ "$("$CURL" --silent --output /dev/null --write-out '%{http_code}' http://127.0.0.1:8080/data/unknown.jsonl)" == "404" ]]
[[ "$("$CURL" --silent --request POST --output /dev/null --write-out '%{http_code}' http://127.0.0.1:8080/)" == "405" ]]

kill "$pid"
wait "$pid" || true
pid=""
printf '%s\n' 'control-ui-dist e2e: PASS'
