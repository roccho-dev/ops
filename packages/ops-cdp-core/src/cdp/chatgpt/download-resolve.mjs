import { locateDownloadArtifactExpr, locateFileChipExpr } from "./artifacts.mjs";
import { scrollToBottomExpr } from "./input.mjs";
import { sleepMs } from "../lib.mjs";

function semanticLocator(loc, name) {
  const row = loc || {};
  const fallbackName = String(name || "");
  return {
    kind: String(row.kind || "chip"),
    label: String(row.label || fallbackName),
    href: String(row.href || ""),
    match: String(row.match || ""),
  };
}

export function resolveNamedDownloadTargets(evalByValue, names, opts) {
  const options = opts || {};
  const rows = [];

  if (!options.skipScroll) {
    evalByValue(scrollToBottomExpr(options.scrollRootSelector || ""), 60000);
    evalByValue(scrollToBottomExpr(options.scrollRootSelector || ""), 60000);
  }

  for (const rawName of (Array.isArray(names) ? names : [])) {
    const name = String(rawName || "");
    let loc = evalByValue(locateDownloadArtifactExpr(name), 60000);
    if ((!loc || !loc.ok) && options.allowFileChipFallback) {
      loc = evalByValue(locateFileChipExpr(name), 60000);
    }
    if (!loc || !loc.ok) {
      rows.push({
        name,
        ok: false,
        error: options.allowFileChipFallback ? "chip_not_found" : "file_not_in_conversation",
        locator: loc || null,
        download: {
          method: "chip_click",
          filename_expected: name,
        },
      });
      continue;
    }
    const locator = semanticLocator(loc, name);
    rows.push({
      name,
      ok: true,
      locator,
      download: {
        method: locator.kind === "sandbox_link" ? "sandbox_link" : "chip_click",
        filename_expected: name,
      },
    });
  }

  return rows;
}

export function resolveNamedDownloadTargetsWithPolicy(evalByValue, names, opts) {
  const options = opts || {};
  const policy = options.policy || {};
  const allowPolling = policy.allowMaterializePolling === true;
  const materializePollMs = Math.max(15000, Number(policy.materializePollMs) || 15000);
  const maxAttempts = Math.max(1, Math.trunc(Number(policy.maxAttempts) || 1) || 1);

  let attempts = 0;
  let evaluateCount = 0;
  let totalWaitMs = 0;
  let lastTargets = [];
  while (attempts < maxAttempts) {
    attempts += 1;
    lastTargets = resolveNamedDownloadTargets(evalByValue, names, options);
    const scrollCount = options.skipScroll ? 0 : 2;
    const perName = lastTargets.reduce((sum, row) => {
      const fallbackHit = options.allowFileChipFallback && row && row.ok !== true &&
        String(row.error || "") === "chip_not_found";
      return sum + 1 + (fallbackHit ? 1 : 0);
    }, 0);
    evaluateCount += scrollCount + perName;
    if (lastTargets.every((row) => row && row.ok === true)) break;
    if (!allowPolling || attempts >= maxAttempts) break;
    sleepMs(materializePollMs);
    totalWaitMs += materializePollMs;
  }

  return {
    targets: lastTargets,
    stats: {
      attempts,
      waited_ms: totalWaitMs,
      polled: attempts > 1,
      evaluate_count: evaluateCount,
    },
  };
}
