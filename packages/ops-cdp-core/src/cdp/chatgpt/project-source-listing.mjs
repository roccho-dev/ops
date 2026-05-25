import { cdpEvaluate } from "../lib.mjs";

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
    const isSourceKindLine = (line) => {
      return line === 'File'
        || line === 'Document'
        || line === 'Zip Archive'
        || line.startsWith('File ·')
        || line.startsWith('Document ·')
        || line.startsWith('Zip Archive ·');
    };
    const ignoredTitles = new Set([
      'Sources',
      'Newest',
      'All',
      'Add sources',
      'Give ChatGPT more context',
      'Upload sources, link drives, or connect apps like Slack to give ChatGPT deeper context about your project.',
    ]);
    const looksLikeSourceTitle = (line) => {
      if (!line || ignoredTitles.has(line) || isSourceKindLine(line)) return false;
      if (line.length > 180) return false;
      return /\\.(md|markdown|txt|json|jsonl|yaml|yml|toml|csv|tsv|sha256|zip|tar|tgz|gz|patch|diff|bundle)$/i.test(line);
    };
    const sourceTitleFromButton = (button) => {
      let cur = button;
      for (let depth = 0; depth < 12 && cur; depth++) {
        const lines = normalizeLines(cur.innerText || cur.textContent || '');
        const fileIndex = lines.findIndex(isSourceKindLine);
        if (fileIndex > 0 && fileIndex <= 3) {
          const title = lines[fileIndex - 1];
          if (looksLikeSourceTitle(title)) {
            return { title, lines, depth };
          }
        }
        cur = cur.parentElement;
      }
      return null;
    };
    const collectUnparsedVisibleSourceHints = (lines, parsedTitles) => {
      const hints = [];
      const seenHints = new Set();
      for (let i = 0; i < lines.length; i++) {
        const title = lines[i];
        if (!looksLikeSourceTitle(title) || parsedTitles.has(title)) continue;
        const next = lines.slice(i + 1, i + 4);
        const kindLine = next.find(isSourceKindLine) || '';
        if (!kindLine) continue;
        const key = title + '|' + kindLine;
        if (seenHints.has(key)) continue;
        seenHints.add(key);
        hints.push({
          index: hints.length,
          title,
          kindLine,
          lineIndex: i,
          lines: [title, ...next].slice(0, 4),
        });
      }
      return hints;
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
      const fileLine = row.lines.find(isSourceKindLine) || 'File';
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
    const bodyText = String(document.body && document.body.innerText || '');
    const textLines = normalizeLines(bodyText);
    const parsedTitles = new Set(sources.map((source) => source.title));
    const unparsedVisibleSourceHints = collectUnparsedVisibleSourceHints(textLines, parsedTitles);
    const parserStatus = sources.length > 0
      ? 'parsed-source-actions'
      : (unparsedVisibleSourceHints.length > 0 ? 'unparsed-visible-source-hints' : 'empty-or-no-visible-source-hints');
    return {
      ok: true,
      href: String(location.href || ''),
      title: String(document.title || ''),
      count: sources.length,
      sources,
      parserStatus,
      unparsedVisibleSourceCount: unparsedVisibleSourceHints.length,
      unparsedVisibleSourceHints,
      textTail: bodyText.slice(-4000),
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
