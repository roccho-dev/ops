// Codex functions.exec body, loaded through AsyncFunction(inputPath, tools).
// Input: {schemaVersion:1,batchId,projectId?,messages:[{requestId,threadId,text}]}.
// The caller supplies only an absolute JSON path. Never emit JSON or thread bodies.

const fail = (code) => ({ status: "failed", code });
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const parseToolJson = (result) => {
  if (result?.isError) return null;
  const block = result?.content?.find((item) => item.type === "text");
  if (!block || typeof block.text !== "string") return null;
  try { return JSON.parse(block.text); } catch { return null; }
};

if (typeof inputPath !== "string" || !/^[a-zA-Z]:[\\/][^\r\n\0]+\.json$/i.test(inputPath)) {
  return fail("invalid-input-path");
}

const escapedPath = inputPath.replace(/'/g, "''");
const file = await tools.exec_command({
  cmd: `Get-Content -LiteralPath '${escapedPath}' -Raw -Encoding utf8`,
  max_output_tokens: 30000,
});
if (file.exit_code !== 0 || typeof file.output !== "string") return fail("input-unreadable");

let job;
try { job = JSON.parse(file.output); } catch { return fail("invalid-json"); }
if (!isRecord(job) || job.schemaVersion !== 1 ||
    typeof job.batchId !== "string" || !/^[A-Za-z0-9._-]{1,80}$/.test(job.batchId) ||
    !Array.isArray(job.messages) || job.messages.length < 1 || job.messages.length > 20 ||
    (job.projectId !== undefined && (typeof job.projectId !== "string" || !job.projectId)) ||
    job.messages.some((message) => !isRecord(message) ||
      typeof message.requestId !== "string" || !/^[A-Za-z0-9._-]{1,80}$/.test(message.requestId) ||
      typeof message.threadId !== "string" || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(message.threadId) ||
      typeof message.text !== "string" || message.text.length < 1 || message.text.length > 4000) ||
    new Set(job.messages.map((message) => message.requestId)).size !== job.messages.length ||
    new Set(job.messages.map((message) => message.threadId)).size !== job.messages.length) {
  return fail("schema-invalid");
}

// An optional projectId is a strict guard. Unlisted targets are not guessed.
if (job.projectId !== undefined) {
  const listed = parseToolJson(await tools.mcp__codex_app__list_threads({ limit: 50 }));
  if (!listed || !Array.isArray(listed.threads)) return fail("project-check-unavailable");
  const entries = [...(listed.pinnedThreads || []), ...listed.threads];
  for (const message of job.messages) {
    const target = entries.find((entry) => entry.id === message.threadId);
    if (!target || target.kind !== "chatgpt" || target.projectId !== job.projectId) {
      return fail("project-membership-unverified");
    }
  }
}

const markerFor = (message) => `[dispatch:${job.batchId}:${message.requestId}]`;
const promptFor = (message) => `${message.text}\n${markerFor(message)}`;

async function inspect(message) {
  let cursor;
  let exact = 0;
  let marker = 0;
  for (let page = 0; page < 100; page++) {
    const options = { threadId: message.threadId, turnLimit: 5, maxOutputCharsPerItem: 5000 };
    if (cursor) options.cursor = cursor;
    const data = parseToolJson(await tools.mcp__codex_app__read_thread(options));
    if (!data || data.thread?.kind !== "chatgpt" || !Array.isArray(data.turns)) {
      return { status: "history-unavailable" };
    }
    const expected = promptFor(message);
    const mark = markerFor(message);
    for (const turn of data.turns) {
      for (const item of turn.items || []) {
        if (item.type !== "userMessage") continue;
        for (const part of item.content || []) {
          if (part.type !== "text" || typeof part.text !== "string") continue;
          if (part.text.includes(mark)) marker++;
          if (part.text === expected) exact++;
        }
      }
    }
    if (!data.page?.hasMore) {
      if (exact === 1 && marker === 1) return { status: "confirmed" };
      if (marker > 0) return { status: "marker-conflict" };
      return { status: "absent" };
    }
    cursor = data.page.nextCursor;
    if (typeof cursor !== "string" || !cursor) return { status: "history-unavailable" };
  }
  return { status: "history-limit" };
}

// Every preflight must be conclusive before any message is sent.
const before = await Promise.all(job.messages.map(inspect));
if (before.some((result) => !["confirmed", "absent"].includes(result.status))) {
  return {
    status: "not-sent",
    batchId: job.batchId,
    results: job.messages.map((message, index) => ({ requestId: message.requestId, status: before[index].status })),
  };
}

const pending = job.messages.filter((_, index) => before[index].status === "absent");
// A history read can lag behind an accepted send. Reserve each request on disk
// before sending, so a later invocation never treats that lag as permission to retry.
async function reserve(message) {
  const command = `$base=$env:LOCALAPPDATA; if ([string]::IsNullOrWhiteSpace($base)) { 'error' } else { $directory=Join-Path $base 'Codex/chatgpt-thread-batch-dispatch/attempts'; $target=Join-Path $directory '${job.batchId}--${message.requestId}.attempt'; try { [System.IO.Directory]::CreateDirectory($directory) | Out-Null; $stream=[System.IO.File]::Open($target,[System.IO.FileMode]::CreateNew,[System.IO.FileAccess]::Write,[System.IO.FileShare]::None); $stream.Dispose(); 'claimed' } catch [System.IO.IOException] { if ([System.IO.File]::Exists($target)) { 'exists' } else { 'error' } } catch { 'error' } }`;
  const result = await tools.exec_command({ cmd: command, max_output_tokens: 100 });
  return result.exit_code === 0 ? result.output.trim() : "error";
}
const claims = await Promise.all(pending.map(reserve));
const claimed = pending.filter((_, index) => claims[index] === "claimed");
const sent = await Promise.allSettled(claimed.map((message) =>
  tools.mcp__codex_app__send_message_to_thread({ threadId: message.threadId, prompt: promptFor(message) })
));
const sendStatus = new Map(claimed.map((message, index) => [
  message.requestId,
  sent[index].status === "fulfilled" &&
    parseToolJson(sent[index].value)?.threadId === message.threadId ? "accepted" : "unknown",
]));

const after = new Map();
for (let attempt = 0; attempt < 3; attempt++) {
  const checks = await Promise.all(pending.map(inspect));
  pending.forEach((message, index) => after.set(message.requestId, checks[index].status));
  if (checks.every((check) => check.status === "confirmed")) break;
  if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1500));
}

const results = job.messages.map((message, index) => ({
    requestId: message.requestId,
    status: before[index].status === "confirmed" ? "already-confirmed" :
      after.get(message.requestId) === "confirmed" ? "sent-confirmed" :
      claims[pending.findIndex((item) => item.requestId === message.requestId)] === "exists" ? "prior-attempt-unconfirmed" :
      claims[pending.findIndex((item) => item.requestId === message.requestId)] === "error" ? "reservation-failed" :
      sendStatus.get(message.requestId) === "accepted" ? "accepted-unconfirmed" : "unknown-no-retry",
  }));
return {
  status: results.every((result) => ["already-confirmed", "sent-confirmed"].includes(result.status)) ?
    "confirmed" : "pending-confirmation",
  batchId: job.batchId,
  results,
};
