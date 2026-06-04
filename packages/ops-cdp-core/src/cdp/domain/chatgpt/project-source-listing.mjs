import { cdpEvaluate } from "../../lib.mjs";

export function listProjectSourcesExpr() {
  return `(() => {
    const isVisible = (el) => {
      if (!el || el.hidden) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const normalizeLines = (text) => String(text || '')
      .split('\\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const sourceTitleFromButton = (button) => {
      let cur = button;
      for (let depth = 0; depth < 12 && cur; depth++) {
        const lines = normalizeLines(cur.innerText || cur.textContent || '');
        const fileIndex = lines.findIndex((line) => line === 'File' || line.startsWith('File ·'));
        if (fileIndex > 0 && fileIndex <= 3) {
          const title = lines[fileIndex - 1];
          if (title && title !== 'Sources' && title !== 'Newest' && title !== 'All') {
            return { title, lines, depth };
          }
        }
        cur = cur.parentElement;
      }
      return null;
    };
    const buttons = Array.from(document.querySelectorAll('button[aria-label="Source actions"]')).filter(isVisible);
    const seen = new Set();
    const sources = [];
    for (const button of buttons) {
      const row = sourceTitleFromButton(button);
      if (!row || !row.title) continue;
      const rect = button.getBoundingClientRect();
      const key = row.title + '@' + Math.round(rect.top) + ':' + Math.round(rect.left);
      if (seen.has(key)) continue;
      seen.add(key);
      const fileLine = row.lines.find((line) => line === 'File' || line.startsWith('File ·')) || 'File';
      sources.push({
        index: sources.length,
        title: row.title,
        kindLine: fileLine,
        lines: row.lines.slice(0, 8),
        sourceActions: {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          width: rect.width,
          height: rect.height,
        },
      });
    }
    return {
      ok: true,
      href: String(location.href || ''),
      title: String(document.title || ''),
      count: sources.length,
      sources,
      textTail: String(document.body && document.body.innerText || '').slice(-4000),
    };
  })()`;
}

export function waitForProjectSourcesLoadedExpr(timeoutMs) {
  const ms = Math.max(0, Number(timeoutMs) || 0);
  return `(() => new Promise((resolve) => {
    const timeoutMs = ${ms};
    const ready = () => {
      const text = String(document.body && document.body.innerText || '');
      const sourceActions = document.querySelectorAll('button[aria-label="Source actions"]').length;
      return {
        ok: text.includes('Add sources') || text.includes('File limit reached') || sourceActions > 0,
        href: String(location.href || ''),
        title: String(document.title || ''),
        sourceActions,
        textTail: text.slice(-1200),
      };
    };
    const first = ready();
    if (first.ok) return resolve({ ...first, waited_ms: 0 });
    const start = Date.now();
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      try { if (mo) mo.disconnect(); } catch (_) {}
      resolve({ ...value, waited_ms: Date.now() - start });
    };
    let mo = null;
    mo = new MutationObserver(() => {
      const now = ready();
      if (now.ok) finish(now);
    });
    try { mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true }); } catch (_) {}
    setTimeout(() => finish(ready()), timeoutMs);
  }))()`;
}

export function listProjectSources(wsUrl, timeoutMs) {
  const resp = cdpEvaluate(wsUrl, listProjectSourcesExpr(), {
    awaitPromise: false,
    returnByValue: true,
    timeoutMs: Math.max(10000, Number(timeoutMs) || 60000),
  });
  return resp && resp.result && resp.result.result ? resp.result.result.value : null;
}
