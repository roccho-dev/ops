#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(packageRoot, 'bin', 'ops-task-runtime.mjs');
const run = (root, expected) => {
  const result = spawnSync(process.execPath, [cli, 'selftest', '--root', root], { encoding: 'utf8' });
  if ((result.status === 0) !== expected) throw new Error(`unexpected status ${result.status}: ${result.stderr || result.stdout}`);
};

run(packageRoot, true);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-task-runtime-'));
try {
  fs.cpSync(packageRoot, tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'tasks.jsonl'), '{}\n');
  run(tmp, false);
  fs.rmSync(path.join(tmp, 'tasks.jsonl'));
  const sourcePath = path.join(tmp, 'source.json');
  const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  source.goTask.binarySha256 = '0'.repeat(64);
  fs.writeFileSync(sourcePath, `${JSON.stringify(source, null, 2)}\n`);
  run(tmp, false);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.stdout.write('{"schema":"ops.taskRuntimeE2E/1","status":"PASS","positive":1,"negative":2}\n');
