import { lineElement, rectangleElement, textElement } from "./elements.mjs";
import { rgbToHex } from "./numeric.mjs";

export function pagesToScene(pages, options) {
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
