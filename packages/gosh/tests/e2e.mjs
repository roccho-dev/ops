import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';

function executable(name) {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {}
  }
  throw new Error(`missing executable ${name}`);
}

const gosh = executable('gosh');
const printf = executable('printf');
const cat = executable('cat');
const go = executable('go');

function invoke(root, args, expected = 0) {
  const result = spawnSync(gosh, ['--root', root, ...args], { encoding: 'utf8', env: process.env });
  assert.equal(result.status, expected, `${args.join(' ')}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  const stream = expected === 0 ? result.stdout : result.stderr;
  assert.ok(stream.trim(), `empty JSON output for ${args.join(' ')}`);
  return JSON.parse(stream);
}

const root = mkdtempSync(join(tmpdir(), 'gosh-e2e-'));
let response = invoke(root, ['init']);
assert.equal(response.ok, true);
assert.throws(() => statSync(join(root, '.gosh', 'bin')));

invoke(root, ['tool', 'require', 'printf', '--resolver', 'absolute', '--program-abs', printf]);
invoke(root, ['tool', 'require', 'cat', '--resolver', 'absolute', '--program-abs', cat]);
const hostile = 'Alpha Beta;$(not-run)*';
const stages = JSON.stringify([
  { id: 'emit', tool: 'printf', args: ['%s', hostile] },
  { id: 'copy', tool: 'cat', args: [] },
]);
invoke(root, ['target', 'upsert', 'pipe', '--kind', 'stdio.pipeline', '--stages-json', stages]);
response = invoke(root, ['target', 'env', 'set', 'pipe', 'TOKEN', 'secret://fixture/token']);
assert.equal(response.data.value, '<redacted>');
response = invoke(root, ['plan', 'pipe']);
assert.equal(response.data.requested, 'pipe');
response = invoke(root, ['run', 'pipe']);
assert.equal(response.data.status, 'succeeded');
assert.equal(response.data.stages.at(-1).stdout.captured, hostile);
assert.equal(response.data.stages.length, 2);
const results = readFileSync(join(root, '.gosh', 'result.jsonl'), 'utf8');
assert.ok(results.includes('"status":"succeeded"'));
assert.ok(!results.includes('secret://fixture/token'));

const source = join(root, 'snippet.go');
writeFileSync(source, 'package main\nimport "fmt"\nfunc main(){fmt.Print("snippet-ok")}\n');
response = invoke(root, ['--go-bin', go, 'snippet', 'run', source]);
assert.equal(response.data.run.stdout.captured, 'snippet-ok');
response = invoke(root, ['--go-bin', go, 'snippet', 'build', source]);
assert.equal(response.data.cacheHit, true);

const badRoot = mkdtempSync(join(tmpdir(), 'gosh-bad-'));
invoke(badRoot, ['init']);
writeFileSync(join(badRoot, '.gosh', 'events.jsonl'), '{"kind":"gosh.unknown.v1"}\n');
response = invoke(badRoot, ['plan', 'anything'], 1);
assert.equal(response.ok, false);
assert.equal(response.code, 'load_failed');

const auditRoot = mkdtempSync(join(tmpdir(), 'gosh-audit-'));
mkdirSync(join(auditRoot, '.gosh'), { recursive: true });
writeFileSync(join(auditRoot, '.gosh', 'events.jsonl'), '');
writeFileSync(join(auditRoot, '.gosh', 'result.jsonl'), '');

console.log('gosh v0 installed-binary e2e: PASS');
