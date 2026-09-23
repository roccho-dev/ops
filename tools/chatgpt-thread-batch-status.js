// Read-only Codex functions.exec body: AsyncFunction(inputPath, tools).
// Accepts the dispatcher's JSON, returns only per-request state and reason.
const unknown = (reason) => ({ state: 'UNCONFIRMED', reason });
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const toolJson = (result) => {
  if (result?.isError) return null;
  const item = result?.content?.find((entry) => entry.type === 'text');
  try { return item && JSON.parse(item.text); } catch { return null; }
};

if (typeof inputPath !== 'string' || !/^[a-zA-Z]:[\\/][^\r\n\0]+\.json$/i.test(inputPath)) {
  return { status: 'failed', code: 'invalid-input-path' };
}
const escapedPath = inputPath.replace(/'/g, "''");
const file = await tools.exec_command({
  cmd: `Get-Content -LiteralPath '${escapedPath}' -Raw -Encoding utf8`,
  max_output_tokens: 30000,
});
if (file.exit_code !== 0 || typeof file.output !== 'string') {
  return { status: 'failed', code: 'input-unreadable' };
}
let job;
try { job = JSON.parse(file.output); } catch { return { status: 'failed', code: 'invalid-json' }; }
if (!record(job) || job.schemaVersion !== 1 ||
    typeof job.batchId !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(job.batchId) ||
    !Array.isArray(job.messages) || job.messages.length < 1 || job.messages.length > 20 ||
    (job.projectId !== undefined && (typeof job.projectId !== 'string' || !job.projectId)) ||
    job.messages.some((message) => !record(message) ||
      typeof message.requestId !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(message.requestId) ||
      typeof message.threadId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(message.threadId) ||
      typeof message.text !== 'string' || message.text.length < 1 || message.text.length > 4000) ||
    new Set(job.messages.map((message) => message.requestId)).size !== job.messages.length ||
    new Set(job.messages.map((message) => message.threadId)).size !== job.messages.length) {
  return { status: 'failed', code: 'schema-invalid' };
}

let membership;
if (job.projectId !== undefined) {
  const listed = toolJson(await tools.mcp__codex_app__list_threads({ limit: 50 }));
  if (!listed || !Array.isArray(listed.threads)) {
    return { status: 'observed', batchId: job.batchId,
      results: job.messages.map((message) => ({ requestId: message.requestId, ...unknown('project-check-unavailable') })) };
  }
  membership = new Map([...(listed.pinnedThreads || []), ...listed.threads].map((entry) => [entry.id, entry]));
}

async function inspect(message) {
  if (membership) {
    const target = membership.get(message.threadId);
    if (!target || target.kind !== 'chatgpt' || target.projectId !== job.projectId) {
      return unknown('project-membership-unverified');
    }
  }
  const marker = `[dispatch:${job.batchId}:${message.requestId}]`;
  const expected = `${message.text}\n${marker}`;
  let cursor;
  const cursors = new Set();
  let markerCount = 0;
  let exactCount = 0;
  let matchedTurn;

  for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
    const options = { threadId: message.threadId, turnLimit: 5, maxOutputCharsPerItem: 5000 };
    if (cursor) options.cursor = cursor;
    const data = toolJson(await tools.mcp__codex_app__read_thread(options));
    if (!data || data.thread?.id !== message.threadId || data.thread?.kind !== 'chatgpt' ||
        !Array.isArray(data.turns) || typeof data.page?.hasMore !== 'boolean') return unknown('history-unavailable');
    for (const turn of data.turns) {
      if (!record(turn) || !Array.isArray(turn.items)) return unknown('history-malformed');
      for (const item of turn.items) {
        if (item.type !== 'userMessage') continue;
        if (!Array.isArray(item.content)) return unknown('history-malformed');
        for (const part of item.content) {
          if (part.type !== 'text' || typeof part.text !== 'string') continue;
          if (part.text.includes(marker)) markerCount++;
          if (part.text === expected) { exactCount++; matchedTurn = turn; }
        }
      }
    }
    if (!data.page.hasMore) {
      if (markerCount > 1 || exactCount > 1 || markerCount !== exactCount) return unknown('marker-conflict');
      if (exactCount === 0) return unknown('not-reflected');
      if (matchedTurn.items.filter((item) => item.type === 'userMessage').length !== 1) return unknown('ambiguous-turn');
      const response = matchedTurn.status === 'completed' && matchedTurn.error == null && matchedTurn.items.some((item) =>
        item.type === 'agentMessage' && typeof item.text === 'string' && item.text.trim().length > 0);
      return { state: response ? 'RESPONSE_COMPLETED' : 'SENT_REFLECTED' };
    }
    cursor = data.page.nextCursor;
    if (typeof cursor !== 'string' || !cursor || cursors.has(cursor)) return unknown('pagination-unavailable');
    cursors.add(cursor);
  }
  return unknown('history-limit');
}

const results = await Promise.all(job.messages.map(async (message) => ({
  requestId: message.requestId,
  ...await inspect(message),
})));
return { status: 'observed', batchId: job.batchId, results };
