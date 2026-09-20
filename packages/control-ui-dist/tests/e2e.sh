#!/usr/bin/env bash
set -euo pipefail

: "${DIST:?DIST is required}"
: "${CURL:=curl}"

state="$(mktemp -d)"
log="$(mktemp)"
ready_body="$(mktemp)"
pid=""
cleanup() {
  if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; fi
  rm -rf "$state" "$log" "$ready_body"
}
trap cleanup EXIT

fail_with_log() {
  cat "$log" >&2 || true
  if [[ -s "$ready_body" ]]; then
    printf '%s\n' '--- readiness body ---' >&2
    cat "$ready_body" >&2 || true
  fi
  printf '%s\n' "control-ui-dist e2e: $1" >&2
  exit 1
}

printf '%s\n' '{"id":"policy"}' > "$state/control.jsonl"

CONTROL_STATE_DIR="$state" CONTROL_UI_ROOT="$DIST/share/control-ui" \
  "$DIST/bin/caddy" validate --config "$DIST/config/Caddyfile" --adapter caddyfile

CONTROL_STATE_DIR="$state" "$DIST/bin/control-ui-serve" >"$log" 2>&1 &
pid=$!

ready=0
last_code="000"
for _ in $(seq 1 50); do
  if ! kill -0 "$pid" 2>/dev/null; then
    fail_with_log "server exited before ready"
  fi
  last_code="$("$CURL" --silent --output "$ready_body" --write-out '%{http_code}' http://127.0.0.1:8080/ || true)"
  if [[ "$last_code" =~ ^2[0-9][0-9]$ ]]; then
    ready=1
    break
  fi
  sleep 0.1
done
[[ "$ready" == "1" ]] || fail_with_log "server did not become ready; GET / returned $last_code"

"$CURL" --fail --silent http://127.0.0.1:8080/ | grep -q '<title>Control</title>' || fail_with_log "static UI mismatch"
"$CURL" --fail --silent http://127.0.0.1:8080/data/control.jsonl | grep -q '"id":"policy"' || fail_with_log "control data mismatch"
[[ "$("$CURL" --silent --output /dev/null --write-out '%{http_code}' http://127.0.0.1:8080/data/claims.jsonl)" == "404" ]] || fail_with_log "missing claims must be 404"
printf '%s\n' '{"id":"report"}' > "$state/claims.jsonl"
"$CURL" --fail --silent http://127.0.0.1:8080/data/claims.jsonl | grep -q '"id":"report"' || fail_with_log "claims data mismatch"
[[ "$("$CURL" --silent --output /dev/null --write-out '%{http_code}' http://127.0.0.1:8080/data/unknown.jsonl)" == "404" ]] || fail_with_log "unknown data path must be 404"
[[ "$("$CURL" --silent --request POST --output /dev/null --write-out '%{http_code}' http://127.0.0.1:8080/)" == "405" ]] || fail_with_log "POST must be 405"

kill "$pid"
wait "$pid" || true
pid=""
printf '%s\n' 'control-ui-dist e2e: PASS'
