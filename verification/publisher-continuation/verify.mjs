#!/usr/bin/env node
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const mobile = resolve(process.argv[2] ?? "");
assert.ok(process.argv[2], "mobile-agent repository path is required");

const app = await import(pathToFileURL(resolve(mobile, "packages/app/runtime.js")));
const publisher = await import(pathToFileURL(resolve(mobile, "packages/app/publisher.js")));
const domain = await import(pathToFileURL(resolve(mobile, "packages/domain/index.js")));
const protocol = await import(pathToFileURL(resolve(mobile, "packages/protocol/index.js")));
const codec = await import(pathToFileURL(resolve(mobile, "packages/transport/public-codec.js")));

function noise(length, seed) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let state = seed >>> 0;
  let value = "";
  for (let index = 0; index < length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    value += alphabet[(state >>> 0) % alphabet.length];
  }
  return value;
}

const records = [
  { type: "meta", schema: "semantic-map-state/1", root: "root", title: "Publisher closure proof" },
  { type: "region", id: "root", parent: null, label: "Root", kind: "root", bounds: [0, 0, 960, 760], summary: "" },
];
for (let index = 0; index < 16; index += 1) {
  records.push({
    type: "region",
    id: `proof-${index}`,
    parent: "root",
    label: `Proof ${index}`,
    kind: "evidence",
    bounds: [20 + (index % 4) * 220, 20 + Math.floor(index / 4) * 170, 180, 130],
    summary: noise(1_800, 0x6d2b79f5 ^ (index * 0x9e3779b9)),
  });
}
const created = await protocol.createDecisionLog(records, "semantic-map:ops-proof:publisher-continuation");
const envelope = await protocol.createEnvelope(created.log, null, { pattern: "map/1" });
const inspection = await codec.inspectSmapDelivery(envelope, { base: "https://proof.example/app" });
assert.equal(inspection.canInline, false);
assert.ok(inspection.urlChars > 8_192);

const artifacts = new Map();
const calls = [];
const endpoint = "https://proof.example/artifacts";
const fetchImpl = async (url, init = {}) => {
  const method = init.method ?? "GET";
  calls.push({ method, url });
  if (method === "POST") {
    assert.equal(url, endpoint);
    const canonical = String(init.body ?? "");
    const storedEnvelope = JSON.parse(canonical);
    const digest = await protocol.sha256(protocol.canonicalJson(storedEnvelope));
    artifacts.set(digest, storedEnvelope);
    const location = `${endpoint}/${encodeURIComponent(digest)}`;
    return new Response(JSON.stringify({
      schema: "semantic-map-artifact-store-receipt/1",
      digest,
      stored: true,
      location,
    }), { status: 201, headers: { "content-type": "application/json", location } });
  }
  const digest = decodeURIComponent(new URL(url).pathname.split("/").at(-1));
  const storedEnvelope = artifacts.get(digest);
  return storedEnvelope
    ? new Response(JSON.stringify(storedEnvelope), { status: 200, headers: { "content-type": "application/json" } })
    : new Response("not found", { status: 404 });
};

const storePort = publisher.createArtifactStorePort({
  schema: "semantic-map-http-artifact-store/1",
  endpoint: "/artifacts",
  publisher: {
    schema: "semantic-map-explicit-publisher/1",
    disclosure: {
      label: "OPS proof store",
      visibility: "reference URL holders",
      retention: "immutable proof lifetime",
      cost: "0 JPY in proof",
    },
  },
}, { base: "https://proof.example/app", fetchImpl });

const replacements = [];
const runtime = await app.DecisionRuntime.create(envelope, {
  baseUrl: () => replacements.at(-1) ?? `https://proof.example/app#smap-ref=${encodeURIComponent(created.stateHash)}`,
  replaceUrl: (url) => replacements.push(url),
  artifactEndpoint: storePort.endpoint,
  publisherPort: storePort.publisher,
  validateRecords: async (candidate) => domain.createSemanticMap(candidate),
});
const semanticStore = new domain.SemanticDomainStore(domain.createSemanticMap(runtime.records));
runtime.attachStore(semanticStore);
semanticStore.perform({ type: "RenameRegion", regionId: "proof-0", label: "Published continuation" });
const proposal = await runtime.createDraftProposal();
const preflight = await runtime.preflightAccept(proposal, { base: "https://proof.example/app" });
assert.equal(preflight.delivery.status, "confirmation-required");
assert.equal(preflight.delivery.action, "publish-reference");
assert.equal(preflight.delivery.code, "PUBLISH_CONFIRMATION_REQUIRED");
assert.equal(calls.length, 0, "preflight must not write");
const headBefore = runtime.head;
const logBefore = runtime.log;
await assert.rejects(
  runtime.accept(proposal, { expectedDigest: preflight.delivery.digest }),
  (error) => error.code === "PUBLISH_CONFIRMATION_REQUIRED",
);
assert.equal(calls.length, 0, "unconfirmed Accept must not write");
assert.equal(runtime.head, headBefore);
assert.equal(runtime.log, logBefore);
assert.equal(runtime.draftCount(), 1);

const accepted = await runtime.accept(proposal, {
  confirmPublish: true,
  expectedDigest: preflight.delivery.digest,
  base: "https://proof.example/app",
});
assert.equal(calls.filter((item) => item.method === "POST").length, 1);
assert.equal(accepted.delivery.mode, "reference");
assert.equal(accepted.delivery.receipt.stored, true);
assert.match(accepted.url, /#smap-ref=/u);
assert.notEqual(runtime.head, headBefore);
assert.equal(runtime.log.trimEnd().split("\n").length, logBefore.trimEnd().split("\n").length + 1);
assert.equal(runtime.draftCount(), 0);

const reopened = await codec.decompileSmapInvocation(accepted.url, {
  endpoint: storePort.endpoint,
  fetchImpl,
});
assert.equal(reopened.decisionLogJSONL, accepted.log);
assert.equal(reopened.stateJSONL, domain.recordsToJSONL(accepted.records));
assert.match(reopened.stateJSONL, /"label":"Published continuation"/u);
assert.equal(calls.filter((item) => item.method === "GET").length, 1);
assert.equal(calls.some((item) => item.method === "QUERY"), false);

const blockedReplacements = [];
const blocked = await app.DecisionRuntime.create(envelope, {
  baseUrl: () => "https://proof.example/app#smap-ref=sha256%3Ablocked",
  replaceUrl: (url) => blockedReplacements.push(url),
  artifactEndpoint: storePort.endpoint,
  validateRecords: async (candidate) => domain.createSemanticMap(candidate),
});
const blockedStore = new domain.SemanticDomainStore(domain.createSemanticMap(blocked.records));
blocked.attachStore(blockedStore);
blockedStore.perform({ type: "RenameRegion", regionId: "proof-1", label: "Reject locally" });
const blockedProposal = await blocked.createDraftProposal();
const blockedPlan = await blocked.preflightAccept(blockedProposal, { base: "https://proof.example/app" });
assert.equal(blockedPlan.delivery.code, "PUBLISHER_REQUIRED");
const keptUrl = await blocked.reject({ local: true });
assert.equal(keptUrl, "https://proof.example/app#smap-ref=sha256%3Ablocked");
assert.equal(blockedReplacements.length, 0);
assert.equal(blocked.draftCount(), 0);
assert.equal(blockedStore.domain.regions.get("proof-1").label, "Proof 1");

console.log(JSON.stringify({
  schema: "roccho.publisher-continuation-proof/1",
  status: "PASS",
  inlineUrlChars: inspection.urlChars,
  flow: ["preflight", "explicit POST", "commit", "reference GET", "reopen"],
  preflightWrites: 0,
  artifactPosts: calls.filter((item) => item.method === "POST").length,
  artifactGets: calls.filter((item) => item.method === "GET").length,
  queryUsed: false,
  acceptedLogLines: accepted.log.trimEnd().split("\n").length,
  nextDigest: accepted.delivery.digest,
  stateReopened: true,
  publisherRequiredFailsClosed: true,
  localRejectKeepsUrlWithoutWrite: true,
}));
