// Shared Python-semantics helpers for the ops-thread-fsm Node port.
// Reproduces Python truthiness and JSON.dumps formatting exactly.

// Python truthiness: None/False/0/""/[]/{}/empty are falsy.
export function pyTruthy(value) {
  if (value === null || value === undefined || value === false) return false;
  if (value === true) return true;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

// `value or fallback` with Python truthiness.
export function pyOr(value, fallback) {
  return pyTruthy(value) ? value : fallback;
}

// Python str.splitlines(): split on line boundaries (\r\n, \r, \n, \v, \f, the
// file/group/record separators, NEL, and the unicode line/paragraph separators
// Python recognizes) WITHOUT a trailing empty element after a final boundary.
// Returns [] for "".
const LINE_BOUNDARY = new RegExp(
  "\\r\\n|[\\n\\r\\v\\f\\x1c\\x1d\\x1e\\x85\\u2028\\u2029]",
  "g",
);
export function splitlines(text) {
  if (text === "") return [];
  const out = [];
  let last = 0;
  let m;
  LINE_BOUNDARY.lastIndex = 0;
  while ((m = LINE_BOUNDARY.exec(text)) !== null) {
    out.push(text.slice(last, m.index));
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    out.push(text.slice(last));
  }
  return out;
}

// json.dumps(value, ensure_ascii=False, indent=2)
// Python uses ": " and ",\n" separators with indent; JSON.stringify(x, null, 2)
// produces the same byte output (ensure_ascii=False keeps non-ASCII raw, which
// is also JSON.stringify's default). Keys serialize in insertion order in both.
export function dumps(value) {
  return JSON.stringify(value, null, 2);
}
