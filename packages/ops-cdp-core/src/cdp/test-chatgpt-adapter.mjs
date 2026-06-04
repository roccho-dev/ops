import * as std from "./qjs-compat/std.mjs";

import * as adapter from "./domain/chatgpt/index.mjs";
import { clickSandboxLinkExpr, listDownloadArtifactsExpr, locateDownloadArtifactExpr, locateFileChipExpr } from "./domain/chatgpt/artifacts.mjs";
import { keyTap, mouseClick, scrollToBottomExpr } from "./domain/chatgpt/input.mjs";
import { getChatGptPageState, navigateChatGptTarget } from "./domain/chatgpt/navigation.mjs";
import { pickProjectSourcesTarget, projectSourcesUrl, waitForProjectSourceVisibleExpr, waitForProjectSourcesUrlExpr } from "./domain/chatgpt/project-sources.mjs";
import { probeChatGptTarget } from "./domain/chatgpt/session.mjs";
import { openOrCreateChatGptTarget, requireChatGptTarget, shouldReuseAnyChatGptTarget } from "./domain/chatgpt/target.mjs";
import {
  CHATGPT_BASE,
  CONV_ID_RE,
  PROJECT_ID_RE,
  SELECTORS,
  extractConversationId,
  extractProjectId,
  listPageTargets,
  pickTargetByUrl,
  previewTargets,
} from "./domain/chatgpt/shared.mjs";

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
    std.out.puts(`PASS: ${msg}\n`);
  } else {
    failed++;
    std.out.puts(`FAIL: ${msg}\n`);
  }
}

const expected = {
  CHATGPT_BASE,
  CONV_ID_RE,
  PROJECT_ID_RE,
  SELECTORS,
  extractConversationId,
  extractProjectId,
  listPageTargets,
  previewTargets,
  pickTargetByUrl,
  getChatGptPageState,
  navigateChatGptTarget,
  probeChatGptTarget,
  requireChatGptTarget,
  openOrCreateChatGptTarget,
  mouseClick,
  keyTap,
  scrollToBottomExpr,
  locateFileChipExpr,
  locateDownloadArtifactExpr,
  clickSandboxLinkExpr,
  listDownloadArtifactsExpr,
  projectSourcesUrl,
  pickProjectSourcesTarget,
  waitForProjectSourcesUrlExpr,
  waitForProjectSourceVisibleExpr,
};

for (const [name, value] of Object.entries(expected)) {
  assert(Object.prototype.hasOwnProperty.call(adapter, name), `canonical adapter exports ${name}`);
  assert(adapter[name] === value, `canonical adapter ${name} is wired to responsibility module`);
}

assert(
  String(adapter.extractConversationId("https://chatgpt.com/c/1234-5678")).length > 0,
  "extractConversationId still works",
);
assert(
  String(adapter.extractProjectId("https://chatgpt.com/g/g-p-abc/project")).length > 0,
  "extractProjectId still works",
);
assert(
  adapter.listPageTargets([{ type: "page", webSocketDebuggerUrl: "ws://x" }, { type: "worker" }]).length === 1,
  "listPageTargets filters attachable pages",
);
assert(
  shouldReuseAnyChatGptTarget("https://chatgpt.com/") === true,
  "open/create may reuse any ChatGPT tab only for the base page",
);
assert(
  shouldReuseAnyChatGptTarget("https://chatgpt.com/c/11111111-2222-3333-4444-555555555555") === false,
  "open/create must not reuse an arbitrary tab for a specific conversation URL",
);

std.out.puts(`Passed: ${passed}\n`);
std.out.puts(`Failed: ${failed}\n`);

if (failed > 0) std.exit(1);
