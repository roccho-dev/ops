import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright-core";

const [urlInput, browserPath, outInput] = process.argv.slice(2);
assert.ok(urlInput && browserPath && outInput, "usage: seq-smoke.mjs URL CHROME OUT");
const requested = new URL(urlInput);
assert.ok(requested.hash.startsWith("#smap="), "Seq URL must use #smap");
const out = path.resolve(outInput);
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: browserPath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  const responses = [];
  await page.route("**/favicon.ico", route => route.fulfill({ status: 204, contentType: "image/x-icon", body: "" }));
  page.on("pageerror", error => errors.push(String(error)));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("response", response => responses.push({ status: response.status(), url: response.url() }));

  await page.goto(requested.href, { waitUntil: "networkidle", timeout: 75_000 });
  await page.waitForFunction(() => globalThis.semanticMapSite?.ready === true, null, { timeout: 75_000 });
  await page.waitForFunction(() => globalThis.semanticMapApp?.ready === true, null, { timeout: 75_000 });
  await page.waitForFunction(() => globalThis.semanticMapRuntime?.view?.pattern === "seq/1", null, { timeout: 75_000 });

  const state = await page.evaluate(() => ({
    href: location.href,
    pattern: semanticMapRuntime.view.pattern,
    scenePattern: semanticMapApp.snapshot().scene.pattern,
    maxGraphSvg: Boolean(document.querySelector("#graph-container svg")),
    maxGraphInstance: Boolean(semanticMapApp.adapter?.graph),
    controls: ["pattern-select", "add-node", "undo", "redo", "delete", "source-open", "handoff-fab", "review-layer"].map(id => ({ id, present: Boolean(document.getElementById(id)) })),
    sourceReady: semanticMapSource?.ready === true,
    handoffReady: semanticMapHandoff?.ready === true,
    reviewReady: semanticMapReview?.ready === true,
    envelope: semanticMapRuntime.envelope(),
  }));
  assert.equal(state.pattern, "seq/1");
  assert.equal(state.scenePattern, "seq/1");
  assert.equal(state.envelope.view.pattern, "seq/1");
  assert.equal(state.maxGraphSvg, true);
  assert.equal(state.maxGraphInstance, true);
  assert.ok(state.controls.every(control => control.present), `missing controls: ${JSON.stringify(state.controls)}`);
  assert.ok(state.sourceReady && state.handoffReady && state.reviewReady, "existing UX shells not ready");

  const body = await page.locator("body").innerText();
  for (const label of ["Decision review sequence", "Human", "Agent"]) assert.ok(body.includes(label), `missing ${label}`);

  const interaction = await page.evaluate(() => {
    const region = [...semanticMapApp.store.domain.regions.values()].find(value => value.parent !== null);
    const before = region.label;
    semanticMapApp.operation({ type: "RenameRegion", regionId: region.id, label: `${before} proof` });
    const changed = semanticMapApp.store.domain.regions.get(region.id).label;
    semanticMapApp.undo();
    const restored = semanticMapApp.store.domain.regions.get(region.id).label;
    return { before, changed, restored };
  });
  assert.notEqual(interaction.changed, interaction.before, "Seq edit did not change label");
  assert.equal(interaction.restored, interaction.before, "Seq undo did not restore label");

  const exported = await page.evaluate(async () => {
    const value = await semanticMapSource.render("state");
    return { schema: value.schema, bytes: value.bytes, text: value.text };
  });
  assert.ok(exported.bytes > 0 && exported.text.trim(), "Source export is empty");
  const failed = responses.filter(response => response.status >= 400 && !response.url.endsWith("/favicon.ico"));
  assert.deepEqual(errors, [], `browser errors: ${JSON.stringify(errors)}`);
  assert.deepEqual(failed, [], `failed product responses: ${JSON.stringify(failed)}`);
  assert.equal(new URL(state.href).hash, requested.hash, "browser URL fragment changed");

  await page.screenshot({ path: path.join(out, "seq.png"), fullPage: true });
  const receipt = {
    schema: "ops.mobileAgentSeqPublicProof/1",
    status: "PASS",
    authority: false,
    url: state.href,
    preset: "seq/1",
    maxGraph: true,
    controls: state.controls,
    interaction,
    sourceExportBytes: exported.bytes,
    browserErrors: 0,
    failedProductResponses: 0,
  };
  fs.writeFileSync(path.join(out, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  fs.writeFileSync(path.join(out, "url.txt"), `${state.href}\n`);
  console.log(JSON.stringify(receipt));
  await page.close();
} finally {
  await browser.close();
}
