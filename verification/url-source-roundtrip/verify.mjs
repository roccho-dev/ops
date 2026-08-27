#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const mobile = resolve(process.argv[2] ?? "");
assert.ok(process.argv[2], "mobile-agent repository path is required");
const codec = await import(pathToFileURL(resolve(mobile, "packages/transport/public-codec.js")));
const domain = await import(pathToFileURL(resolve(mobile, "packages/domain/index.js")));
const protocol = await import(pathToFileURL(resolve(mobile, "packages/protocol/index.js")));

const source = readFileSync(resolve(mobile, "examples/new.jsonl"), "utf8");
const records = domain.parseSemanticMapRecords(source);
const base = await codec.createDecisionLog(records, "semantic-map:ops-proof:url-source");
const envelope = await codec.createEnvelope(base.log, null, { pattern: "map/1" });
const inlineUrl = await codec.createInlineSmapUrl(envelope, { base: "https://proof.example/app" });
const inline = await codec.decompileSmapInvocation(inlineUrl);

assert.equal(inline.schema, codec.SOURCE_EXPORT_SCHEMA);
assert.equal(inline.stateJSONL, domain.recordsToJSONL(base.records));
assert.equal(inline.decisionLogJSONL, base.log);
assert.equal(inline.envelopeJSON, `${protocol.canonicalJson(envelope)}\n`);
assert.equal(inline.proposalStateJSONL, null);
assert.ok(inline.stateJSONL.endsWith("\n"));
assert.ok(inline.decisionLogJSONL.endsWith("\n"));
assert.ok(inline.envelopeJSON.endsWith("\n"));

const proposal = await codec.createDecision(base.head, [{
  type: "RenameRegion",
  regionId: "root",
  label: "OPS proof",
}], base.records);
const proposalEnvelope = await codec.createEnvelope(base.log, proposal.decision, { pattern: "map/1" });
const proposalUrl = await codec.createInlineSmapUrl(proposalEnvelope, { base: "https://proof.example/app" });
const proposed = await codec.decompileSmapInvocation(proposalUrl);
assert.equal(proposed.stateJSONL, inline.stateJSONL);
assert.equal(proposed.proposalStateJSONL, domain.recordsToJSONL(proposal.records));
assert.equal(proposed.decisionLogJSONL, inline.decisionLogJSONL);

const digest = await codec.envelopeDigest(envelope);
const referenceUrl = codec.createSmapReferenceUrl(digest, "https://proof.example/app");
let requests = 0;
const referenced = await codec.decompileSmapInvocation(referenceUrl, {
  fetchImpl: async (url, init) => {
    requests += 1;
    assert.equal(init.method, "GET");
    assert.equal(url, `https://proof.example/artifacts/${encodeURIComponent(digest)}`);
    return new Response(JSON.stringify(envelope), { status: 200, headers: { "content-type": "application/json" } });
  },
});
assert.equal(requests, 1);
assert.equal(referenced.stateJSONL, inline.stateJSONL);
assert.equal(referenced.decisionLogJSONL, inline.decisionLogJSONL);
assert.equal(referenced.envelopeJSON, inline.envelopeJSON);

const manifest = JSON.parse(readFileSync(resolve(mobile, "dist/.well-known/semantic-map.json"), "utf8"));
assert.equal(manifest.sourceExport.schema, codec.SOURCE_EXPORT_SCHEMA);
assert.equal(manifest.sourceExport.function, "decompileSmapInvocation");
assert.deepEqual(manifest.sourceExport.inputs, ["smap", "smap-ref"]);
assert.deepEqual(manifest.sourceExport.outputs, ["stateJSONL", "proposalStateJSONL", "decisionLogJSONL", "envelopeJSON"]);
assert.equal(manifest.sourceExport.stateRole, "accepted");

console.log(JSON.stringify({
  schema: "roccho.url-source-roundtrip-proof/1",
  status: "PASS",
  inputModes: ["smap", "smap-ref"],
  outputs: manifest.sourceExport.outputs,
  acceptedStateStableAcrossProposal: true,
  proposalPreviewSeparated: true,
  decisionLogPreserved: true,
  canonicalLineFeed: true,
  stateRecords: base.records.length,
  decisionLogLines: base.log.trimEnd().split("\n").length,
  referenceRequests: requests
}));
