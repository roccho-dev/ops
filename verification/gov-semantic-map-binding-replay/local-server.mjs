import fs from "node:fs/promises";
import http from "node:http";
import { handleRequest } from "../../packages/gov-release-proxy/src/worker.mjs";

const [meaningPath, portInput = "4173"] = process.argv.slice(2);
if (!meaningPath) throw new Error("usage: node local-server.mjs <meaning-path> [port]");
const port = Number(portInput);
const meaning = await fs.readFile(meaningPath);
const html = await fs.readFile(new URL("../../packages/gov-release-proxy/public/index.html", import.meta.url));
const env = {
  ASSETS: {
    fetch: async request => new Response(request.method === "HEAD" ? null : html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "content-length": String(html.byteLength) },
    }),
  },
};
const server = http.createServer(async (incoming, outgoing) => {
  try {
    const url = `http://127.0.0.1:${port}${incoming.url}`;
    const request = new Request(url, { method: incoming.method, headers: incoming.headers });
    const response = await handleRequest(request, env, {
      fetchImpl: async () => new Response(meaning, { status: 200 }),
      cryptoScope: globalThis.crypto,
    });
    outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    outgoing.end(response.body === null ? undefined : Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    outgoing.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    outgoing.end(String(error?.stack ?? error));
  }
});
server.listen(port, "127.0.0.1", () => console.log(`http://127.0.0.1:${port}/`));
