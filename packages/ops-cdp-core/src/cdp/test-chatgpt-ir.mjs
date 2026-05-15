import * as std from "qjs:std";

import {
  CHATGPT_DOWNLOAD_IR_SCHEMA,
  CHATGPT_INVENTORY_IR_SCHEMA,
  CHATGPT_SEARCH_IR_SCHEMA,
  CHATGPT_THREAD_IR_SCHEMA,
  CHATGPT_THREADS_IR_SCHEMA,
  isFreshIr,
  materializeDownloadResolveIr,
  materializeInventoryIr,
  materializeSearchIr,
  materializeThreadIr,
  materializeThreadsIndexIr,
  projectDownloadResolveFromIr,
  projectInventoryFromIr,
  projectReadThreadResultFromIr,
  projectSearchResultFromIr,
  projectThreadsIndexFromIr,
} from "./chatgpt/ir.mjs";
import { DOWNLOAD_POLICY, buildDownloadFetchPolicy, buildDownloadResolvePolicy } from "./chatgpt/policies/download.mjs";
import { rankSessions } from "./session-flow.mjs";

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

function assertEq(actual, expected, msg) {
  assert(actual === expected, `${msg} (expected=${JSON.stringify(expected)}, actual=${JSON.stringify(actual)})`);
}

const threadDoc = materializeThreadIr({
  captured_at: "2026-04-05T00:00:00.000Z",
  url: "https://chatgpt.com/c/11111111-2222-3333-4444-555555555555",
  title: "Example thread",
  source: { kind: "cdp-live", addr: "127.0.0.1", port: 9222, target_id: "page-1" },
  visible_messages: [
    { idx: 0, role: "user", text: "hello" },
    { idx: 1, role: "assistant", text: "world" },
  ],
  artifacts: [
    {
      name: "report.zip",
      locator: { kind: "chip", label: "report.zip", href: "", match: "button" },
      download: { method: "chip_click", filename_expected: "report.zip" },
    },
  ],
  final_result: {
    href: "https://chatgpt.com/c/11111111-2222-3333-4444-555555555555",
    title: "Example thread",
    readyState: "complete",
    msgCount: 2,
    hasPrompt: true,
    isStreaming: false,
    stableRounds: 2,
    hits: [],
    last: [{ idx: 1, role: "assistant", preview: "world", textLen: 5 }],
  },
  stats: {
    ir_hit: false,
    cdp: { list_count: 0, call_count: 1, evaluate_count: 3, navigate_count: 0 },
  },
});

assertEq(threadDoc.schema, CHATGPT_THREAD_IR_SCHEMA, "thread IR schema is canonical");
assertEq(threadDoc.thread.id, "11111111-2222-3333-4444-555555555555", "thread id comes from URL");
assertEq(threadDoc.thread.title, "Example thread", "thread title is preserved");
assert(!Object.prototype.hasOwnProperty.call(threadDoc, "conversation"), "legacy conversation alias is removed");
assert(Array.isArray(threadDoc.thread.artifacts) && threadDoc.thread.artifacts.length === 1, "thread artifacts are canonical");
assert(Array.isArray(threadDoc._cdp.visible_messages) && threadDoc._cdp.visible_messages.length === 2, "visible messages are stored in sidecar");
assertEq(threadDoc._cdp.read_thread.msgCount, 2, "read_thread sidecar is preserved");

const projectedThread = projectReadThreadResultFromIr(threadDoc);
assertEq(projectedThread.href, threadDoc._cdp.read_thread.href, "read-thread projection preserves href");
assertEq(projectedThread.msgCount, 2, "read-thread projection preserves msgCount");
assert(projectedThread.artifacts.length === 1, "read-thread projection exposes artifacts");

const downloadFromThread = projectDownloadResolveFromIr(threadDoc);
assertEq(downloadFromThread.targets.length, 1, "download projection can use thread artifacts");
assertEq(downloadFromThread.targets[0].name, "report.zip", "download projection preserves artifact name");

const downloadDoc = materializeDownloadResolveIr({
  captured_at: "2026-04-05T00:00:00.000Z",
  url: threadDoc._cdp.read_thread.href,
  projectUrl: "https://chatgpt.com/g/g-p-abc/project",
  sourceUrl: threadDoc._cdp.read_thread.href,
  needle: "report",
  targets: [
    { name: "report.zip", locator: { kind: "sandbox_link", href: "sandbox:/mnt/data/report.zip" } },
  ],
});
assertEq(downloadDoc.schema, CHATGPT_DOWNLOAD_IR_SCHEMA, "download IR schema is set");
const projectedDownload = projectDownloadResolveFromIr(downloadDoc);
assertEq(projectedDownload.targets.length, 1, "download projection preserves targets");
assertEq(projectedDownload.targets[0].locator.kind, "sandbox_link", "download projection preserves locator kind");

const searchDoc = materializeSearchIr({
  captured_at: "2026-04-05T00:00:00.000Z",
  query: "canon",
  source: { target_id: "page-1" },
  results: [{ title: "Result", href: threadDoc._cdp.read_thread.href }],
});
assertEq(searchDoc.schema, CHATGPT_SEARCH_IR_SCHEMA, "search IR schema is set");
const projectedSearch = projectSearchResultFromIr(searchDoc);
assertEq(projectedSearch.query, "canon", "search projection preserves query");
assertEq(projectedSearch.results[0].conversation_id, threadDoc.thread.id, "search projection preserves conversation id");

const inventoryDoc = materializeInventoryIr({
  captured_at: "2026-04-05T00:00:00.000Z",
  addr: "127.0.0.1",
  port: 9222,
  projects: [{ name: "P", url: "https://chatgpt.com/g/g-p-proj/project" }],
  unprojected_threads: [{ title: "Loose", url: threadDoc._cdp.read_thread.href }],
  projected_threads: {
    proj: [{ title: "Projected", url: "https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }],
  },
});
assertEq(inventoryDoc.schema, CHATGPT_INVENTORY_IR_SCHEMA, "inventory IR schema is set");
const projectedInventory = projectInventoryFromIr(inventoryDoc);
assertEq(projectedInventory.projects.length, 1, "inventory projection preserves projects");
assertEq(projectedInventory.unprojected_threads.length, 1, "inventory projection preserves unprojected threads");

const threadsDoc = materializeThreadsIndexIr({
  captured_at: "2026-04-05T00:00:00.000Z",
  threads: [{ title: "T", url: threadDoc._cdp.read_thread.href }],
});
assertEq(threadsDoc.schema, CHATGPT_THREADS_IR_SCHEMA, "threads index IR schema is set");
assertEq(projectThreadsIndexFromIr(threadsDoc).items.length, 1, "threads index projection preserves items");

assert(isFreshIr(threadDoc, { maxAgeSec: 60, nowMs: Date.parse("2026-04-05T00:00:30.000Z") }), "fresh IR within TTL");
assert(!isFreshIr(threadDoc, { maxAgeSec: 10, nowMs: Date.parse("2026-04-05T00:00:30.000Z") }), "stale IR outside TTL");

const resolvePolicy = buildDownloadResolvePolicy({ waitForMaterialize: true, materializePollMs: 1, maxAttempts: 0 });
assert(resolvePolicy.allowMaterializePolling === true, "resolve policy opt-in enables materialize polling");
assert(resolvePolicy.materializePollMs >= 15000, "resolve policy enforces minimum materialize poll interval");
assert(resolvePolicy.maxAttempts >= 1, "resolve policy enforces minimum attempts");
const fetchPolicy = buildDownloadFetchPolicy({ pollMs: 1, afterClickMs: -1 });
assert(fetchPolicy.filePollMs >= 50, "fetch policy enforces minimum file poll interval");
assert(fetchPolicy.afterClickMs >= 0, "fetch policy enforces non-negative after-click delay");
assert(DOWNLOAD_POLICY.resolve.maxAttempts >= 1, "default download policy is usable");

const ranked = rankSessions([
  { port: 9223, attachablePageCount: 1, app: { status: "login-required" } },
  { port: 9222, attachablePageCount: 1, app: { status: "logged-in" } },
]);
assertEq(ranked[0].port, 9222, "session ranking prefers logged-in sessions");
assert(ranked[0].recommended === true && ranked[1].recommended === false, "session ranking marks exactly the top row as recommended");

std.out.puts(`Passed: ${passed}\n`);
std.out.puts(`Failed: ${failed}\n`);

if (failed > 0) std.exit(1);
