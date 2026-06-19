export const outputHeaders = ["repo", "kind", "pkg", "role", "count", "examples", "source", "authority"];

export function parseProjection(raw) {
  if (!raw) return [];
  const first = raw.trimStart()[0];
  if (first === "[" || first === "{") {
    try {
      return flattenJson(JSON.parse(raw));
    } catch (_) {
      return parseJsonl(raw);
    }
  }
  const jsonl = parseJsonl(raw);
  if (jsonl.length > 0) return jsonl;
  return parseTsv(raw);
}

export function normalizeRows(rows) {
  return rows.map(normalizeRow).filter((r) => r.pkg || r.repo || r.examples);
}

export function searchPackages(rows, { query = "", role = "" } = {}) {
  const q = String(query || "").toLowerCase();
  const wantedRole = String(role || "").toLowerCase();
  return rows.filter((row) => {
    const haystack = Object.values(row).join(" ").toLowerCase();
    if (q && !haystack.includes(q)) return false;
    if (wantedRole && !String(row.role || "").toLowerCase().includes(wantedRole)) return false;
    return true;
  });
}

export function toTsv(rows, headers = outputHeaders) {
  return [headers.join("\t"), ...rows.map((row) => headers.map((h) => row[h] || "").join("\t"))].join("\n");
}

function parseJsonl(raw) {
  const rows = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("{")) continue;
    try { rows.push(...flattenJson(JSON.parse(trimmed))); } catch (_) { /* ignore non-json lines */ }
  }
  return rows;
}

function flattenJson(value) {
  if (Array.isArray(value)) return value.flatMap(flattenJson);
  if (!value || typeof value !== "object") return [];
  for (const key of ["rows", "items", "packages", "candidates", "results", "projections", "records"]) {
    if (Array.isArray(value[key])) return value[key].flatMap(flattenJson);
  }
  if (value.payload && typeof value.payload === "object") return [{ ...value, ...value.payload }];
  return [value];
}

function parseTsv(raw) {
  const [headerLine, ...lines] = raw.split(/\r?\n/);
  if (!headerLine || !headerLine.includes("\t")) return [];
  const headers = headerLine.split("\t");
  return lines.filter(Boolean).map((line) => {
    const cells = line.split("\t");
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] || ""]));
  });
}

function normalizeRow(row) {
  const source = first(row.source, row.path, row.file, row.ref, row.branch, row.raw_id, row.id);
  const pkg = first(row.pkg, row.package, row.packageName, row.name, row.output, row.target, row.targetRef, row.tool, row.skill);
  const examples = first(row.examples, row.example, row.summary, row.description, row.title, row.note, row.message, row.path);
  return {
    repo: first(row.repo, row.repository, row.repoId, row.ownerRepo),
    kind: first(row.kind, row.type, row.recordKind, row.category),
    pkg,
    role: first(row.role, row.capability, row.responsibility, row.whenToUse, row.tags),
    count: first(row.count, row.hits, row.n, row.total),
    examples,
    source,
    authority: first(row.authority, row.status, row.state, row.proofState, row.acceptance),
  };
}

function first(...values) {
  for (const value of values) {
    if (value == null) continue;
    if (Array.isArray(value) && value.length > 0) return value.join(",");
    if (typeof value === "object") return JSON.stringify(value);
    const s = String(value);
    if (s.length > 0) return s;
  }
  return "";
}
