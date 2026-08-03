import { clamp, rgbToHex, roundHalfEven } from "./numeric.mjs";

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

export function rectangleElement(id, box, order, fill, stroke, strokeWidth, rounded, link) {
  return {
    ...baseElement("rectangle", id, box.x, box.y, box.width, box.height, order),
    backgroundColor: fill ?? "transparent",
    strokeColor: stroke ?? "transparent",
    strokeWidth: clamp(roundHalfEven(strokeWidth), 1, 4),
    roundness: rounded ? { type: 3 } : null,
    link: link ?? null,
  };
}

export function lineElement(id, x, y, dx, dy, order, color, width) {
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

export function textElement(id, item, order, fontFamily) {
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
