import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright-core";

const fixture = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const executablePath = process.argv[3];
const outDir = path.resolve(process.argv[4]);
assert.equal(fixture.schema, "ops.atlasStageFourUrlCases/1");
assert.equal(fixture.cases.length, 4);
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const receipt = {
  schema: "ops.atlasStageFourUrlSmokeReceipt/1",
  status: "PASS",
  authority: false,
  publicationTree: fixture.publicationTree,
  stableBase: fixture.stableBase,
  proofOnlyFavicon204: true,
  cases: [],
};
try {
  for (const item of fixture.cases) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    const failedResponses = [];
    await page.route("**/favicon.ico", route => route.fulfill({ status: 204, contentType: "image/x-icon", body: "" }));
    page.on("pageerror", error => errors.push(String(error)));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("response", response => {
      if (response.status() >= 400) failedResponses.push({ status: response.status(), url: response.url() });
    });
    await page.goto(item.url, { waitUntil: "networkidle", timeout: 75_000 });
    await page.waitForFunction(() => document.querySelector("#status")?.textContent?.trim() === "PASS", null, { timeout: 75_000 });
    const observation = await page.evaluate(() => {
      const result = JSON.parse(document.querySelector("#result")?.textContent || "null");
      const runtimeReceipt = JSON.parse(document.querySelector("#receipt")?.textContent || "null");
      const svg = document.querySelector('#surface svg[data-atlas-stage="svg"]');
      return {
        href: location.href,
        surfaceText: (document.querySelector("#surface")?.textContent || "").replace(/\s+/g, " ").trim(),
        status: document.querySelector("#status")?.textContent?.trim() || null,
        result,
        runtimeReceipt,
        canvas: svg ? {
          nodeCount: Number(svg.getAttribute("data-atlas-node-count")),
          edgeCount: Number(svg.getAttribute("data-atlas-edge-count")),
          ariaLabel: svg.getAttribute("aria-label"),
          viewBox: svg.getAttribute("viewBox"),
        } : null,
      };
    });
    assert.equal(observation.status, "PASS");
    assert.equal(observation.result.status, "PASS");
    assert.equal(observation.result.outputs?.[0]?.contract, "a2ui-render-receipt/1");
    assert.equal(observation.runtimeReceipt.capability?.id, "render.a2ui");
    assert.equal(observation.runtimeReceipt.capability?.version, "1");
    for (const label of item.labels) assert.ok(observation.surfaceText.includes(label), `${item.id}: missing ${label}`);
    if (item.canvas) {
      assert.ok(observation.canvas, `${item.id}: SVG canvas missing`);
      assert.equal(observation.canvas.nodeCount, item.nodeCount);
      assert.equal(observation.canvas.edgeCount, item.edgeCount);
      assert.ok(observation.canvas.viewBox);
    } else {
      assert.equal(observation.canvas, null);
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(failedResponses, []);
    const observed = new URL(observation.href);
    const requested = new URL(item.url);
    assert.equal(observed.origin, requested.origin);
    assert.equal(observed.hash, requested.hash);
    assert.ok(observed.pathname.startsWith(`/releases/${process.env.TREE_ID}/`));
    await page.screenshot({ path: path.join(outDir, `${item.id}.png`), fullPage: true });
    fs.writeFileSync(path.join(outDir, `${item.id}.html`), await page.content());
    receipt.cases.push({
      id: item.id,
      status: "PASS",
      url: item.url,
      observedUrl: observation.href,
      urlLength: item.urlLength,
      canvas: item.canvas,
      nodeCount: item.nodeCount,
      edgeCount: item.edgeCount,
      capability: "render.a2ui@1",
      outputContract: "a2ui-render-receipt/1",
      browserErrors: 0,
      failedResponses: 0,
    });
    await page.close();
  }
} finally {
  await browser.close();
}
fs.writeFileSync(path.join(outDir, "smoke-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, "four-urls.json"), `${JSON.stringify({
  schema: "ops.atlasStageFourUrls/1",
  publicationTree: receipt.publicationTree,
  urls: Object.fromEntries(receipt.cases.map(item => [item.id, item.url])),
}, null, 2)}\n`);
console.log(JSON.stringify(receipt));
