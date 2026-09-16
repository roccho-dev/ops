import test from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import {
  PUBLIC_BINDING,
  configFor,
} from "../src/assets.mjs";
import { BindingError, parseBinding, validateBinding } from "../src/binding.mjs";
import worker, { ProxyError, handleRequest, selectedBinding } from "../src/worker.mjs";

const digest = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const clone = value => JSON.parse(JSON.stringify(value));
const exactSha = character => character.repeat(40);
const exactDigest = character => `sha256:${character.repeat(64)}`;

const caseFor = (suffix, dataBody) => {
  const binding = clone(PUBLIC_BINDING);
  const commit = exactSha(suffix === "a" ? "1" : "2");
  const repository = `roccho-dev/governance-${suffix}`;
  const path = `fixtures/${suffix}.jsonl`;
  binding.bindingId = `governance.local-${suffix}.semantic-map/1`;
  binding.release.repository = repository;
  binding.release.targetCommit = commit;
  binding.release.tag = `git/${commit}/${path}`;
  binding.asset.name = `${suffix}.jsonl`;
  binding.asset.path = path;
  binding.asset.bytes = dataBody.byteLength;
  binding.asset.digest = digest(dataBody);
  binding.asset.downloadUrl = `https://raw.githubusercontent.com/${repository}/${commit}/${path}`;
  binding.ui.artifactCommit = exactSha(suffix === "a" ? "3" : "4");
  binding.ui.artifactTree = exactSha(suffix === "a" ? "5" : "6");
  binding.ui.profileDigest = exactDigest(suffix === "a" ? "a" : "b");
  binding.ui.svgDigest = exactDigest(suffix === "a" ? "e" : "f");
  binding.ui.meaningDigest = binding.asset.digest;
  const htmlBody = Buffer.from(`<!doctype html><meta name="meaning" content="${binding.asset.digest}"><title>${suffix}</title>`);
  binding.ui.htmlBytes = htmlBody.byteLength;
  binding.ui.htmlDigest = digest(htmlBody);
  return { binding: validateBinding(binding), dataBody, htmlBody };
};

const cases = [
  caseFor("a", Buffer.from('{"kind":"fixture.a","id":"a"}\n')),
  caseFor("b", Buffer.from('{"kind":"fixture.b","id":"b","value":2}\n')),
];

test("two exact cases use one Worker through binding data only", async () => {
  for (const { binding, dataBody, htmlBody } of cases) {
    const env = {
      ASSETS: {
        fetch: async () => new Response(htmlBody, {
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      },
      GOV_RELEASE_BINDING_JSON: JSON.stringify(binding),
    };
    assert.equal(selectedBinding(env).bindingId, binding.bindingId);

    const html = await handleRequest(
      new Request("https://worker.invalid/", { headers: { accept: "text/html" } }),
      env,
      { cryptoScope: webcrypto },
    );
    assert.equal(html.status, 200);
    assert.deepEqual(Buffer.from(await html.arrayBuffer()), htmlBody);
    assert.equal(html.headers.get("x-gov-map-binding"), binding.bindingId);
    assert.equal(html.headers.get("x-gov-ui-html-digest"), binding.ui.htmlDigest);
    assert.equal(html.headers.get("x-gov-ui-meaning-digest"), binding.asset.digest);

    const data = await handleRequest(
      new Request("https://worker.invalid/", { headers: { accept: "application/x-ndjson" } }),
      env,
      {
        cryptoScope: webcrypto,
        fetchImpl: async url => {
          assert.equal(url, binding.asset.downloadUrl);
          return new Response(dataBody, { status: 200 });
        },
      },
    );
    assert.equal(data.status, 200);
    assert.deepEqual(Buffer.from(await data.arrayBuffer()), dataBody);
    assert.equal(data.headers.get("x-gov-map-binding"), binding.bindingId);
    assert.equal(data.headers.get("x-gov-release-digest"), binding.asset.digest);
    assert.equal(data.headers.get("x-gov-ui-meaning-digest"), binding.asset.digest);
  }
});

test("binding JSON produces the same immutable config contract", () => {
  for (const { binding } of cases) {
    const config = configFor({ bindingJson: JSON.stringify(binding) });
    assert.equal(config.schema, "ops.govReleaseProxyConfig/4");
    assert.equal(config.bindingId, binding.bindingId);
    assert.equal(config.asset.digest, binding.asset.digest);
    assert.equal(config.ui.meaningDigest, binding.asset.digest);
    assert.equal(config.productionCutover, false);
  }
});

test("unknown fields and authority escalation fail closed", () => {
  const extra = clone(PUBLIC_BINDING);
  extra.workflow = ["deploy"];
  assert.throws(() => validateBinding(extra), error => error instanceof BindingError);

  const authority = clone(PUBLIC_BINDING);
  authority.authority = true;
  assert.throws(() => validateBinding(authority), error => error instanceof BindingError);

  const cutover = clone(PUBLIC_BINDING);
  cutover.productionCutover = true;
  assert.throws(() => validateBinding(cutover), error => error instanceof BindingError);
});

test("source identity and HTML/NDJSON meaning mismatch fail closed", () => {
  const wrongUrl = clone(PUBLIC_BINDING);
  wrongUrl.asset.downloadUrl = "https://raw.githubusercontent.com/roccho-dev/governance/main/selected-universe.jsonl";
  assert.throws(() => validateBinding(wrongUrl), error => error instanceof BindingError);

  const mismatchedMeaning = clone(PUBLIC_BINDING);
  mismatchedMeaning.ui.meaningDigest = exactDigest("0");
  assert.throws(() => validateBinding(mismatchedMeaning), error => error instanceof BindingError);
});

test("served UI bytes and embedded meaning identity fail closed", async () => {
  const { binding, htmlBody } = cases[0];
  const env = {
    GOV_RELEASE_BINDING_JSON: JSON.stringify(binding),
    ASSETS: {
      fetch: async () => new Response(Buffer.from(htmlBody.toString().replace(binding.asset.digest, exactDigest("0"))), {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    },
  };
  await assert.rejects(
    handleRequest(new Request("https://worker.invalid/", { headers: { accept: "text/html" } }), env, { cryptoScope: webcrypto }),
    error => error instanceof ProxyError && ["UI_BYTES", "UI_DIGEST", "UI_MEANING_IDENTITY"].includes(error.code),
  );
});

test("malformed runtime binding returns a typed closed state", async () => {
  assert.throws(() => parseBinding("{"), error => error instanceof BindingError && error.code === "BINDING_INVALID");
  const response = await worker.fetch(
    new Request("https://worker.invalid/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("unused") }, GOV_RELEASE_BINDING_JSON: "{" },
    {},
  );
  assert.equal(response.status, 500);
  assert.equal((await response.json()).code, "BINDING_INVALID");
});
