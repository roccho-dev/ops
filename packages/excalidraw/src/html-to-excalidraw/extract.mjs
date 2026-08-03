import { number, rgbToHex } from "./numeric.mjs";

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

export function extractRenderedPages(documentObject, options) {
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
