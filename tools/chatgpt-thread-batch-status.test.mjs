import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Contract fixed before implementation: status is per exact dispatch request,
// never a claim that the whole chat is idle or safe for another send.
const source = await readFile(new URL('./chatgpt-thread-batch-status.js', import.meta.url), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const run = new AsyncFunction('inputPath', 'tools', source);
const threadId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const job = {
  schemaVersion: 1,
  batchId: 'status-test',
  messages: [{ requestId: 'A', threadId, text: 'private request body' }],
};
const prompt = `${job.messages[0].text}\n[dispatch:${job.batchId}:A]`;
const user = (text) => ({ type: 'userMessage', content: [{ type: 'text', text }] });
const agent = { type: 'agentMessage', text: 'private response body' };
const turn = (status, items, error = null) => ({ id: 'turn-1', status, error, items });
const page = (turns, hasMore = false, nextCursor = null, kind = 'chatgpt', id = threadId) => ({
  thread: { id, kind }, turns, page: { hasMore, nextCursor },
});

async function scenario(name, pages, expected) {
  const reads = [];
  const fakeTools = {
    exec_command: async () => ({ exit_code: 0, output: JSON.stringify(job) }),
    mcp__codex_app__read_thread: async ({ cursor }) => {
      reads.push(cursor || 'first');
      const next = pages[reads.length - 1];
      return next === 'error' ? { isError: true, content: [] } :
        { content: [{ type: 'text', text: JSON.stringify(next) }] };
    },
    // Deliberately no mutation tool: a read-only status implementation cannot send.
  };
  const result = await run('C:/status-test.json', fakeTools);
  assert.equal(result.results?.[0]?.state, expected, name);
  const visible = JSON.stringify(result);
  assert.ok(!visible.includes('private request body'), `${name}: request leaked`);
  assert.ok(!visible.includes('private response body'), `${name}: response leaked`);
  assert.ok(!visible.includes(threadId), `${name}: thread ID leaked`);
}

await scenario('exact completed turn', [page([turn('completed', [user(prompt), agent])])], 'RESPONSE_COMPLETED');
await scenario('exact running turn', [page([turn('in_progress', [user(prompt)])])], 'SENT_REFLECTED');
await scenario('completed without assistant item', [page([turn('completed', [user(prompt)])])], 'SENT_REFLECTED');
await scenario('completed with empty assistant item', [page([turn('completed', [user(prompt), { type: 'agentMessage', text: '' }])])], 'SENT_REFLECTED');
await scenario('completed with provider error', [page([turn('completed', [user(prompt), agent], { code: 'failed' })])], 'SENT_REFLECTED');
await scenario('two users in same turn', [page([turn('completed', [user(prompt), user('other'), agent])])], 'UNCONFIRMED');
await scenario('absent request', [page([])], 'UNCONFIRMED');
await scenario('unrelated completed turn', [page([turn('completed', [user('other'), agent])])], 'UNCONFIRMED');
await scenario('same marker but changed body', [page([turn('completed', [user('changed\n[dispatch:status-test:A]'), agent])])], 'UNCONFIRMED');
await scenario('duplicate exact request', [page([turn('completed', [user(prompt), agent]), turn('completed', [user(prompt), agent])])], 'UNCONFIRMED');
await scenario('missing later page', [page([turn('completed', [user(prompt), agent])], true, 'next'), 'error'], 'UNCONFIRMED');
await scenario('wrong thread kind', [page([turn('completed', [user(prompt), agent])], false, null, 'codex')], 'UNCONFIRMED');
await scenario('wrong thread identity', [page([turn('completed', [user(prompt), agent])], false, null, 'chatgpt', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')], 'UNCONFIRMED');
await scenario('match on older page', [page([turn('completed', [user('other'), agent])], true, 'next'), page([turn('completed', [user(prompt), agent])])], 'RESPONSE_COMPLETED');

console.log('14 status contract scenarios passed');
