export function mouseClick(call, x, y) {
  const pt = { x: Number(x) || 0, y: Number(y) || 0, button: "left", clickCount: 1 };
  call("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y, button: "none" });
  call("Input.dispatchMouseEvent", { type: "mousePressed", ...pt });
  call("Input.dispatchMouseEvent", { type: "mouseReleased", ...pt });
}

export function keyTap(call, key, code, vk, modifiers) {
  const base = {
    key,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
    modifiers: modifiers || 0,
  };
  call("Input.dispatchKeyEvent", { type: "keyDown", ...base });
  call("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}

export function scrollToBottomExpr(rootSelector) {
  const sel = JSON.stringify(String(rootSelector || ""));
  return `(() => {
    try {
      const sel = ${sel};
      const fromSelector = () => {
        if (!sel) return null;
        try { return document.querySelector(sel); } catch (_) { return null; }
      };
      const pool = Array.from(document.querySelectorAll("main, body, [data-testid*='scroll' i], [class*='scroll' i]"))
        .filter((el) => el && el.scrollHeight && el.clientHeight && el.scrollHeight > el.clientHeight);
      const chosen = fromSelector() || pool.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0] || document.scrollingElement || document.documentElement || document.body;
      if (!chosen) return { ok: false, reason: 'no_scroll_el', selector: sel || null };
      try { chosen.scrollTop = chosen.scrollHeight; } catch (_) {}
      try { window.scrollTo(0, document.body ? document.body.scrollHeight : 0); } catch (_) {}
      return {
        ok: true,
        selector: sel || null,
        scrollTop: Number(chosen.scrollTop) || 0,
        scrollHeight: Number(chosen.scrollHeight) || 0,
        clientHeight: Number(chosen.clientHeight) || 0,
      };
    } catch (_) {
      return false;
    }
  })()`;
}
