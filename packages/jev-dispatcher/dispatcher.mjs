import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { select } from './policy-select.mjs';

const ownFile = fileURLToPath(import.meta.url);
const ROW = 'policy.jev.d-replacement.dispatch.v1';
const OLD = 'policy.jev.d-replacement.oci.v1';
const fail = (message) => { throw new Error(message); };
const sha = (text) => createHash('sha256').update(text).digest('hex');
const firstText = (row) => {
  const content = row?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.find((block) => block?.type === 'text')?.text ?? '';
  return '';
};
export const decide = (mode, state) => mode === 'first-launch' && state === 'ABSENT' ? 'FIRE' : 'NO_FIRE';
export const keyFor = (commit, rid, source) => sha([commit, rid, source].join('\n'));
export const inspect = (rows, key, rid, active) => {
  const marker = 'DISPATCH-KEY: ' + key;
  const hits = rows.flatMap((row, index) =>
    row.type === 'user' && firstText(row).split(/\r?\n/, 1)[0] === marker ? [index] : []);
  if (hits.length > 1) return 'STOP_DUPLICATE_RECORDS';
  if (active) return 'STOP_ACTIVE';
  if (hits.length === 0) return 'ABSENT';
  const done = rows.slice(hits[0] + 1).some((row) =>
    row.type === 'assistant' && row.message?.stop_reason === 'end_turn' &&
    row.message?.model === 'claude-opus-5-5');
  return done ? 'DUPLICATE' : 'STOP_INCOMPLETE';
};
const activeR = (rid) => readdirSync('/proc').some((pid) => {
  if (!/^\d+$/.test(pid)) return false;
  try {
    const args = readFileSync('/proc/' + pid + '/cmdline').toString().split('\0');
    return args.some((value, index) => value === '--resume' && args[index + 1] === rid);
  } catch { return false; }
});
const transcript = (path) => readFileSync(path, 'utf8').trimEnd().split('\n').map((line) => JSON.parse(line));
const git = (...args) => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
  env.GIT_NO_REPLACE_OBJECTS = '1';
  env.GIT_OPTIONAL_LOCKS = '0';
  const result = spawnSync('/root/.nix-profile/bin/git', args,
    { encoding: 'utf8', maxBuffer: 1024 * 1024, env });
  if (result.error || result.status !== 0) fail('git verification failed: ' + args[0]);
  return result.stdout.trim();
};
export const verifyReadCheckout = (path, commit, names) => {
  if (git('-C', path, 'rev-parse', 'HEAD') !== commit ||
      git('-C', path, 'branch', '--show-current') !== '') fail('read checkout HEAD mismatch');
  if (git('-C', path, 'status', '--porcelain', '--untracked-files=all', '--ignored') !== '')
    fail('read checkout is dirty');
  for (const name of names) {
    const expected = git('-C', path, 'rev-parse', commit + ':' + name);
    const actual = git('-C', path, 'hash-object', '--no-filters', path + '/' + name);
    if (actual !== expected) fail('read blob mismatch: ' + name);
  }
};
export const buildArgv = (target, commit, rid, prompt) => {
  const expected = target.read_paths.map((name) =>
    'Read(//' + (target.adrs_read_checkout + '/' + name).slice(1) + ')');
  const allowed = target.allowed_tools_template.map((item) => item.replaceAll('<C>', commit));
  if (JSON.stringify(allowed.slice(0, 4)) !== JSON.stringify(expected) ||
      allowed.length !== 5 || !allowed[4].includes('--commit ' + commit + ' --r-id ' + rid))
    fail('allowed tools mismatch');
  const argv = target.argv_template.flatMap((part) => {
    if (part === '<each allowed_tools_template pattern as its own argv element; substitute C first>') return allowed;
    if (part === '<OCI-W-or-R-session-id>') return [rid];
    if (part === '<minimal-prompt>') return [prompt];
    return [part];
  });
  if (argv[0] !== '/usr/bin/env' || !argv.includes('--resume') ||
      !argv.includes('--strict-mcp-config') || argv.at(-1) !== prompt) fail('argv mismatch');
  return argv;
};
const argsOf = (values) => {
  if (values.length !== 4 || values[0] !== '--mode' || !['first-launch', 'check'].includes(values[1]) ||
      values[2] !== '--commit' || !/^[0-9a-f]{40}$/.test(values[3])) fail('usage: --mode first-launch|check --commit <40-hex>');
  return { mode: values[1], commit: values[3] };
};
const selectedRow = (result, id) => {
  const hit = result.selected.find((item) => item.id === id);
  if (!hit) fail('missing selected row: ' + id);
  return JSON.parse(hit.body);
};
export function run(mode, commit) {
  const repo = '/work/repos/adrs-canonical';
  const rid = 'b27e547c-14b7-47b9-a72e-7d5fdcdd724c';
  const result = select({ repo, commit, 'r-id': rid, 'git-bin': '/root/.nix-profile/bin/git' });
  const contract = selectedRow(result, ROW);
  const old = selectedRow(result, OLD);
  if (contract.state !== 'active' || contract.rel?.parent !== rid ||
      contract.source_commit !== 'c4ad8b9a5768bfea5103995e9ac3c5f1718ad965' ||
      contract.r_id !== rid || contract.event !== 'source-policy-to-contract-policy' ||
      old.target?.oci_r_id !== rid || contract.uses_target_of !== OLD ||
      contract.dispatcher?.authority !== 'roccho-dev/ops' ||
      !/^[0-9a-f]{40}$/.test(contract.dispatcher?.commit ?? '') ||
      contract.dispatcher?.path !== 'packages/jev-dispatcher/dispatcher.mjs') fail('contract mismatch');
  const opsCheckout = contract.dispatcher.checkout;
  if (typeof opsCheckout !== 'string' || ownFile !== opsCheckout + '/' + contract.dispatcher.path ||
      git('-C', opsCheckout, 'rev-parse', 'HEAD') !== contract.dispatcher.commit ||
      git('-C', opsCheckout, 'branch', '--show-current') !== '' ||
      git('-C', opsCheckout, 'status', '--porcelain', '--untracked-files=all', '--ignored') !== '' ||
      git('-C', opsCheckout, 'hash-object', '--no-filters', ownFile) !==
        git('-C', opsCheckout, 'rev-parse', contract.dispatcher.commit + ':' + contract.dispatcher.path))
    fail('dispatcher implementation mismatch');
  const source = contract.source_commit;
  const key = keyFor(commit, rid, source);
  const path = '/home/dev/.claude/projects/-work/' + rid + '.jsonl';
  const rows = transcript(path);
  const markers = rows.filter((row) => row.type === 'user' && /^DISPATCH-KEY: /.test(firstText(row)));
  if (markers.some((row) => firstText(row).split(/\r?\n/, 1)[0] !== 'DISPATCH-KEY: ' + key))
    fail('other dispatch key in R transcript');
  const previous = [...rows].reverse().find((row) => row.type === 'user' &&
    !firstText(row).startsWith('DISPATCH-KEY: ') && /\bC=[0-9a-f]{40}\b/.test(firstText(row)));
  if (!previous || firstText(previous).match(/\bC=([0-9a-f]{40})\b/)[1] !== source || source === commit)
    fail('source policy event not observed');
  const state = inspect(rows, key, rid, activeR(rid));
  if (decide(mode, state) !== 'FIRE') return { state, fired: false, key, commit, rid };
  if (activeR(rid) || inspect(transcript(path), key, rid, false) !== 'ABSENT')
    return { state: 'STOP_CHANGED', fired: false, key, commit, rid };
  const target = old.target;
  verifyReadCheckout(target.adrs_read_checkout, commit, target.read_paths);
  const prompt = 'DISPATCH-KEY: ' + key + '\n' +
    target.prompt_template.replaceAll('<C>', commit);
  const argv = buildArgv(target, commit, rid, prompt);
  const allowedEnv = ['HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TERM', 'SSL_CERT_FILE',
    'NIX_SSL_CERT_FILE', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME',
    'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY'];
  const env = Object.fromEntries(allowedEnv.filter((name) => process.env[name] !== undefined)
    .map((name) => [name, process.env[name]]));
  const child = spawnSync(argv[0], argv.slice(1), {
    cwd: target.cwd, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  try { verifyReadCheckout(target.adrs_read_checkout, commit, target.read_paths); }
  catch (error) { return { state: 'UNKNOWN', fired: true, key, commit, rid, error: String(error.message) }; }
  const after = inspect(transcript(path), key, rid, activeR(rid));
  if (child.error || child.status !== 0 || after !== 'DUPLICATE')
    return { state: 'UNKNOWN', fired: true, key, commit, rid, exit: child.status, error: String(child.error ?? '') };
  let reply;
  try { reply = JSON.parse(child.stdout); } catch { return { state: 'UNKNOWN', fired: true, key, commit, rid, error: 'invalid Claude output' }; }
  if (reply.session_id !== rid) return { state: 'UNKNOWN', fired: true, key, commit, rid, error: 'session mismatch' };
  return { state: 'COMPLETED', fired: true, key, commit, rid, session_id: reply.session_id };
}
if (process.argv[1] && realpathSync(ownFile) === realpathSync(process.argv[1])) {
  try {
    const { mode, commit } = argsOf(process.argv.slice(2));
    const result = run(mode, commit);
    process.stdout.write(JSON.stringify(result) + '\n');
    if (result.state.startsWith('STOP') || result.state === 'UNKNOWN') process.exitCode = 2;
  } catch (error) {
    process.stderr.write(String(error.message) + '\n');
    process.exitCode = 2;
  }
}
