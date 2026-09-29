// Offline process proof: real temporary Git state, fake runtime/check executables.
// These fixtures are never evidence of real Winnow or actual Nix execution.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));

for (const mode of ['paired', 'timeout', 'model-missing']) test(`offline proof adapter: ${mode}`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'lane-a-fixture-')), out = join(root, 'out'), bin = join(root, 'bin');
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  let requests = 0;
  const server = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/version') return res.end(JSON.stringify({ version: '0.7.5' }));
    if (req.url === '/api/tags' || req.url === '/api/ps') return res.end(JSON.stringify({ models: mode === 'model-missing' ? [] : [{ name: 'winnow:e4b', digest: 'a'.repeat(64) }] }));
    let body = ''; for await (const chunk of req) body += chunk;
    const request = JSON.parse(body); requests++;
    assert.deepEqual(request.state.changedPaths, [' changed-path ']);
    assert.ok(!body.includes('conclusion'));
    res.end(JSON.stringify({ model: 'winnow:e4b', answers: { q0: { type: 'noul', noul: 0.1 }, q1: { type: 'noul', noul: 0.9 } } }));
  });
  try {
    mkdirSync(out); mkdirSync(bin); mkdirSync(join(root, '.github/workflows'), { recursive: true });
    mkdirSync(join(root, 'packages/ci-relevance-shadow'), { recursive: true });
    for (const name of ['winnow.mjs', 'proof.mjs']) cpSync(join(here, name), join(root, 'packages/ci-relevance-shadow', name));
    writeFileSync(join(root, '.github/workflows/nix-check.yml'), 'nix-build packages/cdp-tty/proof.nix --no-out-link\nnix flake check --show-trace\n');
    writeFileSync(join(root, '.gitignore'), 'out/\nbin/\n');
    for (const name of ['nix', 'nix-build']) writeFileSync(join(bin, name), `#!/bin/sh\nprintf '${name}\\n' >> '${out}/calls'\nexit ${mode === 'timeout' && name === 'nix-build' ? '124' : '0'}\n`, { mode: 0o755 });
    git('init', '-q'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'fixture');
    git('add', '.'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
    writeFileSync(join(root, ' changed-path '), 'exact whitespace path\n'); git('add', '.'); git('commit', '-qm', 'change');
    writeFileSync(join(out, 'runtime-files.json'), JSON.stringify({ archiveSha256: 'b'.repeat(64), binarySha256: 'c'.repeat(64), fixture: true }));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, WINNOW_PORT: String(server.address().port),
      PROOF_BASE: base, PROOF_HEAD: git('rev-parse', 'HEAD') };
    let code = 0;
    try { await exec(process.execPath, [join(root, 'packages/ci-relevance-shadow/proof.mjs'), out], { cwd: root, env }); }
    catch (error) { code = error.code; }
    const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
    assert.equal(report.result, 'UNKNOWN'); assert.equal(report.authority, false); assert.equal(report.effect, false);
    if (mode === 'model-missing') {
      assert.equal(code, 2); assert.equal(requests, 0); assert.equal(report.attemptedReferenceChecks, 0);
      assert.equal(report.reason, 'MODEL_DIGEST_UNAVAILABLE');
    } else {
      assert.equal(requests, 1); assert.equal(report.attemptedReferenceChecks, 2);
      assert.equal(readFileSync(join(out, 'calls'), 'utf8'), 'nix-build\nnix\n');
      assert.equal(code, mode === 'paired' ? 0 : 2);
      if (mode === 'paired') {
        assert.equal(report.observation, 'PAIRED'); assert.equal(report.cost.actualSavedExecutionMs, 0);
        assert.deepEqual(JSON.parse(readFileSync(join(out, 'shadow.json'), 'utf8')).wouldSelect, ['flake-check']);
      } else assert.equal(report.reason, 'REFERENCE_NOT_EXECUTED');
    }
  } finally { await new Promise(resolve => server.close(resolve)); rmSync(root, { recursive: true, force: true }); }
});
