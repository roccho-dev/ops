import * as std from "./std.mjs";
import { cdpList, cdpVersion, cdpWsUrl } from "./cdp-client.mjs";
import { getDefaultAddr, getDefaultPort } from "./config.mjs";
import { runToString } from "./proc.mjs";

const DEFAULT_SCAN_PORTS = [9222, 9223, 9224, 9225];

function uniquePorts(requestedPort) {
  const out = [];
  const push = (value) => {
    const port = Number(value) || 0;
    if (port <= 0) return;
    if (out.indexOf(port) >= 0) return;
    out.push(port);
  };
  push(requestedPort);
  for (const port of DEFAULT_SCAN_PORTS) push(port);
  return out;
}

function shellQuote(value) {
  return `'${String(value || "").replace(/'/g, `'"'"'`)}'`;
}

function scanPorts(addr, requestedPort) {
  const ports = uniquePorts(requestedPort);
  try {
    const escapedAddr = String(addr).replace(/\./g, "\\.");
    const ssOut = runToString(`ss -lnt 2>/dev/null | awk '$4 ~ /${escapedAddr}:[0-9]+$/ { split($4, a, ":"); print a[length(a)] }'`);
    for (const line of String(ssOut || "").split(/\r?\n/)) pushPort(ports, line);
  } catch {
    // ignore ss probe failures; default ports still work
  }
  const rows = [];
  for (const value of ports) {
    const port = Number(value) || 0;
    if (!port) continue;
    try {
      const raw = runToString(`cdp-bridge version --addr ${shellQuote(addr)} --port ${shellQuote(String(port))} 2>/dev/null || true`).trim();
      if (!raw) continue;
      rows.push({ ok: true, port, version: JSON.parse(raw) });
    } catch {
      // ignore non-CDP ports
    }
  }
  return rows;
}

function pushPort(out, value) {
  const port = Number(value) || 0;
  if (port <= 0) return;
  if (out.indexOf(port) >= 0) return;
  out.push(port);
}

function foundAlternative(scan, requestedPort) {
  return scan.find((row) => row && row.ok && Number(row.port) !== Number(requestedPort)) || null;
}

function formatFailure(addr, port, err, scan) {
  const lines = [];
  lines.push(`Chrome CDP not available at ${addr}:${port}.`);
  lines.push(`Requested probe failed: ${String(err && err.message ? err.message : err)}`);

  const alt = foundAlternative(scan, port);
  if (alt) {
    lines.push("");
    lines.push(`CDP was found on port ${alt.port} instead.`);
    lines.push(`Retry with: --port ${alt.port}`);
    return lines.join("\n");
  }

  const okPorts = scan.filter((row) => row && row.ok).map((row) => row.port);
  lines.push("");
  if (okPorts.length > 0) {
    lines.push(`Detected CDP ports: ${okPorts.join(", ")}`);
  } else {
    lines.push(`Scanned ports: ${uniquePorts(port).join(", ")}`);
  }
  lines.push("Repair:");
  lines.push("  chromedevtoolprotocol-service-profile-bootstrap start");
  lines.push(`  chromium-cdp --remote-debugging-port=${port}`);
  lines.push("Then retry the same command.");
  return lines.join("\n");
}

export function requireCdp(addr, port) {
  const host = String(addr || getDefaultAddr());
  const requestedPort = Number(port) || getDefaultPort();
  try {
    const version = cdpVersion(host, requestedPort);
    const wsUrl = (() => {
      try { return cdpWsUrl(host, requestedPort); } catch { return null; }
    })();
    const targets = cdpList(host, requestedPort);
    return {
      addr: host,
      port: requestedPort,
      version,
      wsUrl,
      targets: Array.isArray(targets) ? targets : [],
    };
  } catch (e) {
    const scan = scanPorts(host, requestedPort);
    throw new Error(formatFailure(host, requestedPort, e, scan));
  }
}

export function probeCdpPorts(addr, port) {
  const host = String(addr || getDefaultAddr());
  const requestedPort = Number(port) || getDefaultPort();
  return scanPorts(host, requestedPort);
}
