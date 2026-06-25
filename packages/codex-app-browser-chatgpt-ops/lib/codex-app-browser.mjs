import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildPrFlow,
  buildSessionPrompt,
  reviewProposal,
} from "./core.mjs";

export const INIT_PROJECT_URL =
  "https://chatgpt.com/g/g-p-6a3766412df481919d39dbf3b8428dd9-init/project";

export async function runInitProjectProposalSession(input) {
  for (const key of ["title", "repository"]) {
    if (!input?.[key]) throw new Error(`${key} is required`);
  }
  const browser = await connectInAppBrowser({ browserClientPath: input.browserClientPath });
  const tab = (await browser.tabs.selected()) ?? await browser.tabs.new();
  const prompt = input.prompt ?? buildSessionPrompt({ title: input.title, task: input.task });
  const created = await createProjectSession({ tab, projectUrl: input.projectUrl ?? INIT_PROJECT_URL, prompt });
  const renamed = await renameCurrentSession({ tab, title: input.title });
  const flow = buildPrFlow({
    sessionTitle: input.title,
    sessionUrl: renamed.url,
    repository: input.repository,
    baseBranch: input.baseBranch,
    headBranch: input.headBranch,
    summary: input.summary,
    changes: input.changes,
  });
  return {
    session: { ...renamed, createdTitle: created.title },
    pullRequest: flow,
    review: reviewProposal({
      title: flow.title,
      body: flow.body,
      baseBranch: flow.baseBranch,
      headBranch: flow.headBranch,
      sessionTitle: input.title,
    }),
  };
}

export async function connectInAppBrowser({ browserClientPath, browserId = "iab" } = {}) {
  if (!globalThis.agent) {
    throw new Error("Codex browser agent is unavailable; run inside the Codex browser execution context.");
  }
  if (!globalThis.browser) {
    const { setupBrowserRuntime } = await import(pathToFileUrl(browserClientPath ?? resolveBrowserClientPath()));
    await setupBrowserRuntime({ globals: globalThis });
    globalThis.browser = await globalThis.agent.browsers.get(browserId);
  }
  return globalThis.browser;
}

export async function createProjectSession({ tab, projectUrl = INIT_PROJECT_URL, prompt, waitMs = 5000 }) {
  if ((await tab.url()) !== projectUrl) {
    await tab.goto(projectUrl);
    await tab.playwright.waitForLoadState({ state: "domcontentloaded", timeoutMs: 30000 });
  }
  const before = await listProjectLinks(tab, projectUrl);
  const box = await unique(tab.playwright.getByRole("textbox", { name: "New chat in init" }), "new chat textbox");
  await box.fill(prompt, { timeoutMs: 10000 });
  await box.press("Enter", { timeoutMs: 10000 });
  await tab.playwright.waitForTimeout(waitMs);
  const after = await listProjectLinks(tab, projectUrl);
  const beforeHrefs = new Set(before.map((link) => link.href));
  const currentPath = new URL(await tab.url()).pathname;
  const created = after.find((link) => link.href === currentPath) ?? after.find((link) => !beforeHrefs.has(link.href)) ?? after[0];
  if (!created) throw new Error("created session link was not detected");
  return { title: created.text, url: new URL(created.href, "https://chatgpt.com").toString() };
}

export async function renameCurrentSession({ tab, title }) {
  const currentPath = new URL(await tab.url()).pathname;
  const box = await tab.playwright.evaluate((pathname) => {
    const link = Array.from(document.querySelectorAll("a")).find((candidate) => {
      const href = candidate.getAttribute("href") ?? "";
      return href === pathname || candidate.href.endsWith(pathname);
    });
    if (!link) return null;
    const rect = link.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }, currentPath, { timeoutMs: 10000 });
  if (!box) throw new Error("current session link was not visible in the sidebar");
  await tab.cua.double_click({
    x: Math.round(box.x + Math.min(150, Math.max(20, box.width / 2))),
    y: Math.round(box.y + box.height / 2),
  });
  await tab.playwright.waitForTimeout(500);
  const editor = await unique(tab.playwright.getByLabel("Chat title", { exact: true }), "chat title editor");
  await editor.fill(title, { timeoutMs: 10000 });
  await editor.press("Enter", { timeoutMs: 10000 });
  await tab.playwright.waitForTimeout(1500);
  const visible = await tab.playwright.evaluate((needle) => document.body?.innerText?.includes(needle) ?? false, title, { timeoutMs: 10000 });
  if (!visible) throw new Error(`renamed title was not visible: ${title}`);
  return { title, url: await tab.url() };
}

export async function listProjectLinks(tab, projectUrl = INIT_PROJECT_URL) {
  const prefix = new URL(projectUrl).pathname.replace(/\/project$/, "");
  return tab.playwright.evaluate((projectPrefix) => Array.from(document.querySelectorAll("a"))
    .map((link) => ({ href: link.getAttribute("href") ?? "", text: link.textContent?.trim() ?? "" }))
    .filter((link) => link.href.startsWith(`${projectPrefix}/c/`) || link.href.startsWith(`${projectPrefix.replace("-init", "")}/c/`)), prefix, { timeoutMs: 10000 });
}

export function resolveBrowserClientPath() {
  const root = path.join(os.homedir(), ".codex", "plugins", "cache", "openai-bundled", "browser");
  const candidates = fs.readdirSync(root)
    .map((entry) => path.join(root, entry, "scripts", "browser-client.mjs"))
    .filter((candidate) => fs.existsSync(candidate))
    .sort();
  const latest = candidates.at(-1);
  if (!latest) throw new Error(`browser-client.mjs was not found under ${root}`);
  return latest;
}

async function unique(locator, label) {
  const count = await locator.count();
  if (count !== 1) throw new Error(`${label} expected 1 element, got ${count}`);
  return locator;
}

function pathToFileUrl(filePath) {
  return `file:///${path.resolve(filePath).replace(/\\/g, "/").replace(/^\/+/, "")}`;
}
