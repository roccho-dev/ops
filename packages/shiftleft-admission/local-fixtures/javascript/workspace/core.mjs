export function parsePair(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError("pair must be an object");
  }
  const keys = Object.keys(raw).sort();
  if (keys.length !== 2 || keys[0] !== "left" || keys[1] !== "right") {
    throw new TypeError("pair must contain left and right");
  }
  if (!Number.isInteger(raw.left) || !Number.isInteger(raw.right)) {
    throw new TypeError("pair values must be integers");
  }
  return Object.freeze({ left: raw.left, right: raw.right });
}

export function add(pair) {
  return pair.left + pair.right;
}
