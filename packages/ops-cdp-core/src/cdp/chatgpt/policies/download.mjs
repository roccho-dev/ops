import * as std from "qjs:std";

function envBool(name, fallback) {
  const raw = std.getenv(name);
  if (raw === null || raw === undefined || raw === "") return !!fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") return true;
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") return false;
  return !!fallback;
}

function envNumber(name, fallback) {
  const raw = std.getenv(name);
  if (raw === null || raw === undefined || raw === "") return Number(fallback) || 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : (Number(fallback) || 0);
}

export const DOWNLOAD_POLICY = Object.freeze({
  resolve: Object.freeze({
    allowMaterializePolling: envBool("HQ_CDP_DOWNLOAD_ALLOW_MATERIALIZE_POLLING", false),
    materializePollMs: Math.max(15000, envNumber("HQ_CDP_DOWNLOAD_MATERIALIZE_POLL_MS", 15000)),
    maxAttempts: Math.max(1, Math.trunc(envNumber("HQ_CDP_DOWNLOAD_MATERIALIZE_MAX_ATTEMPTS", 6)) || 6),
  }),
  fetch: Object.freeze({
    filePollMs: Math.max(50, envNumber("HQ_CDP_DOWNLOAD_FILE_POLL_MS", 200)),
    afterClickMs: Math.max(0, envNumber("HQ_CDP_DOWNLOAD_AFTER_CLICK_MS", 200)),
  }),
});

export function buildDownloadResolvePolicy(overrides) {
  const opts = overrides || {};
  return {
    allowMaterializePolling: opts.waitForMaterialize === true
      ? true
      : DOWNLOAD_POLICY.resolve.allowMaterializePolling,
    materializePollMs: Math.max(
      15000,
      Number(opts.materializePollMs) || DOWNLOAD_POLICY.resolve.materializePollMs,
    ),
    maxAttempts: Math.max(
      1,
      Math.trunc(Number(opts.maxAttempts) || DOWNLOAD_POLICY.resolve.maxAttempts) || DOWNLOAD_POLICY.resolve.maxAttempts,
    ),
  };
}

export function buildDownloadFetchPolicy(overrides) {
  const opts = overrides || {};
  return {
    filePollMs: Math.max(50, Number(opts.pollMs) || DOWNLOAD_POLICY.fetch.filePollMs),
    afterClickMs: Math.max(0, Number(opts.afterClickMs) || DOWNLOAD_POLICY.fetch.afterClickMs),
  };
}
