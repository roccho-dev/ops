import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright-core";

const [casePath, baseInput, browserPath, outInput] = process.argv.slice(2);
assert.ok(casePath && baseInput && browserPath && outInput, "usage: smoke.mjs CASE BASE CHROME OUT");
const item = JSON.parse(fs.readFileSync(casePath, "utf8"));
assert.equal(item.schema, "ops.mobileAgentSeqCase/1");
assert.equal(item.preset, "seq/1");
assert.ok(item.fragment.startsWith("smap="));
const base = new URL(baseInput);
base.hash = "";
const out = path.resolve(outInput);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
const responses = [];
await page.route("**/favicon.ico", route => route.fulfill({ status: 204, contentType: "image/x-icon", body: "" }));
page.on("pageerror", error => errors.push(String(error)));
page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
page.on("response", response => responses.push({ status: response.status(), url: response.url() }));
try {
  const url = new URL("app", base);
  url.hash = item.fragment;
  await page.goto(url.href, { waitUntil: "networkidle", timeout: 75_000 });
  await page.waitForFunction(() => globalThis.semanticMapSite?.ready === true, null, { timeout: 75_000 });
  await page.waitForFunction(() => globalThis.semanticMapApp?.ready === true, null, { timeout: 75_000 });
  await page.waitForFunction(() => globalThis.semanticMapRuntime?.view?.pattern === "seq/1", null, { timeout: 75_000 });
  const state = await page.evaluate(() => ({
    href: location.href,
    pattern: semanticMapRuntime.view.pattern,
    scenePattern: semanticMapApp.snapshot().scene.pattern,
    envelopePattern: semanticMapRuntime.envelope().view.pattern,
    maxGraphSvg: Boolean(document.querySelector("#graph-container svg")),
    maxGraphInstance: Boolean(semanticMapApp.adapter?.graph),
    controls: ["pattern-select", "add-node", "undo", "redo", "delete", "source-open", "handoff-fab", "review-layer"].map(id => ({ id, present: Boolean(document.getElementById(id)) })),
    sourceReady: semanticMapSource?.ready === true,
    handoffReady: semanticMapHandoff?.ready === true,
    reviewReady: semanticMapReview?.ready === true,
  }));
  assert.equal(state.pattern, "seq/1");
  assert.equal(state.scenePattern, "seq/1");
  assert.equal(state.envelopePattern, "seq/1");
  assert.equal(state.maxGraphSvg, true);
  assert.equal(state.maxGraphInstance, true);
  assert.ok(state.controls.every(control => control.present), JSON.stringify(state.controls));
  assert.ok(state.sourceReady && state.handoffReady && state.reviewReady);
  const body = await page.locator("body").innerText();
  for (const label of item.labels) assert.ok(body.includes(label), `missing ${label}`);
  const interaction = await page.evaluate(() => {
    const region = [...semanticMapApp.store.domain.regions.values()].find(value => value.parent !== null);
    const before = region.label;
    semanticMapApp.operation({ type: "RenameRegion", regionId: region.id, label: `${before} proof` });
    const changed = semanticMapApp.store.domain.regions.get(region.id).label;
    semanticMapApp.undo();
    const restored = semanticMapApp.store.domain.regions.get(region.id).label;
    return { before, changed, restored };
  });
  assert.notEqual(interaction.changed, interaction.before, "seq edit");
  assert.equal(interaction.restored, interaction.before, "seq undo");
  const exported = await page.evaluate(async () => {
    const value = await semanticMapSource.render("state");
    return { bytes: value.bytes, text: value.text };
  });
  assert.ok(exported.bytes > 0 && exported.text.trim());
  const failed = responses.filter(response => response.status >= 400 && !response.url.endsWith("/favicon.ico"));
  assert.deepEqual(errors, []);
  assert.deepEqual(failed, []);
  await page.screenshot({ path: path.join(out, "seq.png"), fullPage: true });
  const receipt = { schema: "ops.mobileAgentSeqPublicProof/1", status: "PASS", authority: false, url: page.url(), preset: "seq/1", maxGraph: true, controls: state.controls, interaction, sourceExportBytes: exported.bytes, browserErrors: 0, failedProductResponses: 0 };
  fs.writeFileSync(path.join(out, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  fs.writeFileSync(path.join(out, "url.txt"), `${page.url()}\n`);
  console.log(JSON.stringify({ status: "PASS", url: page.url() }));
} finally {
  await page.close();
  await browser.close();
}
