import path from "node:path";

const drivePrefix = /^[A-Za-z]:/;

export const assertSafeRelativePath = (value, label = "path", { allowDot = false } = {}) => {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label}: non-empty string required`);
  if (value.includes("\\")) throw new Error(`${label}: backslash is forbidden`);
  if (value.startsWith("/") || drivePrefix.test(value)) throw new Error(`${label}: absolute path is forbidden`);
  if (value === ".") {
    if (allowDot) return value;
    throw new Error(`${label}: dot path is forbidden`);
  }
  const parts = value.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`${label}: unsafe path segment`);
  }
  return value;
};

export const resolveInside = (root, relativePath, label = "path", options = {}) => {
  assertSafeRelativePath(relativePath, label, options);
  const resolvedRoot = path.resolve(root);
  const resolved = relativePath === "." ? resolvedRoot : path.resolve(resolvedRoot, relativePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`${label}: path escapes root`);
  }
  return resolved;
};

export const toPosix = (value) => value.split(path.sep).join("/");
