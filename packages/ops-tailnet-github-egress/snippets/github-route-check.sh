#!/usr/bin/env bash
set -euo pipefail

domain="${1:-github.com}"
expected_device="${2:-tailscale0}"
mode="${3:-routes}"

if [[ "${mode}" != "routes" && "${mode}" != "--print-selected-ip" ]]; then
  echo "usage: github-route-check.sh [domain] [expected-device] [--print-selected-ip]" >&2
  exit 2
fi

resolve_ipv4s() {
  local hosts=""
  for _ in 1 2 3; do
    hosts="$(getent ahostsv4 "${domain}" || true)"
    if [[ -n "${hosts}" ]]; then
      awk '{print $1}' <<<"${hosts}" \
        | grep -E '^[0-9]+[.][0-9]+[.][0-9]+[.][0-9]+$' \
        | awk '!seen[$0]++'
      return 0
    fi
    sleep 1
  done
}

mapfile -t github_ipv4s < <(resolve_ipv4s)
if [[ "${#github_ipv4s[@]}" -eq 0 ]]; then
  echo "no IPv4 address found for ${domain}" >&2
  exit 1
fi

selected_ip=""
for addr in "${github_ipv4s[@]}"; do
  if ! route="$(ip route get "${addr}" 2>&1)"; then
    printf '%s\n' "${route}" >&2
    echo "route gate failed: could not inspect route for ${domain} (${addr})" >&2
    exit 1
  fi
  if [[ "${mode}" == "--print-selected-ip" ]]; then
    printf '%s\n' "${route}" >&2
  else
    printf '%s\n' "${route}"
  fi

  if [[ " ${route} " != *" dev ${expected_device} "* ]]; then
    echo "route gate failed: ${domain} (${addr}) is not routed through ${expected_device}" >&2
    exit 1
  fi
  if [[ -z "${selected_ip}" ]]; then
    selected_ip="${addr}"
  fi
done

if [[ "${mode}" == "--print-selected-ip" ]]; then
  printf '%s\n' "${selected_ip}"
fi
