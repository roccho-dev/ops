import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright-core";

const [casesInput, browserInput, outputInput] = process.argv.slice(2);
assert.ok(casesInput && browserInput && outputInput, "usage: smoke.mjs CASES CHROME OUTPUT");
const casesPath = path.resolve(casesInput);
const executablePath = path.resolve(browserInput);
const outputDir = path.resolve(outputInput);
const input = JSON.parse(fs.readFileSync(casesPath, "utf8"));
assert.equal(input.schema, "ops.jsonlOnlyFourUrlCases/1");
assert.equal(input.status, "PASS");
assert.equal(input.compiler.handwrittenSurfaceUsed, false);
assert.equal(input.cases.length, 4);
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const receipt = {
  schema: "ops.jsonlOnlyFourUrlBrowserReceipt/1",
  status: "PASS",
  authority: false,
  publication: input.publication,
  compiler: input.compiler,
  stableBase: input.stableBase,
  proofOnlyFavicon204: true,
  browser: {
    executablePath,
    version: await browser.version(),
  },
  cases: [],
};

try {
  for (const item of input.cases) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const browserErrors = [];
    const failedProductResponses = [];
    await page.route("**/favicon.ico", route => route.fulfill({ status: 204, contentType: "image/x-icon", body: "" }));
    page.on("pageerror", error => browserErrors.push(String(error)));
    page.on("console", message => { if (message.type() === "error") browserErrors.push(message.text()); });
    page.on("response", response => {
      if (response.status() >= 400 && !response.url().endsWith("/favicon.ico")) {
        failedProductResponses.push({ status: response.status(), url: response.url() });
      }
    });

    await page.goto(item.url, { waitUntil: "networkidle", timeout: 75_000 });
    await page.waitForFunction(() => document.querySelector("#status")?.textContent?.trim() === "PASS", null, { timeout: 75_000 });
    const observation = await page.evaluate(() => {
      const result = JSON.parse(document.querySelector("#result")?.textContent || "null");
      const runtimeReceipt = JSON.parse(document.querySelector("#receipt")?.textContent || "null");
      const svg = document.querySelector('#surface svg[data-atlas-stage="svg"]');
      return {
        href: location.href,
        status: document.querySelector("#status")?.textContent?.trim() || null,
        surfaceText: (document.querySelector("#surface")?.textContent || "").replace(/\s+/g, " ").trim(),
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

    assert.equal(observation.status, "PASS", `${item.id}: shell status`);
    assert.equal(observation.result?.status, "PASS", `${item.id}: result status`);
    assert.equal(observation.result?.outputs?.[0]?.contract, "a2ui-render-receipt/1", `${item.id}: output contract`);
    assert.equal(observation.runtimeReceipt?.capability?.id, "render.a2ui", `${item.id}: capability id`);
    assert.equal(observation.runtimeReceipt?.capability?.version, "1", `${item.id}: capability version`);
    for (const label of item.projection.labels) {
      assert.ok(observation.surfaceText.includes(label), `${item.id}: missing visible label ${label}`);
    }
    if (item.projection.canvas) {
      assert.ok(observation.canvas, `${item.id}: AtlasStage SVG missing`);
      assert.equal(observation.canvas.nodeCount, item.projection.nodeCount, `${item.id}: SVG node count`);
      assert.equal(observation.canvas.edgeCount, item.projection.edgeCount, `${item.id}: SVG edge count`);
      assert.ok(observation.canvas.viewBox, `${item.id}: SVG viewBox`);
    } else {
      assert.equal(observation.canvas, null, `${item.id}: unexpected Canvas`);
    }
    assert.deepEqual(browserErrors, [], `${item.id}: browser errors`);
    assert.deepEqual(failedProductResponses, [], `${item.id}: product HTTP failures`);

    const requested = new URL(item.url);
    const observed = new URL(observation.href);
    assert.equal(observed.origin, requested.origin, `${item.id}: origin changed`);
    assert.equal(observed.hash, requested.hash, `${item.id}: invocation changed`);
    assert.ok(observed.pathname.startsWith(`/releases/${input.publication.treeDigest.slice(7)}/`), `${item.id}: publication path changed`);

    await page.screenshot({ path: path.join(outputDir, `${item.id}.png`), fullPage: true });
    fs.writeFileSync(path.join(outputDir, `${item.id}.html`), await page.content());
    receipt.cases.push({
      id: item.id,
      status: "PASS",
      source: item.source,
      projection: item.projection,
      requestSha256: item.invocation.requestSha256,
      url: item.url,
      observedUrl: observation.href,
      urlLength: item.urlLength,
      urlSha256: item.urlSha256,
      capability: "render.a2ui@1",
      outputContract: "a2ui-render-receipt/1",
      browserErrors: 0,
      failedProductResponses: 0,
    });
    await page.close();
  }
} finally {
  await browser.close();
}

fs.writeFileSync(path.join(outputDir, "smoke-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
fs.writeFileSync(path.join(outputDir, "four-urls.json"), `${JSON.stringify({
  schema: "ops.jsonlOnlyFourUrls/1",
  status: "PASS",
  authority: false,
  publication: receipt.publication,
  compiler: receipt.compiler,
  urls: Object.fromEntries(receipt.cases.map(item => [item.id, item.url])),
  sources: Object.fromEntries(receipt.cases.map(item => [item.id, item.source])),
}, null, 2)}\n`);
console.log(JSON.stringify(receipt));
