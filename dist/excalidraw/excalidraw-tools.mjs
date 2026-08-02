/**
 * Browser-only, dependency-free HTML -> Excalidraw projection and viewer URL helper.
 * Distribution contract: one bundled MJS, no external import/fetch/worker/wasm.
 */

export const manifest = Object.freeze({
  id: "urn:roccho-dev:ops:dist:excalidraw:tools",
  version: "0.1.0",
  runtime: "browser",
  entrypoints: ["run", "htmlToExcalidraw", "makeExcalidrawUrl", "serializeExcalidraw"],
  externalDependencies: [],
});

const DEFAULTS = Object.freeze({
  selector: ".slide",
  pageGap: 80,
  viewportWidth: 1700,
  viewportHeight: 1000,
  fontFamily: 2,
  backgroundColor: "#e7ebee",
  source: "roccho-dev/ops/dist/excalidraw/excalidraw-tools.mjs",
});

function number(value, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Match Python round() used by the predecessor proof implementation.
function roundHalfEven(value, digits = 0) {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  const scaled = value * factor;
  const sign = scaled < 0 ? -1 : 1;
  const absolute = Math.abs(scaled);
  const lower = Math.floor(absolute);
  const fraction = absolute - lower;
  const tolerance = Number.EPSILON * Math.max(1, absolute) * 4;
  let rounded;
  if (Math.abs(fraction - 0.5) <= tolerance) {
    rounded = lower % 2 === 0 ? lower : lower + 1;
  } else {
    rounded = Math.round(absolute);
  }
  return (sign * rounded) / factor;
}

function rgbToHex(value, whiteBlend = true) {
  if (!value || value === "transparent") return null;
  if (value.startsWith("#")) return value.toLowerCase();

  const match = value.match(
    /^rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)(?:\D+([\d.]+))?\s*\)$/,
  );
  if (!match) return null;

  let red = Number(match[1]);
  let green = Number(match[2]);
  let blue = Number(match[3]);
  const alpha = Number(match[4] ?? 1);
  if (alpha <= 0) return null;

  if (alpha < 1 && whiteBlend) {
    red = Math.round(red * alpha + 255 * (1 - alpha));
    green = Math.round(green * alpha + 255 * (1 - alpha));
    blue = Math.round(blue * alpha + 255 * (1 - alpha));
  }

  return `#${[red, green, blue]
    .map((component) => clamp(component, 0, 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

function baseElement(type, id, x, y, width, height, order) {
  return {
    id,
    type,
    x: roundHalfEven(x, 2),
    y: roundHalfEven(y, 2),
    width: roundHalfEven(Math.max(0.01, width), 2),
    height: roundHalfEven(Math.max(0.01, height), 2),
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: null,
    roundness: null,
    seed: 100000 + order,
    version: 1,
    versionNonce: 1000000 + order,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
  };
}

function rectangleElement(id, box, order, fill, stroke, strokeWidth, rounded, link) {
  return {
    ...baseElement("rectangle", id, box.x, box.y, box.width, box.height, order),
    backgroundColor: fill ?? "transparent",
    strokeColor: stroke ?? "transparent",
    strokeWidth: clamp(roundHalfEven(strokeWidth), 1, 4),
    roundness: rounded ? { type: 3 } : null,
    link: link ?? null,
  };
}

function lineElement(id, x, y, dx, dy, order, color, width) {
  return {
    ...baseElement("line", id, x, y, Math.abs(dx), Math.abs(dy), order),
    strokeColor: color,
    strokeWidth: clamp(roundHalfEven(width), 1, 4),
    points: [
      [0, 0],
      [roundHalfEven(dx, 2), roundHalfEven(dy, 2)],
    ],
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: null,
  };
}

function textElement(id, item, order, fontFamily) {
  const size = Math.max(8, roundHalfEven(item.fontSize, 1));
  let align = item.textAlign;
  if (align === "start" || align === "-webkit-auto") align = "left";
  if (align === "end") align = "right";
  if (!["left", "center", "right"].includes(align)) align = "left";

  const lineHeight = clamp((item.lineHeight || size * 1.25) / size, 1, 2);
  return {
    ...baseElement(
      "text",
      id,
      item.box.x,
      item.box.y,
      item.box.width,
      item.box.height,
      order,
    ),
    strokeColor: rgbToHex(item.color) ?? "#1e1e1e",
    fontSize: size,
    fontFamily,
    text: item.text,
    textAlign: align,
    verticalAlign: "top",
    containerId: null,
    originalText: item.text,
    autoResize: false,
    lineHeight: roundHalfEven(lineHeight, 3),
    link: item.link ?? null,
    strokeWidth: 1,
    opacity: roundHalfEven(item.opacity * 100),
  };
}

function directText(element) {
  const parts = [];
  let first = null;
  let last = null;

  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
      parts.push(node.textContent.replace(/\s+/g, " "));
      first ??= node;
      last = node;
    } else if (node.nodeName === "BR") {
      parts.push("\n");
      first ??= node;
      last = node;
    }
  }

  return {
    value: parts.join("").replace(/ *\n */g, "\n").trim(),
    first,
    last,
  };
}

function elementLink(element) {
  return element.closest("a[href]")?.href || element.getAttribute("data-link") || null;
}

function visible(style, rect) {
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    number(style.opacity, 1) > 0 &&
    rect.width > 0.2 &&
    rect.height > 0.2
  );
}

function borders(style) {
  return ["Top", "Right", "Bottom", "Left"].map((side) => ({
    side: side.toLowerCase(),
    width: number(style[`border${side}Width`]),
    style: style[`border${side}Style`],
    color: style[`border${side}Color`],
  }));
}

function relativeBox(rect, parentRect) {
  return {
    x: rect.x - parentRect.x,
    y: rect.y - parentRect.y,
    width: rect.width,
    height: rect.height,
  };
}

function extractRenderedPages(documentObject, options) {
  let pages = [...documentObject.querySelectorAll(options.selector)];
  if (pages.length === 0) pages = [documentObject.body];

  return pages.map((pageElement, pageIndex) => {
    const pageRect = pageElement.getBoundingClientRect();
    const boxes = [];
    const texts = [];
    const pseudos = [];
    const elements = [pageElement, ...pageElement.querySelectorAll("*")];

    for (const element of elements) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (!visible(style, rect)) continue;

      boxes.push({
        box: relativeBox(rect, pageRect),
        background: style.backgroundColor,
        borders: borders(style),
        radius: number(style.borderTopLeftRadius),
        link: elementLink(element),
      });

      const { value, first, last } = directText(element);
      if (value && first && last) {
        const range = documentObject.createRange();
        range.setStartBefore(first);
        range.setEndAfter(last);
        let textRect = range.getBoundingClientRect();
        if (!textRect.width || !textRect.height) textRect = rect;
        const fontSize = number(style.fontSize, 16);

        texts.push({
          text: value,
          box: relativeBox(textRect, pageRect),
          color: style.color,
          fontSize,
          fontWeight: style.fontWeight,
          textAlign: style.textAlign,
          lineHeight: number(style.lineHeight, fontSize * 1.25),
          opacity: number(style.opacity, 1),
          link: elementLink(element),
        });
      }

      for (const pseudoName of ["::before", "::after"]) {
        const pseudo = getComputedStyle(element, pseudoName);
        if (
          pseudo.content === "none" ||
          pseudo.display === "none" ||
          pseudo.visibility === "hidden" ||
          number(pseudo.opacity, 1) === 0
        ) {
          continue;
        }

        const width = number(pseudo.width);
        const height = number(pseudo.height);
        if (width <= 0.2 || height <= 0.2) continue;

        const pseudoBorders = borders(pseudo);
        const hasBorder = pseudoBorders.some((edge) => edge.width > 0 && edge.style !== "none");
        if (!rgbToHex(pseudo.backgroundColor) && !hasBorder) continue;

        pseudos.push({
          box: {
            x: rect.x - pageRect.x + number(pseudo.left),
            y: rect.y - pageRect.y + number(pseudo.top),
            width,
            height,
          },
          background: pseudo.backgroundColor,
          borders: pseudoBorders,
          radius: number(pseudo.borderTopLeftRadius),
          link: null,
        });
      }
    }

    return {
      id: pageElement.id || `page-${pageIndex + 1}`,
      width: pageRect.width,
      height: pageRect.height,
      boxes,
      texts,
      pseudos,
    };
  });
}

function pagesToScene(pages, options) {
  const shapeElements = [];
  const textElements = [];
  let order = 0;
  let yOffset = 0;

  for (const page of pages) {
    for (const item of [...page.boxes, ...page.pseudos]) {
      const box = { ...item.box, y: item.box.y + yOffset };
      const fill = rgbToHex(item.background);
      const activeBorders = item.borders.filter(
        (edge) => edge.width > 0 && edge.style !== "none" && rgbToHex(edge.color),
      );
      const sameBorder =
        activeBorders.length === 4 &&
        new Set(
          activeBorders.map(
            (edge) => `${edge.width.toFixed(2)}:${rgbToHex(edge.color)}`,
          ),
        ).size === 1;

      if (fill || sameBorder) {
        order += 1;
        shapeElements.push(
          rectangleElement(
            `b${order}`,
            box,
            order,
            fill,
            sameBorder ? rgbToHex(activeBorders[0].color) : null,
            sameBorder ? activeBorders[0].width : 1,
            item.radius > 0,
            item.link,
          ),
        );
      }

      if (!sameBorder) {
        for (const edge of activeBorders) {
          order += 1;
          const color = rgbToHex(edge.color) ?? "#1e1e1e";
          const args = {
            top: [box.x, box.y, box.width, 0],
            bottom: [box.x, box.y + box.height, box.width, 0],
            left: [box.x, box.y, 0, box.height],
            right: [box.x + box.width, box.y, 0, box.height],
          }[edge.side];
          shapeElements.push(
            lineElement(`l${order}`, ...args, order, color, edge.width),
          );
        }
      }
    }

    for (const item of page.texts) {
      order += 1;
      textElements.push(
        textElement(
          `t${order}`,
          { ...item, box: { ...item.box, y: item.box.y + yOffset } },
          order,
          options.fontFamily,
        ),
      );
    }

    yOffset += page.height + options.pageGap;
  }

  return {
    type: "excalidraw",
    version: 2,
    source: options.source,
    elements: [...shapeElements, ...textElements],
    appState: {
      gridSize: null,
      viewBackgroundColor: options.backgroundColor,
    },
    files: {},
  };
}

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

export function makeExcalidrawUrl(publicSceneUrl, userOptions = {}) {
  if (typeof publicSceneUrl !== "string" || !publicSceneUrl.trim()) {
    throw new TypeError("publicSceneUrl must be a non-empty string");
  }
  const baseUrl = userOptions.baseUrl ?? "https://excalidraw.com/";
  const cleanBase = String(baseUrl).replace(/#.*$/, "");
  return `${cleanBase}#url=${encodeURIComponent(publicSceneUrl)}`;
}

export function serializeExcalidraw(scene, userOptions = {}) {
  if (!scene || scene.type !== "excalidraw" || !Array.isArray(scene.elements)) {
    throw new TypeError("scene must be an Excalidraw scene object");
  }
  return JSON.stringify(scene, null, userOptions.pretty ? 2 : 0);
}

/** Common adapter entrypoint for connector/CDP/Node wrappers. */
export async function run(request) {
  if (!request || typeof request !== "object") {
    throw new TypeError("request must be an object");
  }

  switch (request.operation) {
    case "html-to-excalidraw": {
      const scene = await htmlToExcalidraw(request.html, request.options);
      return request.serialize
        ? serializeExcalidraw(scene, { pretty: Boolean(request.pretty) })
        : scene;
    }
    case "make-excalidraw-url":
      return makeExcalidrawUrl(request.publicSceneUrl, request.options);
    default:
      throw new Error(`unsupported operation: ${String(request.operation)}`);
  }
}
