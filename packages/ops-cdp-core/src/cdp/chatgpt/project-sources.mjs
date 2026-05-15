import { extractProjectId } from "./shared.mjs";

export function projectSourcesUrl(projectUrl) {
  const url = String(projectUrl || "");
  if (url.includes("tab=sources")) return url;
  if (url.includes("?")) return url + "&tab=sources";
  return url + "?tab=sources";
}

export function projectSourcesHrefMatches(href, wantUrl) {
  const current = String(href || "");
  const want = String(wantUrl || "");
  if (!current || !want) return false;
  if (current === want || current.startsWith(want)) return true;
  const projectId = extractProjectId(want);
  return !!(projectId && current.includes("/project") && current.includes(projectId));
}

export function pickProjectSourcesTarget(targets, args, url) {
  const pages = (targets || []).filter((t) => t && t.type === "page" && t.webSocketDebuggerUrl);
  const options = args || {};
  if (options.id) {
    const target = pages.find((x) => String(x.id || "") === String(options.id));
    if (!target) throw new Error(`target not found by --id: ${options.id}`);
    return target;
  }
  let candidates = pages.filter((t) => String(t.url || "") === String(url || ""));
  if (candidates.length === 0) candidates = pages.filter((t) => String(t.url || "").startsWith(String(url || "")));
  if (candidates.length === 0) {
    const projectId = extractProjectId(url);
    if (projectId) {
      candidates = pages.filter((t) => String(t.url || "").includes(projectId) && String(t.url || "").includes("/project"));
    }
  }
  return candidates.length ? candidates[0] : null;
}

export function waitForProjectSourcesUrlExpr(wantUrl, timeoutMs) {
  const want = JSON.stringify(String(wantUrl || ""));
  const ms = Math.max(0, Number(timeoutMs) || 0);
  return `(() => new Promise((resolve) => {
    const want = ${want};
    const timeoutMs = ${ms};
    const projectId = (want.match(/\/g\/([^/]+)\/project/) || [])[1] || '';
    const matches = () => {
      const href = String(location.href || '');
      const ok = href === want || href.startsWith(want) || (projectId && href.includes('/project') && href.includes(projectId));
      return { ok, href, readyState: document.readyState, title: document.title };
    };
    const first = matches();
    if (first.ok && document.readyState !== 'loading') return resolve({ ...first, waited_ms: 0 });
    const start = Date.now();
    const timer = setInterval(() => {
      const now = matches();
      if (now.ok && document.readyState !== 'loading') {
        clearInterval(timer);
        resolve({ ...now, waited_ms: Date.now() - start });
      }
    }, 250);
    setTimeout(() => {
      clearInterval(timer);
      const last = matches();
      resolve({ ...last, waited_ms: Date.now() - start, timed_out: !last.ok });
    }, timeoutMs);
  }))()`;
}

export function waitForProjectSourceVisibleExpr(fileName, timeoutMs) {
  const name = JSON.stringify(String(fileName || ""));
  const ms = Math.max(0, Number(timeoutMs) || 0);
  return `(() => new Promise((resolve) => {
    const fileName = ${name};
    const timeoutMs = ${ms};
    const scan = () => {
      const text = String(document.body && document.body.innerText || '');
      return {
        ok: text.includes(fileName),
        href: location.href,
        title: document.title,
        inaccessibleHint: text.includes(fileName) && text.includes('File contents may not be accessible'),
        textTail: text.slice(-2500),
      };
    };
    const first = scan();
    if (first.ok) return resolve({ ...first, waited_ms: 0 });
    const start = Date.now();
    let done = false;
    let mo = null;
    const finish = (value) => {
      if (done) return;
      done = true;
      try { if (mo) mo.disconnect(); } catch (_) {}
      resolve({ ...value, waited_ms: Date.now() - start });
    };
    mo = new MutationObserver(() => {
      const now = scan();
      if (now.ok) finish(now);
    });
    try { mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true }); } catch (_) {}
    setTimeout(() => finish(scan()), timeoutMs);
  }))()`;
}
