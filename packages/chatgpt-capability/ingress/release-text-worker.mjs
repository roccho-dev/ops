const OWNER = "roccho-dev";
const REPO = "ops";
const MAX_BYTES = 16 * 1024 * 1024;
const TOKEN = /^[A-Za-z0-9._-]+$/;

function allowedAsset(name) {
  return name.endsWith(".b64.txt") ||
    name === "bootstrap.json" ||
    name === "bootstrap-guide.json" ||
    name === "registry.jsonl";
}

function parsePath(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length !== 3 || parts[0] !== "release") return null;
  const [, tag, asset] = parts;
  if (!TOKEN.test(tag) || tag.length > 200) return null;
  if (!TOKEN.test(asset) || asset.length > 255 || !allowedAsset(asset)) return null;
  return { tag, asset };
}

function headersFor(asset, upstream) {
  const contentType = asset.endsWith(".b64.txt")
    ? "text/plain; charset=utf-8"
    : asset.endsWith(".jsonl")
      ? "application/x-ndjson; charset=utf-8"
      : "application/json; charset=utf-8";
  const headers = new Headers({
    "content-type": contentType,
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
  });
  const length = upstream.headers.get("content-length");
  if (length) headers.set("content-length", length);
  const etag = upstream.headers.get("etag");
  if (etag) headers.set("etag", etag);
  return headers;
}

export async function handle(request, fetchImpl = fetch) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("method not allowed\n", { status: 405, headers: { allow: "GET, HEAD" } });
  }

  const parsed = parsePath(new URL(request.url).pathname);
  if (!parsed) return new Response("not found\n", { status: 404 });

  const { tag, asset } = parsed;
  const upstreamUrl = `https://github.com/${OWNER}/${REPO}/releases/download/${tag}/${asset}`;
  const upstream = await fetchImpl(upstreamUrl, {
    method: request.method,
    redirect: "follow",
    headers: { "user-agent": "roccho-release-text-ingress/1" },
  });
  if (!upstream.ok) return new Response("upstream unavailable\n", { status: 502 });

  const declared = Number(upstream.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    return new Response("asset too large\n", { status: 413 });
  }

  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: 200,
    headers: headersFor(asset, upstream),
  });
}

export default { fetch: handle };
