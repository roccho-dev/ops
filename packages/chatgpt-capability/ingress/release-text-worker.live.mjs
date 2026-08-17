import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handle } from "./release-text-worker.mjs";

const tag = "cap-proof2-eefa9f3d9c4a-6a819b1d-0d40-83e8-855a-00e20dd48e56";
const payloadSha = "9c5977657e2e4476938f9ca4656f0fdd80d2f0cf552fdc72998e9162beae95e3";
const carrierSha = "aab48f3417409f6cbed8e4b189b6491e5c2dfdfc3447470dd48ec5a1c7ea0b45";
const asset = `carrier.native.linux-amd64-static.${payloadSha}.b64.txt`;
const directUrl = `https://github.com/roccho-dev/ops/releases/download/${tag}/${asset}`;
const ingressUrl = `https://ingress.invalid/release/${tag}/${asset}`;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const directResponse = await fetch(directUrl, { redirect: "follow" });
assert.equal(directResponse.status, 200, "direct public Release GET");
const direct = Buffer.from(await directResponse.arrayBuffer());
assert.equal(sha256(direct), carrierSha, "GitHub Release asset digest");

const ingressResponse = await handle(new Request(ingressUrl));
assert.equal(ingressResponse.status, 200, "ingress response");
assert.equal(ingressResponse.headers.get("content-type"), "text/plain; charset=utf-8");
const carrier = Buffer.from(await ingressResponse.arrayBuffer());
assert.deepEqual(carrier, direct, "ingress must preserve exact Release asset bytes");
assert.equal(sha256(carrier), carrierSha, "ingress carrier digest");

const encoded = carrier.toString("ascii").trimEnd();
assert.match(encoded, /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/, "canonical Base64 alphabet/padding");
assert.equal(encoded.replace(/\s/g, ""), encoded, "no internal whitespace");
const payload = Buffer.from(encoded, "base64");
assert.equal(payload.toString("base64"), encoded, "strict Base64 round-trip");
assert.equal(sha256(payload), payloadSha, "decoded payload digest");

const bin = join(process.env.RUNNER_TEMP || tmpdir(), "bootstrap-intake-release-ingress-proof");
await writeFile(bin, payload);
await chmod(bin, 0o755);
const output = execFileSync(bin, ["selftest"], { encoding: "utf8", timeout: 10_000 }).trim();
assert.equal(output, "bootstrap-intake selftest PASS");

console.log(JSON.stringify({
  status: "PASS",
  tag,
  asset,
  carrierBytes: carrier.length,
  carrierSha256: sha256(carrier),
  payloadBytes: payload.length,
  payloadSha256: sha256(payload),
  execution: output,
}));
