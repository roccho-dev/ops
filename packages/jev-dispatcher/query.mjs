#!/usr/bin/env node
// Advisory query only. The selected job owns disclosure and caller permissions.
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, openSync, fstatSync, closeSync, constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { select } from './policy-select.mjs';
import { askJevNoul, askJevChoice, askJevScore } from '../jev/src/client.mjs';

const ownFile = fileURLToPath(import.meta.url);
const hex40 = /^[0-9a-f]{40}$/;
const hex64 = /^[0-9a-f]{64}$/;
const token = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' && v.trim().length > 0;
export const digest = (v) => createHash('sha256').update(typeof v === 'string' || v instanceof Uint8Array ? v : JSON.stringify(v)).digest('hex');
const requireThat = (ok, code) => { if (!ok) throw Object.assign(new Error(code), { code }); };
const exactKeys = (o, required, optional = []) => object(o) && required.every(k => Object.hasOwn(o, k)) &&
  Object.keys(o).every(k => [...required, ...optional].includes(k));
export const implementationDigest = () => digest([
  ownFile, new URL('./policy-select.mjs', import.meta.url), new URL('../jev/src/client.mjs', import.meta.url),
].map(p => digest(readFileSync(p))));

export function validateRequest(request) {
  requireThat(exactKeys(request, ['id', 'type', 'question'], ['criteria']), 'INPUT_INVALID');
  requireThat(typeof request.id === 'string' && token.test(request.id) && text(request.question), 'INPUT_INVALID');
  requireThat(['noul', 'choice', 'score'].includes(request.type), 'INPUT_INVALID');
  if (request.type === 'noul') requireThat(!Object.hasOwn(request, 'criteria'), 'INPUT_INVALID');
  if (request.type === 'choice') {
    requireThat(object(request.criteria), 'INPUT_INVALID');
    const entries = Object.entries(request.criteria);
    requireThat(entries.length >= 2 && entries.length <= 255 && entries.every(([k, v]) =>
      token.test(k) && !['__proto__', 'constructor', 'prototype'].includes(k) && text(v)), 'INPUT_INVALID');
  }
  if (request.type === 'score') requireThat(Array.isArray(request.criteria) && request.criteria.length >= 2 &&
    request.criteria.length <= 10 && request.criteria.every(text), 'INPUT_INVALID');
  return request;
}

// Only an explicit final-text protocol is parsed, never a substring or a tool result.
// The adapter must obtain sender/source_record from an audited provider record, not the JSON payload.
export function parseQueryMessage(finalText) {
  if (typeof finalText !== 'string' || Buffer.byteLength(finalText) > 65536) return null;
  if (!finalText.startsWith('D-QUERY: ')) return null;
  requireThat(!finalText.trimEnd().includes('\n') && !finalText.includes('\r'), 'MESSAGE_INVALID');
  let request;
  try { request = JSON.parse(finalText.slice(9)); } catch { throw Object.assign(new Error('MESSAGE_INVALID'), { code: 'MESSAGE_INVALID' }); }
  return validateRequest(request);
}

// Uses the existing exact Git selector. There is no fallback policy, candidate generator or authority flag on stdin.
export function prepareContext({ selection, contractId, version, sender, observation, sourceRecord, now = Date.now() }) {
  requireThat(selection && hex40.test(selection.commit) && hex40.test(selection.tree), 'POLICY_INVALID');
  requireThat(Array.isArray(selection.selected) && selection.selected.every(r => text(r.body) && r.body_sha256 === digest(r.body)), 'POLICY_INVALID');
  const rows = selection.selected.map(r => ({ ...r, value: JSON.parse(r.body) }));
  const jobs = rows.filter(r => r.id === contractId && r.value.state === 'active' && r.value.version === version &&
    r.value.rel?.kind === 'details' && r.value.rel?.parent === selection.r_id);
  requireThat(jobs.length === 1, 'JOB_INVALID');
  const job = jobs[0].value;
  const q = job.query;
  requireThat(object(q) && q.enabled === true && q.mode === 'advisory', 'QUERY_NOT_ENABLED');
  requireThat(job.r_id === selection.r_id && [job.r_id, job.w_id].includes(sender), 'SENDER_INVALID');
  if (sender === job.w_id) requireThat(rows.some(r => r.id === sender && r.value.state === 'active' &&
    r.value.role === 'w' && r.value.rel?.kind === 'delegates' && r.value.rel?.parent === job.r_id), 'SENDER_INVALID');
  requireThat(Array.isArray(q.senders) && q.senders.includes(sender), 'SENDER_NOT_ALLOWED');
  requireThat(q.disclosure === 'selected-rules-and-observation' && Array.isArray(q.rule_ids) &&
    q.rule_ids.length > 0 && new Set(q.rule_ids).size === q.rule_ids.length, 'DISCLOSURE_NOT_DECLARED');
  requireThat(Number.isSafeInteger(q.timeout_ms) && q.timeout_ms > 0 && q.timeout_ms <= 120000 &&
    Number.isSafeInteger(q.max_input_bytes) && q.max_input_bytes > 0 && q.max_input_bytes <= 1048576 &&
    q.max_calls === 1 && text(q.expected_model), 'QUERY_LIMITS_INVALID');
  requireThat(typeof sourceRecord === 'string' && token.test(sourceRecord), 'SOURCE_RECORD_INVALID');
  requireThat(exactKeys(observation, ['job', 'state_version', 'text', 'refs', 'expires_at']), 'OBSERVATION_INVALID');
  requireThat(observation.job === job.id && text(observation.state_version) && text(observation.text) &&
    Array.isArray(observation.refs) && observation.refs.length > 0 && observation.refs.every(text) &&
    Number.isSafeInteger(observation.expires_at), 'OBSERVATION_INVALID');
  requireThat(Number.isSafeInteger(now) && observation.expires_at > now, 'OBSERVATION_EXPIRED');
  const rules = q.rule_ids.map(id => {
    const row = rows.find(r => r.id === id && r.value.state === 'active');
    requireThat(row && text(row.value.rule), 'RULE_UNAVAILABLE');
    return { id, rule: row.value.rule, sha256: row.body_sha256 };
  });
  return {
    job: job.id, contract_version: version, sender, source_record: sourceRecord,
    policy_commit: selection.commit, policy_tree: selection.tree,
    policy_sha256: digest([jobs[0].body_sha256, rules]),
    state_version: observation.state_version, observation_sha256: digest(observation),
    observation, rules, limits: { timeout_ms: q.timeout_ms, max_input_bytes: q.max_input_bytes },
    expected_model: q.expected_model, implementation_sha256: implementationDigest(),
  };
}

const errorCode = e => ({
  auth_missing: 'AUTH_MISSING', provider_error: 'PROVIDER_ERROR', provider_unreachable: 'PROVIDER_ERROR',
  provider_invalid_response: 'PROVIDER_ERROR', input_invalid: 'INPUT_INVALID',
}[e?.code] || (e?.name === 'JevContractError' ? 'RESPONSE_INVALID' :
  ['TIMEOUT', 'RESPONSE_TOO_LARGE', 'MODEL_CHANGED', 'OBSERVATION_EXPIRED', 'INPUT_TOO_LARGE', 'INPUT_INVALID'].includes(e?.code) ? e.code : 'QUERY_ERROR'));
const holdCodes = new Set(['QUERY_NOT_ENABLED', 'SENDER_NOT_ALLOWED', 'DISCLOSURE_NOT_DECLARED', 'RULE_UNAVAILABLE', 'OBSERVATION_EXPIRED']);
const seal = r => ({ ...r, receipt_sha256: digest(r) });

export async function query(request, context, { apiKey, fetch: fetchFn = globalThis.fetch, now = Date.now } = {}) {
  request = structuredClone(request);
  context = structuredClone(context);
  const started = now();
  const result = { kind: 'dispatcher.query.result', authority: false, effect: false,
    request_id: typeof request?.id === 'string' ? request.id : null,
    request_sha256: digest(request ?? null), binding: null, status: 'ERROR', provider_calls: 0 };
  let timer, wireHash, transportCode;
  const abort = new AbortController();
  try {
    validateRequest(request);
    requireThat(context && hex40.test(context.policy_commit) && hex40.test(context.policy_tree) &&
      hex64.test(context.policy_sha256) && hex64.test(context.observation_sha256) &&
      context.implementation_sha256 === implementationDigest() && context.observation_sha256 === digest(context.observation) &&
      Array.isArray(context.rules) && context.rules.length > 0 && context.rules.every(r => text(r.rule)), 'CONTEXT_INVALID');
    requireThat(Number.isSafeInteger(context.limits?.timeout_ms) && context.limits.timeout_ms > 0 && context.limits.timeout_ms <= 120000 &&
      Number.isSafeInteger(context.limits?.max_input_bytes) && context.limits.max_input_bytes > 0 && context.limits.max_input_bytes <= 1048576 &&
      text(context.expected_model), 'CONTEXT_INVALID');
    result.binding = Object.fromEntries(['job', 'contract_version', 'sender', 'source_record', 'policy_commit', 'policy_tree',
      'policy_sha256', 'state_version', 'observation_sha256', 'implementation_sha256'].map(k => [k, context[k]]));
    requireThat(context.observation.expires_at > started, 'OBSERVATION_EXPIRED');
    const state = JSON.stringify({ rules: context.rules, observation: context.observation });
    requireThat(Buffer.byteLength(state) + Buffer.byteLength(JSON.stringify(request)) <= context.limits.max_input_bytes, 'INPUT_TOO_LARGE');
    requireThat(text(apiKey), 'auth_missing');
    let calls = 0;
    const boundedFetch = async (url, options) => {
      requireThat(++calls === 1, 'QUERY_ERROR');
      result.provider_calls = calls;
      const response = await fetchFn(url, { ...options, signal: abort.signal });
      if (!response.ok) return response;
      const reader = response.body?.getReader();
      requireThat(reader, 'RESPONSE_INVALID');
      const chunks = []; let bytes = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 1048576) { transportCode = 'RESPONSE_TOO_LARGE'; requireThat(false, transportCode); }
          chunks.push(Buffer.from(value));
        }
      } finally { await reader.cancel().catch(() => {}); }
      const wire = Buffer.concat(chunks);
      wireHash = digest(wire);
      return { ok: true, json: async () => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(wire)) };
    };
    const params = { text: state, question: request.question, instructions: request.question,
      criteria: request.criteria, apiKey, fetch: boundedFetch };
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => { abort.abort(); reject(Object.assign(new Error('TIMEOUT'), { code: 'TIMEOUT' })); }, context.limits.timeout_ms);
    });
    const call = request.type === 'noul' ? askJevNoul : request.type === 'choice' ? askJevChoice : askJevScore;
    const answer = await Promise.race([call(params), deadline]);
    requireThat(answer.model === context.expected_model, 'MODEL_CHANGED');
    requireThat(context.observation.expires_at > now(), 'OBSERVATION_EXPIRED');
    // Do not relay arbitrary provider fields as instructions to an actor.
    const value = request.type === 'noul' ? answer.noul : request.type === 'choice' ?
      { choice: answer.choice.choice, probabilities: answer.choice.probabilities, confidence: answer.choice.confidence } :
      { score: answer.score.score, legend: answer.score.legend, probabilities: answer.score.probabilities, confidence: answer.score.confidence };
    Object.assign(result, { status: 'ANSWER', model: answer.model, answer: { type: request.type, value }, raw_response_sha256: wireHash });
  } catch (e) {
    const code = transportCode || errorCode(e);
    Object.assign(result, { status: holdCodes.has(code) ? 'HOLD' : 'ERROR', code });
  } finally { clearTimeout(timer); abort.abort(); }
  return seal({ ...result, elapsed_ms: Math.max(0, now() - started), monetary_cost: null });
}

export function consumeReply(reply, expected, disposition) {
  requireThat(object(reply) && object(expected), 'REPLY_INVALID');
  const { receipt_sha256, ...body } = reply;
  requireThat(receipt_sha256 === digest(body) && reply.kind === 'dispatcher.query.result' &&
    reply.authority === false && reply.effect === false, 'REPLY_INVALID');
  requireThat(reply.status === 'ANSWER' && ['adopt', 'reject', 'hold'].includes(disposition), 'REPLY_NOT_USABLE');
  const keys = ['request_id', 'request_sha256'];
  requireThat(keys.every(k => text(expected[k]) && reply[k] === expected[k]) && object(expected.binding) &&
    object(reply.binding) && Object.keys(reply.binding).length === Object.keys(expected.binding).length &&
    Object.entries(reply.binding).every(([k, v]) => expected.binding[k] === v), 'REPLY_MISMATCH');
  return { kind: 'dispatcher.query.use', receipt_sha256, disposition, binding: reply.binding, authority: false, effect: false };
}

// A same-sender reply packet for the existing transport. Constructing it does not
// send it, grant resume authority, mark the stage complete or claim actor consumption.
export function replyPacket(reply, expected) {
  requireThat(object(reply) && object(expected) && object(expected.binding), 'REPLY_INVALID');
  const { receipt_sha256, ...body } = reply;
  requireThat(receipt_sha256 === digest(body) && reply.kind === 'dispatcher.query.result' &&
    reply.authority === false && reply.effect === false && ['ANSWER', 'HOLD', 'ERROR'].includes(reply.status), 'REPLY_INVALID');
  requireThat(reply.request_id === expected.request_id && reply.request_sha256 === expected.request_sha256 &&
    object(reply.binding) && Object.keys(reply.binding).length === Object.keys(expected.binding).length &&
    Object.entries(reply.binding).every(([k, v]) => expected.binding[k] === v) &&
    text(reply.binding.sender) && text(reply.binding.source_record), 'REPLY_MISMATCH');
  return { kind: 'dispatcher.query.reply', recipient: reply.binding.sender,
    source_record: reply.binding.source_record, request_id: reply.request_id,
    receipt_sha256, message: 'D-REPLY: ' + JSON.stringify(reply), authority: false, effect: false };
}

export function argsOf(argv) {
  if (argv.length === 1 && argv[0] === '--help') return null;
  const names = ['repo', 'commit', 'r-id', 'contract-id', 'version', 'sender', 'source-record', 'observation', 'git-bin'];
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i]?.slice(2), v = argv[i + 1];
    requireThat(argv[i]?.startsWith('--') && names.includes(k) && !Object.hasOwn(args, k) && text(v), 'ARGUMENT_INVALID');
    args[k] = v;
  }
  if (!args['git-bin'] && process.env.DISPATCHER_GIT_BIN) args['git-bin'] = process.env.DISPATCHER_GIT_BIN;
  requireThat(names.every(k => text(args[k])) && hex40.test(args.commit) && args.repo.startsWith('/') &&
    args['git-bin'].startsWith('/') && args.observation.startsWith('/'), 'ARGUMENT_INVALID');
  return args;
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const args = argsOf(argv);
    if (!args) return { help: 'jev-dispatcher-query --repo ABS --commit SHA --r-id ID --contract-id ID --version VERSION --sender ID --source-record ID --observation ABS [--git-bin ABS]; one {id,type,question,criteria?} JSON on stdin; advisory only, no automatic retry' };
    let raw = '';
    const inputTimer = setTimeout(() => process.stdin.destroy(Object.assign(new Error('TIMEOUT'), { code: 'TIMEOUT' })), 10000);
    try {
      for await (const chunk of process.stdin) {
        raw += chunk;
        requireThat(Buffer.byteLength(raw) <= 65536, 'INPUT_TOO_LARGE');
      }
    } finally { clearTimeout(inputTimer); }
    let request, observation;
    const fd = openSync(args.observation, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = fstatSync(fd);
      requireThat(before.isFile() && before.size <= 1048576, 'OBSERVATION_INVALID');
      const bytes = readFileSync(fd);
      const after = fstatSync(fd);
      requireThat(bytes.length <= 1048576 && before.size === after.size && before.mtimeMs === after.mtimeMs &&
        before.ctimeMs === after.ctimeMs, 'OBSERVATION_INVALID');
      request = JSON.parse(raw);
      observation = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } finally { closeSync(fd); }
    validateRequest(request);
    const selection = select(args);
    const context = prepareContext({ selection, contractId: args['contract-id'], version: args.version,
      sender: args.sender, sourceRecord: args['source-record'], observation });
    return await query(request, context, { apiKey: process.env.JEV_API_KEY });
  } catch (e) {
    return seal({ kind: 'dispatcher.query.result', authority: false, effect: false, status: holdCodes.has(e.code) ? 'HOLD' : 'ERROR',
      code: /^[A-Z_]+$/.test(e.code ?? '') ? e.code : 'INPUT_OR_POLICY_INVALID', provider_calls: 0 });
  }
}
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(ownFile)) {
  const result = await main();
  process.stdout.write(JSON.stringify(result) + '\n');
  if (result.status === 'ERROR') process.exitCode = 2;
  if (result.status === 'HOLD') process.exitCode = 3;
}
