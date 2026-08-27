const sortValue = (value) => {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
  }
  return value;
};

export const canonicalJson = (value) => JSON.stringify(sortValue(value));

export const canonicalJsonText = (value) => `${canonicalJson(value)}\n`;

export const parseCanonicalJsonl = (text, label = "JSONL") => {
  if (typeof text !== "string") throw new TypeError(`${label}: text is required`);
  if (text.includes("\r")) throw new Error(`${label}: CR is forbidden`);
  if (!text.endsWith("\n")) throw new Error(`${label}: final LF is required`);
  const body = text.slice(0, -1);
  if (body.length === 0) return [];
  const lines = body.split("\n");
  if (lines.some((line) => line.length === 0)) throw new Error(`${label}: blank line is forbidden`);
  return lines.map((line, index) => {
    let value;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new Error(`${label}: line ${index + 1}: ${error.message}`);
    }
    if (canonicalJson(value) !== line) throw new Error(`${label}: line ${index + 1}: non-canonical JSON`);
    return value;
  });
};
