import assert from "node:assert/strict";
import { handle } from "./release-text-worker.mjs";

const tag = "cap-proof2-eefa9f3d9c4a-6a819b1d-0d40-83e8-855a-00e20dd48e56";
const asset = "bootstrap-guide.json";

{
  const bytes = new TextEncoder().encode("ZXhhY3QtYnl0ZXM=\n");
  let seen;
  const fakeFetch = async (url, init) => {
    seen = { url, init };
    return new Response(bytes, {
      status: 200,
      headers: { "content-length": String(bytes.byteLength), etag: '"proof"' },
    });
  };
  const response = await handle(new Request(`https://ingress.invalid/release/${tag}/carrier.native.linux-amd64-static.deadbeef.b64.txt`), fakeFetch);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(seen.init.redirect, "follow");
  assert.equal(seen.url, `https://github.com/roccho-dev/ops/releases/download/${tag}/carrier.native.linux-amd64-static.deadbeef.b64.txt`);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
}

for (const path of [
  "/release/x/evil.exe",
  "/release/x/../../bootstrap.json",
  "/release/x/a%2Fb.b64.txt",
  "/other/x/bootstrap.json",
]) {
  const response = await handle(new Request(`https://ingress.invalid${path}`), async () => { throw new Error("must not fetch"); });
  assert.equal(response.status, 404, path);
}

{
  const response = await handle(new Request(`https://ingress.invalid/release/${tag}/${asset}`, { method: "POST" }), async () => { throw new Error("must not fetch"); });
  assert.equal(response.status, 405);
}

console.log("release-text-worker unit PASS");
