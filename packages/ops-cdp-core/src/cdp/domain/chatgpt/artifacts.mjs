export function locateFileChipExpr(name) {
  const nameJson = JSON.stringify(String(name || ""));
  return `(() => {
    const name = ${nameJson};
    const norm = (s) => String(s || "").trim();
    const isVisible = (el) => !!el && !el.hidden && getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden";

    const buttons = Array.from(document.querySelectorAll("button")).filter(isVisible);
    let el =
      buttons.find((b) => norm(b.innerText) === name) ||
      buttons.find((b) => norm(b.textContent) === name) ||
      buttons.find((b) => norm(b.getAttribute("aria-label")) === name) ||
      buttons.find((b) => norm(b.getAttribute("title")) === name) ||
      buttons.find((b) => norm(b.innerText).includes(name)) ||
      buttons.find((b) => norm(b.textContent).includes(name));

    if (!el) return { ok: false, reason: "not_found" };
    try { el.scrollIntoView({ block: "center", inline: "center" }); } catch (_) {}
    const r = el.getBoundingClientRect();
    return { ok: true, kind: "chip", x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  })()`;
}

export function listDownloadArtifactsExpr() {
  return `(() => {
    const norm = (s) => String(s || '').trim();
    const safeDecode = (s) => {
      try { return decodeURIComponent(String(s || '')); } catch (_) { return String(s || ''); }
    };
    const fileNameOfHref = (href) => {
      const decoded = safeDecode(href);
      const clean = decoded.split('#')[0].split('?')[0];
      const slash = clean.lastIndexOf('/');
      return slash >= 0 ? clean.slice(slash + 1) : clean;
    };
    const isVisible = (el) => {
      if (!el || el.hidden) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const isFileName = (text) => {
      const t = norm(text);
      if (!t || !t.includes('.')) return false;
      if (t.length > 200) return false;
      return /\\.[A-Za-z0-9_-]{1,16}$/.test(t);
    };
    const isArtifactLabel = (text) => {
      const t = norm(text);
      if (!isFileName(t)) return false;
      if (/^open (project|conversation) options for /i.test(t)) return false;
      return true;
    };

    const out = [];
    const seen = new Set();
    const push = (row) => {
      const key = JSON.stringify([row.name, row.kind, row.href || '']);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(row);
    };

    const elementLabel = (el) =>
      norm(el.innerText) ||
      norm(el.textContent) ||
      norm(el.getAttribute('aria-label')) ||
      norm(el.getAttribute('title'));
    const findSandboxHref = (value, name, seen, depth) => {
      if (!value || depth > 5) return '';
      if (typeof value === 'string') {
        return value.startsWith('sandbox:') && (!name || value.includes(name)) ? value : '';
      }
      if (typeof value !== 'object' && typeof value !== 'function') return '';
      if (seen.has(value)) return '';
      seen.add(value);
      if (typeof value.href === 'string' && value.href.startsWith('sandbox:') && (!name || value.href.includes(name))) {
        return value.href;
      }
      if (value.properties && typeof value.properties.href === 'string' && value.properties.href.startsWith('sandbox:') && (!name || value.properties.href.includes(name))) {
        return value.properties.href;
      }
      const keys = Object.keys(value).slice(0, 80);
      for (const key of keys) {
        if (!/href|props|children|node|properties|pendingProps|memoizedProps|alternate|child|return/i.test(key)) continue;
        try {
          const hit = findSandboxHref(value[key], name, seen, depth + 1);
          if (hit) return hit;
        } catch (_) {}
      }
      return '';
    };
    const reactSandboxHref = (el, name) => {
      let cur = el;
      for (let depth = 0; cur && depth < 8; depth++, cur = cur.parentElement) {
        for (const key of Object.keys(cur)) {
          if (!key.startsWith('__reactProps') && !key.startsWith('__reactFiber')) continue;
          try {
            const hit = findSandboxHref(cur[key], name, new WeakSet(), 0);
            if (hit) return hit;
          } catch (_) {}
        }
      }
      return '';
    };

    const buttons = Array.from(document.querySelectorAll('button')).filter(isVisible);
    for (const b of buttons) {
      const label = elementLabel(b);
      if (!isArtifactLabel(label)) continue;
      const sandboxHref = reactSandboxHref(b, label);
      push({
        name: label,
        kind: sandboxHref ? 'sandbox_button' : 'chip',
        label,
        href: sandboxHref,
        match: sandboxHref ? 'react_sandbox_href' : 'button',
      });
    }

    const links = Array.from(document.querySelectorAll('a[href]')).filter(isVisible);
    for (const a of links) {
      const href = String(a.getAttribute('href') || '');
      const download = norm(a.getAttribute('download'));
      const label = norm(a.innerText) || download || fileNameOfHref(href);
      if (!isArtifactLabel(label)) continue;
      const kind = href.includes('sandbox:/') ? 'sandbox_link' : (download ? 'download_link' : 'link');
      if (kind !== 'sandbox_link' && kind !== 'download_link') continue;
      push({
        name: label,
        kind,
        label,
        href,
        match: kind,
      });
    }

    return { ok: true, artifacts: out };
  })()`;
}

export function locateDownloadArtifactExpr(name) {
  const nameJson = JSON.stringify(String(name || ""));
  return `(() => {
    const name = String(${nameJson} || '');
    const lowerName = name.toLowerCase();
    const norm = (s) => String(s || '').trim();
    const low = (s) => norm(s).toLowerCase();
    const safeDecode = (s) => {
      try { return decodeURIComponent(String(s || '')); } catch (_) { return String(s || ''); }
    };
    const fileNameOfHref = (href) => {
      const decoded = safeDecode(href);
      const clean = decoded.split('#')[0].split('?')[0];
      const slash = clean.lastIndexOf('/');
      return slash >= 0 ? clean.slice(slash + 1) : clean;
    };
    const isVisible = (el) => {
      if (!el || el.hidden) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const matchesName = (value) => {
      const text = low(value);
      return !!text && (text === lowerName || text.includes(lowerName));
    };
    const asHit = (el, kind, extra) => {
      try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) {}
      const r = el.getBoundingClientRect();
      return {
        ok: true,
        kind,
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        w: r.width,
        h: r.height,
        label: norm(el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || ''),
        href: String(el.getAttribute('href') || ''),
        download: String(el.getAttribute('download') || ''),
        ...extra,
      };
    };
    const findSandboxHref = (value, seen, depth) => {
      if (!value || depth > 5) return '';
      if (typeof value === 'string') {
        return value.startsWith('sandbox:') && matchesName(value) ? value : '';
      }
      if (typeof value !== 'object' && typeof value !== 'function') return '';
      if (seen.has(value)) return '';
      seen.add(value);
      if (typeof value.href === 'string' && value.href.startsWith('sandbox:') && matchesName(value.href)) return value.href;
      if (value.properties && typeof value.properties.href === 'string' && value.properties.href.startsWith('sandbox:') && matchesName(value.properties.href)) {
        return value.properties.href;
      }
      const keys = Object.keys(value).slice(0, 80);
      for (const key of keys) {
        if (!/href|props|children|node|properties|pendingProps|memoizedProps|alternate|child|return/i.test(key)) continue;
        try {
          const hit = findSandboxHref(value[key], seen, depth + 1);
          if (hit) return hit;
        } catch (_) {}
      }
      return '';
    };
    const reactSandboxHref = (el) => {
      let cur = el;
      for (let depth = 0; cur && depth < 8; depth++, cur = cur.parentElement) {
        for (const key of Object.keys(cur)) {
          if (!key.startsWith('__reactProps') && !key.startsWith('__reactFiber')) continue;
          try {
            const hit = findSandboxHref(cur[key], new WeakSet(), 0);
            if (hit) return hit;
          } catch (_) {}
        }
      }
      return '';
    };

    const buttons = Array.from(document.querySelectorAll('button')).filter(isVisible);
    let el =
      buttons.find((b) => matchesName(b.innerText)) ||
      buttons.find((b) => matchesName(b.textContent)) ||
      buttons.find((b) => matchesName(b.getAttribute('aria-label'))) ||
      buttons.find((b) => matchesName(b.getAttribute('title')));
    if (el) {
      const sandboxHref = reactSandboxHref(el);
      return asHit(el, sandboxHref ? 'sandbox_button' : 'chip', {
        match: sandboxHref ? 'react_sandbox_href' : 'button',
        href: sandboxHref || String(el.getAttribute('href') || ''),
        fileNameFromHref: sandboxHref ? fileNameOfHref(sandboxHref) : '',
      });
    }

    const sandboxLinks = Array.from(document.querySelectorAll('a[href]'))
      .filter(isVisible)
      .filter((a) => String(a.getAttribute('href') || '').includes('sandbox:/'));
    el =
      sandboxLinks.find((a) => matchesName(a.innerText)) ||
      sandboxLinks.find((a) => matchesName(a.getAttribute('aria-label'))) ||
      sandboxLinks.find((a) => matchesName(a.getAttribute('title'))) ||
      sandboxLinks.find((a) => matchesName(a.getAttribute('download'))) ||
      sandboxLinks.find((a) => matchesName(fileNameOfHref(a.getAttribute('href'))));
    if (el) {
      return asHit(el, 'sandbox_link', {
        match: 'sandbox_link',
        fileNameFromHref: fileNameOfHref(el.getAttribute('href')),
      });
    }

    return {
      ok: false,
      reason: 'not_found',
      searched: {
        button_count: buttons.length,
        sandbox_link_count: sandboxLinks.length,
      },
    };
  })()`;
}

export function clickSandboxLinkExpr(href) {
  const hrefJson = JSON.stringify(String(href || ""));
  return `(() => {
    const href = ${hrefJson};
    const isVisible = (el) => {
      if (!el || el.hidden) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const link = Array.from(document.querySelectorAll('a[href]'))
      .find((a) => String(a.getAttribute('href') || '') === href && isVisible(a));
    if (!link) return { ok: false, reason: 'sandbox_link_not_found', href };
    try { link.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) {}
    try { link.click(); } catch (error) { return { ok: false, reason: 'click_failed', href, error: String(error) }; }
    return { ok: true, href };
  })()`;
}
