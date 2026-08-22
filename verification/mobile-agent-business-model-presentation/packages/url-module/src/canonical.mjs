const plain = value => value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

export const canonicalValue = value => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (plain(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]));
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return Object.is(value, -0) ? 0 : value;
  throw new Error("canonical-json: unsupported value");
};

export const canonicalJson = value => JSON.stringify(canonicalValue(value));
