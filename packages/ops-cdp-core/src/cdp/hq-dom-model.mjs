// DOM-based model detection helpers for ChatGPT pages.
// Runtime: quickjs-ng (qjs) with `--std`.
//
// These helpers return *expressions* that are evaluated inside the page context
// via CDP Runtime.evaluate.

function domModelReadSource() {
  // Keep the page-context code JSON-safe (no template literals inside).
  return (
    "  const norm = (s) => String(s || '').trim().replace(/\\s+/g, ' ');\n" +
    "  const sels = [\n" +
    "    'button[data-testid=\\\"model-switcher-dropdown-button\\\"]',\n" +
    "    'button[aria-label*=\\\"Model selector\\\" i]',\n" +
    "    'button[aria-label*=\\\"current model\\\" i]',\n" +
    "  ];\n" +
    "  const pick = () => {\n" +
    "    for (let i = 0; i < sels.length; i += 1) {\n" +
    "      try {\n" +
    "        const el = document.querySelector(sels[i]);\n" +
    "        if (el) return el;\n" +
    "      } catch (_) {}\n" +
    "    }\n" +
    "    return null;\n" +
    "  };\n" +
    "  const read = () => {\n" +
    "    const btn = pick();\n" +
    "    const modelText = btn ? String(btn.innerText || btn.textContent || '') : '';\n" +
    "    const modelAria = btn ? String(btn.getAttribute('aria-label') || '') : '';\n" +
    "    const isVisible = (el) => {\n" +
    "      if (!el || el.hidden) return false;\n" +
    "      const s = getComputedStyle(el);\n" +
    "      if (s.display === 'none' || s.visibility === 'hidden') return false;\n" +
    "      const r = el.getBoundingClientRect();\n" +
    "      return r.width > 1 && r.height > 1;\n" +
    "    };\n" +
    "    const extendedSelectors = [\n" +
    "      'button.__composer-pill',\n" +
    "      '.__composer-pill-composite > button',\n" +
    "      '.__composer-pill-composite button[aria-label*=\\\"Extended Pro\\\" i]',\n" +
    "      'button[aria-label*=\\\"Extended Pro\\\" i]'\n" +
    "    ];\n" +
    "    const extendedNodes = extendedSelectors.flatMap((sel) => { try { return Array.from(document.querySelectorAll(sel)); } catch (_) { return []; } });\n" +
    "    const extendedNode = extendedNodes.find((el) => isVisible(el) && /\\bextended\\s+pro\\b/i.test(String(el.innerText || el.textContent || el.getAttribute('aria-label') || '')));\n" +
    "    const extendedText = extendedNode ? String(extendedNode.innerText || extendedNode.textContent || extendedNode.getAttribute('aria-label') || '') : '';\n" +
    "    const extendedProModel = /\\bextended\\s+pro\\b/i.test(extendedText);\n" +
    "    const proModel = /\\bpro\\b/i.test(modelText) || /\\bpro\\b/i.test(modelAria) || extendedProModel;\n" +
    "    const profileBtn = document.querySelector('[data-testid=\\\"accounts-profile-button\\\"]');\n" +
    "    const profileText = profileBtn ? String(profileBtn.innerText || profileBtn.textContent || '') : '';\n" +
    "    const proPlan = /\\bpro\\b/i.test(profileText);\n" +
    "    return {\n" +
    "      found: !!btn,\n" +
    "      model_text: norm(modelText || modelAria),\n" +
    "      model_aria: norm(modelAria),\n" +
    "      pro_model: proModel,\n" +
    "      extended_pro_model: extendedProModel,\n" +
    "      extended_pro_text: norm(extendedText),\n" +
    "      profile_text: norm(profileText),\n" +
    "      pro_plan_badge: proPlan,\n" +
    "    };\n" +
    "  };\n"
  );
}

export function domModelSnapshotExpr() {
  return "(() => {\n" + domModelReadSource() + "  return read();\n" + "})()";
}

export function waitForDomModelExpr(timeoutMs) {
  const ms = Math.max(0, Number(timeoutMs) || 0);
  // Bounded wait for a model switcher candidate to appear.
  return (
    "(() => new Promise((resolve) => {\n" +
    domModelReadSource() +
    "  if (pick()) return resolve(read());\n" +
    "  let done = false;\n" +
    "  const finish = () => { if (done) return; done = true; try { mo.disconnect(); } catch (_) {} resolve(read()); };\n" +
    "  const mo = new MutationObserver(() => { if (pick()) finish(); });\n" +
    "  try { mo.observe(document.documentElement, { subtree: true, childList: true }); } catch (_) {}\n" +
    `  setTimeout(() => finish(), ${ms});\n` +
    "}))()"
  );
}
