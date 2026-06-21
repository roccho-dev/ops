import path from "node:path";

export const REF_PROFILE = "heads-v1";
export const REPO_KEY_PREFIX = "=r1-";
export const MANAGED_REMOTE_PATTERN = "refs/heads/*";
export const LEGACY_REPOS_PREFIX = "refs/heads/repos/";

const SAFE_BYTE = /^[A-Za-z0-9_-]$/;
const HEX = /^[0-9A-F]{2}$/;

export class ProjectionError extends Error {}

export function normalizeRepoPath(value) {
  if (typeof value !== "string") throw new ProjectionError("repoPath must be a string");
  let normalized = value.replaceAll("\\", "/");
  normalized = normalized.replace(/^\.\//, "").replace(/^\/+/, "").replace(/\/+$/, "");
  if (normalized.endsWith(".git")) normalized = normalized.slice(0, -4);
  if (!normalized) throw new ProjectionError("repoPath must not be empty");
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\0"))) {
    throw new ProjectionError(`invalid repoPath: ${value}`);
  }
  return segments.join("/");
}

export function repoPathFromBare(root, barePath) {
  const absoluteRoot = path.resolve(root);
  const absoluteBare = path.resolve(barePath);
  const relative = path.relative(absoluteRoot, absoluteBare);
  if (!relative || relative === "." || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new ProjectionError(`bare path is outside bare root: ${barePath}`);
  }
  if (!relative.endsWith(".git")) throw new ProjectionError(`bare path must end in .git: ${barePath}`);
  return normalizeRepoPath(relative);
}

export function encodeRepoPath(repoPath) {
  const normalized = normalizeRepoPath(repoPath);
  let payload = "";
  for (const byte of Buffer.from(normalized, "utf8")) {
    const ch = String.fromCharCode(byte);
    payload += SAFE_BYTE.test(ch) ? ch : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return REPO_KEY_PREFIX + payload;
}

export function decodeRepoKey(repoKey) {
  if (typeof repoKey !== "string" || !repoKey.startsWith(REPO_KEY_PREFIX)) {
    throw new ProjectionError(`unsupported repoKey: ${repoKey}`);
  }
  const payload = repoKey.slice(REPO_KEY_PREFIX.length);
  if (!payload) throw new ProjectionError("repoKey payload must not be empty");
  const bytes = [];
  for (let i = 0; i < payload.length; ) {
    const ch = payload[i];
    if (ch === "%") {
      const hex = payload.slice(i + 1, i + 3);
      if (!HEX.test(hex)) throw new ProjectionError(`non-canonical repoKey escape: ${repoKey}`);
      bytes.push(Number.parseInt(hex, 16));
      i += 3;
      continue;
    }
    if (!SAFE_BYTE.test(ch)) throw new ProjectionError(`unsafe unescaped repoKey byte: ${repoKey}`);
    bytes.push(ch.charCodeAt(0));
    i += 1;
  }
  let decoded;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    throw new ProjectionError(`repoKey is not valid UTF-8: ${repoKey}`);
  }
  const normalized = normalizeRepoPath(decoded);
  if (encodeRepoPath(normalized) !== repoKey) throw new ProjectionError(`non-canonical repoKey: ${repoKey}`);
  return normalized;
}

export function identityFromRepo(repo) {
  const repoPath = normalizeRepoPath(repo.repoPath || repo.repoId || repo.repoKey || "");
  const repoKey = repo.repoKey || encodeRepoPath(repoPath);
  if (decodeRepoKey(repoKey) !== repoPath) {
    throw new ProjectionError(`repoPath/repoKey mismatch: ${repoPath} != ${repoKey}`);
  }
  return { repoPath, repoKey };
}

export function projectHeadRef(repoKey, branch) {
  decodeRepoKey(repoKey);
  if (typeof branch !== "string" || !branch) throw new ProjectionError("branch must not be empty");
  return `refs/heads/${repoKey}/${branch}`;
}

export function logicalHeadId(repoPath, branch) {
  return `${normalizeRepoPath(repoPath)}\0heads\0${branch}`;
}

export function parseManagedRemoteRef(ref) {
  if (typeof ref !== "string" || !ref.startsWith("refs/heads/")) {
    return { schema: "outside-managed-root", ref };
  }

  if (ref.startsWith(LEGACY_REPOS_PREFIX)) {
    const rest = ref.slice(LEGACY_REPOS_PREFIX.length);
    const slash = rest.indexOf("/");
    if (slash <= 0 || slash === rest.length - 1) return { schema: "unknown", ref, reason: "malformed-legacy-repos" };
    return {
      schema: "legacy-repos-v0",
      ref,
      repoPath: normalizeRepoPath(rest.slice(0, slash)),
      branch: rest.slice(slash + 1),
    };
  }

  const rest = ref.slice("refs/heads/".length);
  const slash = rest.indexOf("/");
  if (slash <= 0 || slash === rest.length - 1) return { schema: "unknown", ref, reason: "missing-repo-key-or-branch" };
  const first = rest.slice(0, slash);
  const branch = rest.slice(slash + 1);
  if (first.startsWith(REPO_KEY_PREFIX)) {
    try {
      const repoPath = decodeRepoKey(first);
      return { schema: "current-r1", ref, repoPath, repoKey: first, branch, logicalId: logicalHeadId(repoPath, branch) };
    } catch (error) {
      return { schema: "unknown", ref, reason: error.message };
    }
  }

  try {
    return {
      schema: "legacy-flat-v0",
      ref,
      repoPath: normalizeRepoPath(first),
      branch,
    };
  } catch (error) {
    return { schema: "unknown", ref, reason: error.message };
  }
}
