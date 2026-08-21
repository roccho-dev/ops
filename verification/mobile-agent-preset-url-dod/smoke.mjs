import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright-core";

const [casesPath, baseInput, browserPath, outInput] = process.argv.slice(2);
assert.ok(casesPath && baseInput && browserPath && outInput, "usage: smoke.mjs CASES BASE CHROME OUT");
const source = JSON.parse(fs.readFileSync(casesPath, "utf8"));
assert.equal(source.schema, "ops.mobileAgentPresetUrlDodCases/1");
assert.deepEqual(source.cases.map(item => item.preset), ["graph/1", "map/1", "seq/1"]);
const base = new URL(baseInput);
base.hash = "";
const out = path.resolve(outInput);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const observations = [];
try {
  for (const item of source.cases) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    const failed = [];
    await page.route("**/favicon.ico", route => route.fulfill({ status: 204, contentType: "image/x-icon", body: "" }));
    page.on("pageerror", error => errors.push(String(error)));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("response", response => { if (response.status() >= 400 && !response.url().endsWith("/favicon.ico")) failed.push({ status: response.status(), url: response.url() }); });
    const url = new URL("app/", base);
    url.hash = item.fragment;
    await page.goto(url.href, { waitUntil: "networkidle", timeout: 75_000 });
    await page.waitForFunction(() => globalThis.semanticMapSite?.ready === true, null, { timeout: 75_000 });
    await page.waitForFunction(() => globalThis.semanticMapApp?.ready === true, null, { timeout: 75_000 });
    await page.waitForFunction(() => Boolean(globalThis.semanticMapRuntime?.view?.pattern), null, { timeout: 75_000 });
    const state = await page.evaluate(() => ({
      pattern: semanticMapRuntime.view.pattern,
      scenePattern: semanticMapApp.snapshot().scene.pattern,
      maxGraphSvg: Boolean(document.querySelector("#graph-container svg")),
      maxGraphInstance: Boolean(semanticMapApp.adapter?.graph),
      controls: ["pattern-select", "add-node", "undo", "redo", "delete", "source-open", "handoff-fab", "review-layer"].map(id => ({ id, present: Boolean(document.getElementById(id)) })),
      sourceReady: semanticMapSource?.ready === true,
      handoffReady: semanticMapHandoff?.ready === true,
      reviewReady: semanticMapReview?.ready === true,
      envelope: semanticMapRuntime.envelope(),
      camera: semanticMapApp.snapshot().camera,
    }));
    assert.equal(state.pattern, item.preset, `${item.id}: runtime preset`);
    assert.equal(state.scenePattern, item.preset, `${item.id}: scene preset`);
    assert.equal(state.envelope.view.pattern, item.preset, `${item.id}: envelope preset`);
    assert.equal(state.maxGraphSvg, true, `${item.id}: maxGraph SVG`);
    assert.equal(state.maxGraphInstance, true, `${item.id}: maxGraph instance`);
    assert.ok(state.controls.every(control => control.present), `${item.id}: missing controls ${JSON.stringify(state.controls)}`);
    assert.ok(state.sourceReady && state.handoffReady && state.reviewReady, `${item.id}: existing UX shells`);
    const body = await page.locator("body").innerText();
    for (const label of item.labels) assert.ok(body.includes(label), `${item.id}: missing ${label}`);

    let interaction;
    if (item.id === "graph") {
      interaction = await page.evaluate(async () => {
        const region = [...semanticMapApp.store.domain.regions.values()].find(value => value.parent !== null);
        const cell = semanticMapApp.adapter.cellsByRegionId.get(region.id);
        const before = { ...semanticMapApp.store.domain.regions.get(region.id).bounds };
        const [{ default: EventObject }, { default: InternalEvent }] = await Promise.all([
          import("semantic:vendor/maxgraph/view/event/EventObject.js"),
          import("semantic:vendor/maxgraph/view/event/InternalEvent.js"),
        ]);
        semanticMapApp.adapter.graph.fireEvent(new EventObject(InternalEvent.CELLS_MOVED, { cells: [cell], dx: 40, dy: 0, disconnect: false }));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const moved = { ...semanticMapApp.store.domain.regions.get(region.id).bounds };
        semanticMapApp.undo();
        const undone = { ...semanticMapApp.store.domain.regions.get(region.id).bounds };
        semanticMapApp.redo();
        const redone = { ...semanticMapApp.store.domain.regions.get(region.id).bounds };
        return { before, moved, undone, redone };
      });
      assert.notEqual(interaction.moved.x, interaction.before.x, "graph: drag");
      assert.deepEqual(interaction.undone, interaction.before, "graph: undo");
      assert.deepEqual(interaction.redone, interaction.moved, "graph: redo");
    } else if (item.id === "map") {
      interaction = await page.evaluate(() => {
        const before = semanticMapApp.snapshot().camera;
        semanticMapApp.zoomAtWorld(0, 0, before.scale * 1.25);
        return { before, after: semanticMapApp.snapshot().camera };
      });
      assert.ok(interaction.after.scale > interaction.before.scale, "map: zoom");
    } else {
      interaction = await page.evaluate(() => {
        const region = [...semanticMapApp.store.domain.regions.values()].find(value => value.parent !== null);
        const before = region.label;
        semanticMapApp.operation({ type: "RenameRegion", regionId: region.id, label: `${before} proof` });
        const changed = semanticMapApp.store.domain.regions.get(region.id).label;
        semanticMapApp.undo();
        return { before, changed, restored: semanticMapApp.store.domain.regions.get(region.id).label };
      });
      assert.notEqual(interaction.changed, interaction.before, "seq: edit");
      assert.equal(interaction.restored, interaction.before, "seq: undo");
    }
    const exported = await page.evaluate(async () => {
      const state = await semanticMapSource.render("state");
      return { schema: state.schema, bytes: state.bytes, text: state.text };
    });
    assert.ok(exported.bytes > 0 && exported.text.trim(), `${item.id}: Source export`);
    assert.deepEqual(errors, [], `${item.id}: browser errors`);
    assert.deepEqual(failed, [], `${item.id}: failed product responses`);
    await page.screenshot({ path: path.join(out, `${item.id}.png`), fullPage: true });
    observations.push({ id: item.id, preset: item.preset, status: "PASS", url: page.url(), maxGraph: true, controls: state.controls, sourceExportBytes: exported.bytes, interaction, browserErrors: 0, failedProductResponses: 0 });
    await page.close();
  }
} finally {
  await browser.close();
}
const receipt = { schema: "ops.mobileAgentPresetUrlDodReceipt/1", status: "PASS", authority: false, base: base.href, cases: observations };
fs.writeFileSync(path.join(out, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
fs.writeFileSync(path.join(out, "urls.json"), `${JSON.stringify({ schema: "ops.mobileAgentPresetPublicUrls/1", authority: false, urls: Object.fromEntries(observations.map(item => [item.id, item.url])) }, null, 2)}\n`);
console.log(JSON.stringify({ status: "PASS", urls: Object.fromEntries(observations.map(item => [item.id, item.url])) }));
