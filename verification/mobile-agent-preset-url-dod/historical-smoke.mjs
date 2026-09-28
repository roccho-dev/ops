import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright-core";

const [casesPath, baseInput, browserPath, outInput] = process.argv.slice(2);
assert.ok(casesPath && baseInput && browserPath && outInput, "usage: historical-smoke.mjs CASES BASE CHROME OUT");
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
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
    const page = await context.newPage();
    const errors = [];
    const responses = [];
    await page.route("**/favicon.ico", route => route.fulfill({ status: 204, contentType: "image/x-icon", body: "" }));
    page.on("pageerror", error => errors.push(String(error)));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("response", response => responses.push({ status: response.status(), url: response.url() }));
    const url = new URL("app/", base);
    url.hash = item.fragment;
    await page.goto(url.href, { waitUntil: "networkidle", timeout: 75_000 });
    await page.waitForFunction(() => globalThis.semanticMapSite?.ready === true && globalThis.semanticMapApp?.ready === true && Boolean(globalThis.semanticMapRuntime?.view?.pattern), null, { timeout: 75_000 });
    const state = await page.evaluate(() => ({
      href: location.href,
      pattern: globalThis.semanticMapRuntime.view.pattern,
      scenePattern: globalThis.semanticMapApp.snapshot().scene.pattern,
      maxGraphSvg: Boolean(document.querySelector("#graph-container svg")),
      maxGraphInstance: Boolean(globalThis.semanticMapApp.adapter?.graph),
      controls: ["pattern-select", "add-node", "undo", "redo", "delete", "handoff-fab", "review-layer"].map(id => ({ id, present: Boolean(document.getElementById(id)) })),
      camera: globalThis.semanticMapApp.snapshot().camera,
      review: {
        layer: Boolean(document.getElementById("review-layer")),
        source: Boolean(document.getElementById("review-source")),
        accept: Boolean(document.getElementById("review-accept")),
        reject: Boolean(document.getElementById("review-reject")),
      },
    }));
    assert.equal(state.pattern, item.preset, `${item.id}: runtime preset`);
    assert.equal(state.scenePattern, item.preset, `${item.id}: scene preset`);
    assert.equal(new URL(state.href).hash, `#${item.fragment}`, `${item.id}: exact fragment`);
    assert.equal(state.maxGraphSvg, true, `${item.id}: maxGraph SVG`);
    assert.equal(state.maxGraphInstance, true, `${item.id}: maxGraph instance`);
    assert.ok(state.controls.every(control => control.present), `${item.id}: missing controls ${JSON.stringify(state.controls)}`);
    assert.ok(Object.values(state.review).every(Boolean), `${item.id}: review contract`);
    const body = await page.locator("body").innerText();
    for (const label of item.labels) assert.ok(body.includes(label), `${item.id}: missing ${label}`);

    let interaction;
    if (item.id === "graph") {
      interaction = await page.evaluate(() => {
        const region = [...semanticMapApp.store.domain.regions.values()].find(value => value.parent !== null);
        const cell = semanticMapApp.adapter.cellsByRegionId.get(region.id);
        const editable = semanticMapApp.adapter.graph.isCellEditable(cell);
        const movable = semanticMapApp.adapter.graph.isCellMovable(cell);
        const before = region.label;
        semanticMapApp.operation({ type: "RenameRegion", regionId: region.id, label: `${before} proof` });
        const changed = semanticMapApp.store.domain.regions.get(region.id).label;
        semanticMapApp.undo();
        const undone = semanticMapApp.store.domain.regions.get(region.id).label;
        semanticMapApp.redo();
        const redone = semanticMapApp.store.domain.regions.get(region.id).label;
        return { before, changed, undone, redone, editable, movable };
      });
      assert.equal(interaction.editable, true, "graph: label editable");
      assert.equal(interaction.movable, false, "graph: auto-layout geometry fixed");
      assert.notEqual(interaction.changed, interaction.before, "graph: edit");
      assert.equal(interaction.undone, interaction.before, "graph: undo");
      assert.equal(interaction.redone, interaction.changed, "graph: redo");
    } else if (item.id === "map") {
      const drag = await page.evaluate(() => {
        const region = [...semanticMapApp.store.domain.regions.values()].find(value => value.parent !== null);
        const cell = semanticMapApp.adapter.cellsByRegionId.get(region.id);
        const state = semanticMapApp.adapter.graph.view.getState(cell);
        const node = state?.shape?.node || state?.text?.node;
        if (!node) throw new Error("map: rendered node unavailable");
        const box = node.getBoundingClientRect();
        return { regionId: region.id, before: { ...region.bounds }, movable: semanticMapApp.adapter.graph.isCellMovable(cell), box: { x: box.x, y: box.y, width: box.width, height: box.height } };
      });
      assert.equal(drag.movable, true, "map: geometry editable");
      const startX = drag.box.x + drag.box.width / 2;
      const startY = drag.box.y + drag.box.height / 2;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 40, startY, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(300);
      const moved = await page.evaluate(regionId => ({ ...semanticMapApp.store.domain.regions.get(regionId).bounds }), drag.regionId);
      assert.notEqual(moved.x, drag.before.x, "map: real drag");
      await page.locator("#undo").click();
      await page.waitForTimeout(200);
      const undone = await page.evaluate(regionId => ({ ...semanticMapApp.store.domain.regions.get(regionId).bounds }), drag.regionId);
      await page.locator("#redo").click();
      await page.waitForTimeout(200);
      const redone = await page.evaluate(regionId => ({ ...semanticMapApp.store.domain.regions.get(regionId).bounds }), drag.regionId);
      assert.deepEqual(undone, drag.before, "map: undo");
      assert.deepEqual(redone, moved, "map: redo");
      const zoom = await page.evaluate(() => {
        const before = semanticMapApp.snapshot().camera;
        semanticMapApp.zoomAtWorld(0, 0, before.scale * 1.25);
        return { before, after: semanticMapApp.snapshot().camera };
      });
      assert.ok(zoom.after.scale > zoom.before.scale, "map: zoom");
      interaction = { before: drag.before, moved, undone, redone, zoom };
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

    await page.locator("#handoff-fab").click();
    await page.waitForFunction(() => {
      const layer = document.getElementById("handoff-layer");
      const copy = document.getElementById("handoff-copy-text");
      const size = document.getElementById("handoff-text-size");
      return layer && !layer.hidden && copy && !copy.disabled && size && !/Preparing/i.test(size.textContent || "");
    }, null, { timeout: 30_000 });
    await page.locator("#handoff-request").fill(`proof ${item.id}`);
    await page.locator("#handoff-copy-text").click();
    await page.waitForTimeout(250);
    const handoff = await page.evaluate(async () => ({
      layerVisible: !document.getElementById("handoff-layer").hidden,
      textSize: document.getElementById("handoff-text-size").textContent,
      status: document.getElementById("handoff-copy-status").textContent,
      clipboard: await navigator.clipboard.readText(),
    }));
    assert.equal(handoff.layerVisible, true, `${item.id}: handoff layer`);
    assert.ok(handoff.clipboard.includes("#smap="), `${item.id}: handoff exact state URL`);
    assert.ok(handoff.clipboard.includes(`proof ${item.id}`), `${item.id}: handoff request`);
    await page.locator("#handoff-close").click();

    const failed = responses.filter(response => response.status >= 400 && !response.url.endsWith("/favicon.ico"));
    assert.deepEqual(errors, [], `${item.id}: browser errors`);
    assert.deepEqual(failed, [], `${item.id}: failed product responses`);
    await page.screenshot({ path: path.join(out, `${item.id}.png`), fullPage: true });
    observations.push({ id: item.id, preset: item.preset, status: "PASS", url: page.url(), maxGraph: true, controls: state.controls, review: state.review, handoff: { textSize: handoff.textSize, status: handoff.status, containsSmap: true, containsRequest: true }, interaction, browserErrors: 0, failedProductResponses: 0 });
    await context.close();
  }
} finally {
  await browser.close();
}
const receipt = { schema: "ops.historicalMobileAgentPresetUrlReceipt/1", status: "PASS", authority: false, base: base.href, cases: observations };
fs.writeFileSync(path.join(out, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
fs.writeFileSync(path.join(out, "urls.json"), `${JSON.stringify({ schema: "ops.mobileAgentPresetPublicUrls/1", authority: false, urls: Object.fromEntries(observations.map(item => [item.id, item.url])) }, null, 2)}\n`);
console.log(JSON.stringify({ status: "PASS", urls: Object.fromEntries(observations.map(item => [item.id, item.url])) }));
