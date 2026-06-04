// ESM resolve hook: qjs:std / qjs:os を node 互換 shim へ写像する。
// 移行検証用 — 無改修の .mjs を node で動かし qjs baseline と突合するために使う。
// 最終移行ではソースの import を ./qjs-compat/*.mjs へ書換え、本 hook 無しで動かす。
const MAP = {
  "qjs:std": new URL("./std.mjs", import.meta.url).href,
  "qjs:os": new URL("./os.mjs", import.meta.url).href,
};

export async function resolve(specifier, context, nextResolve) {
  if (Object.prototype.hasOwnProperty.call(MAP, specifier)) {
    return { url: MAP[specifier], shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
