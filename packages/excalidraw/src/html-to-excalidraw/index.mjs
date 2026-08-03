/** Browser-only static HTML -> editable Excalidraw projection. */
import { extractRenderedPages } from "./extract.mjs";
import { pagesToScene } from "./project.mjs";

export const manifest = Object.freeze({
  id: "urn:roccho-dev:ops:dist:excalidraw:html-to-excalidraw",
  version: "0.2.0",
  runtime: "browser",
  entrypoints: ["run", "htmlToExcalidraw", "serializeExcalidraw"],
  externalDependencies: [],
});

const DEFAULTS = Object.freeze({
  selector: ".slide",
  pageGap: 80,
  viewportWidth: 1700,
  viewportHeight: 1000,
  fontFamily: 2,
  backgroundColor: "#e7ebee",
  source: "roccho-dev/ops/dist/excalidraw/html-to-excalidraw.mjs",
});

function withBaseUrl(html, baseUrl) {
  if (!baseUrl) return html;
  const escaped = String(baseUrl).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const base = `<base href="${escaped}">`;
  if (/<head(?:\s[^>]*)?>/i.test(html)) {
    return html.replace(/<head(?:\s[^>]*)?>/i, (match) => `${match}${base}`);
  }
  return `${base}${html}`;
}

async function waitForFrame(frame, timeoutMs) {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("iframe load timed out")), timeoutMs);
    frame.addEventListener(
      "load",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });

  const documentObject = frame.contentDocument;
  if (!documentObject) throw new Error("iframe contentDocument is unavailable");
  if (documentObject.fonts?.ready) await documentObject.fonts.ready;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

/**
 * Renders static HTML in an isolated same-origin iframe and projects visible
 * boxes, borders, pseudo fills and direct text into editable Excalidraw elements.
 */
export async function htmlToExcalidraw(html, userOptions = {}) {
  if (typeof document === "undefined") {
    throw new Error("htmlToExcalidraw requires a browser DOM runtime");
  }
  if (typeof html !== "string") throw new TypeError("html must be a string");

  const options = {
    ...DEFAULTS,
    ...userOptions,
    timeoutMs: userOptions.timeoutMs ?? 10_000,
  };

  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, {
    position: "fixed",
    left: "-100000px",
    top: "0",
    width: `${options.viewportWidth}px`,
    height: `${options.viewportHeight}px`,
    border: "0",
    visibility: "hidden",
    pointerEvents: "none",
  });
  document.body.append(frame);

  try {
    const ready = waitForFrame(frame, options.timeoutMs);
    frame.srcdoc = withBaseUrl(html, options.baseUrl);
    await ready;
    const pages = extractRenderedPages(frame.contentDocument, options);
    return pagesToScene(pages, options);
  } finally {
    frame.remove();
  }
}

export function serializeExcalidraw(scene, userOptions = {}) {
  if (!scene || scene.type !== "excalidraw" || !Array.isArray(scene.elements)) {
    throw new TypeError("scene must be an Excalidraw scene object");
  }
  return JSON.stringify(scene, null, userOptions.pretty ? 2 : 0);
}

export async function run(request) {
  if (!request || typeof request !== "object") {
    throw new TypeError("request must be an object");
  }
  if (request.operation != null && request.operation !== "html-to-excalidraw") {
    throw new Error(`unsupported operation: ${String(request.operation)}`);
  }
  const scene = await htmlToExcalidraw(request.html, request.options);
  return request.serialize
    ? serializeExcalidraw(scene, { pretty: Boolean(request.pretty) })
    : scene;
}
