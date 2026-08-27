#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [mobileRoot, uiRoot] = process.argv.slice(2).map(value => path.resolve(value ?? ""));
assert.ok(mobileRoot && uiRoot, "mobile and UI repository paths are required");
const mobile = await import(pathToFileURL(path.join(mobileRoot, "packages/transport/public-codec.js")));
const ui = await import(pathToFileURL(path.join(uiRoot, "packages/projections/semantic-map-a2ui/src/index.mjs")));

const records = [
  { type: "meta", schema: "semantic-map-state/1", root: "company", title: "Cross-repo chart" },
  { type: "region", id: "company", parent: null, label: "全社", kind: "root", bounds: [0, 0, 1000, 680], summary: "" },
  { type: "region", id: "product", parent: "company", label: "製品", kind: "chart-branch", bounds: [0, 0, 170, 70], order: 0, summary: "" },
  { type: "region", id: "software", parent: "product", label: "ソフトウェア", kind: "chart-branch", bounds: [0, 0, 170, 70], order: 0, summary: "" },
  { type: "region", id: "api", parent: "software", label: "API", kind: "chart-leaf", bounds: [0, 0, 170, 70], order: 0, value: 18, summary: "" },
];
const created = await mobile.createDecisionLog(records, "cross-repo-chart");
const view = { pattern: "chart/1", chart: { type: "sunburst/1", focus: "product" } };
const envelope = await mobile.createEnvelope(created.log, null, view);
const url = await mobile.createInlineSmapUrl(envelope, { base: "https://cross.test/app" });
const exported = await mobile.decompileSmapUrl(url);
assert.deepEqual(exported.view, view);
assert.equal(exported.proposal, null);
const inspection = await mobile.inspectEnvelope(JSON.parse(exported.envelopeJSON));
const messages = ui.projectSemanticMapToA2ui(inspection);
assert.equal(messages[1].updateDataModel.value.pattern, "chart/1");
assert.deepEqual(messages[1].updateDataModel.value.view, view);
assert.equal(messages[1].updateDataModel.value.records[4].value, 18);

const proposal = (await mobile.createDecision(
  created.head,
  [{ type: "RenameRegion", regionId: "product", label: "製品群" }],
  created.records,
)).decision;
const proposalEnvelope = await mobile.createEnvelope(created.log, proposal, view);
const proposalUrl = await mobile.createInlineSmapUrl(proposalEnvelope, { base: "https://cross.test/app" });
const proposalExport = await mobile.decompileSmapUrl(proposalUrl);
assert.equal(JSON.parse(proposalExport.stateJSONL.split("\n")[2]).label, "製品");
assert.equal(JSON.parse(proposalExport.proposalStateJSONL.split("\n")[2]).label, "製品群");

let publishCalls = 0;
const publisher = mobile.createHttpArtifactPublisher({
  base: "https://cross.test/app",
  endpoint: "/artifacts",
  fetchImpl: async (request, options) => {
    publishCalls += 1;
    assert.equal(request, "https://cross.test/artifacts");
    assert.equal(options.method, "POST");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.redirect, "error");
    assert.equal(options.referrerPolicy, "no-referrer");
    assert.equal(options.headers.accept, "application/json");
    const digest = `sha256:${await crypto.subtle.digest("SHA-256", new TextEncoder().encode(options.body)).then(value => Buffer.from(value).toString("hex"))}`;
    return new Response(JSON.stringify({
      schema: mobile.PUBLISH_RECEIPT_SCHEMA,
      digest,
      stored: true,
      location: `/artifacts/${encodeURIComponent(digest)}`,
    }), {
      status: 201,
      headers: { "content-type": "application/json", location: `/artifacts/${encodeURIComponent(digest)}` },
    });
  },
});
const published = await mobile.publishSmapReference(envelope, {
  base: "https://cross.test/app",
  endpoint: "/artifacts",
  publisher,
});
assert.equal(publishCalls, 1);
assert.equal(published.mode, "reference");
assert.match(published.url, /#smap-ref=sha256%3A/u);
assert.equal(published.receipt.stored, true);

const genericText = ["packages/a2ui-browser", "packages/surface-adapter"]
  .flatMap(relative => fs.readdirSync(path.join(uiRoot, relative), { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && /\.mjs$/u.test(entry.name))
    .map(entry => fs.readFileSync(path.join(entry.parentPath ?? entry.path, entry.name), "utf8")))
  .join("\n");
assert.equal(genericText.includes("business-model-a2ui"), false);
assert.equal(fs.existsSync(path.join(uiRoot, "packages/jsonl-diagram-core")), false);
const retirement = JSON.parse(fs.readFileSync(path.join(uiRoot, "evidence/retirements/legacy-diagram-package/receipt.json"), "utf8"));
assert.equal(retirement.authority, false);
assert.equal(retirement.replacement?.owner ?? retirement.replacementOwner, "mobile-agent");

console.log(JSON.stringify({
  schema: "mobile-ui-cross-contract-proof/1",
  pass: true,
  status: "PASS",
  skipped: false,
  complete: true,
  errors: [],
  chartSourceRoundtrip: true,
  sunburstFocusPreserved: true,
  proposalSeparated: true,
  explicitPublishCalls: publishCalls,
  hardenedTransport: true,
  mobilePublicApiOnly: true,
  businessDomainLeakToGenericCore: false,
  legacyDiagramOwner: "mobile-agent",
}, null, 2));
