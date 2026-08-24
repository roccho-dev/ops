#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const fail = (message) => { throw new Error(message); };
const hex = (value, n) => typeof value === 'string' && new RegExp(`^[0-9a-f]{${n}}$`).test(value);
const read = (root, name) => fs.readFileSync(path.join(root, name), 'utf8');

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const got = Object.keys(value).sort();
  const want = [...keys].sort();
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${label} fields mismatch`);
}

function validate(root) {
  const source = JSON.parse(read(root, 'source.json'));
  exactKeys(source, ['schema', 'authority', 'target', 'actrun', 'goTask', 'gosh'], 'source');
  if (source.schema !== 'ops.taskRuntimeSources/1') fail('unsupported source schema');
  if (source.authority !== 'roccho-dev/adrs#317') fail('authority mismatch');
  if (source.target !== 'linux-amd64') fail('target mismatch');

  exactKeys(source.actrun, ['repository', 'tag', 'commit', 'asset', 'archiveSha256', 'binarySha256'], 'actrun');
  exactKeys(source.goTask, ['repository', 'tag', 'commit', 'asset', 'checksumsAsset', 'archiveSha256', 'checksumsSha256', 'binarySha256'], 'goTask');
  exactKeys(source.gosh, ['repository', 'source', 'build'], 'gosh');
  if (source.actrun.repository !== 'mizchi/actrun' || source.actrun.tag !== 'v0.29.0') fail('actrun source drift');
  if (source.goTask.repository !== 'go-task/task' || source.goTask.tag !== 'v3.53.1') fail('go-task source drift');
  const fixed = {
    actrunArchive: '07c58facb2b1849fbbcab51fcaf99d2c0f8d32af56f368db9792a8af1d8738a6',
    actrunBinary: '40108290d0c95c5d20de3c3d8eeff1bf312628b7d811dc19db77479f91b1223b',
    taskArchive: 'a54a408f6861ff921f6e87774180db31bacd8c1e7c944ca696db9fea49a82fc7',
    taskChecksums: 'acd6542d33465e22216e47e10997d1c5a68f54a2af0c900083eeaaad5ce85337',
    taskBinary: '48fc3727244d39e0fe04f99c512d0a6eaabf12be376828d96ad1545054523aeb',
  };
  if (source.actrun.archiveSha256 !== fixed.actrunArchive || source.actrun.binarySha256 !== fixed.actrunBinary) fail('actrun identity drift');
  if (source.goTask.archiveSha256 !== fixed.taskArchive || source.goTask.checksumsSha256 !== fixed.taskChecksums || source.goTask.binarySha256 !== fixed.taskBinary) fail('go-task identity drift');
  for (const [label, value, size] of [
    ['actrun.commit', source.actrun.commit, 40],
    ['goTask.commit', source.goTask.commit, 40],
    ['actrun.archiveSha256', source.actrun.archiveSha256, 64],
    ['actrun.binarySha256', source.actrun.binarySha256, 64],
    ['goTask.archiveSha256', source.goTask.archiveSha256, 64],
    ['goTask.checksumsSha256', source.goTask.checksumsSha256, 64],
    ['goTask.binarySha256', source.goTask.binarySha256, 64],
  ]) if (!hex(value, size)) fail(`${label} invalid`);
  if (source.gosh.repository !== 'roccho-dev/ops' || source.gosh.source !== 'packages/gosh') fail('gosh source drift');
  if (JSON.stringify(source.gosh.build) !== JSON.stringify(['CGO_ENABLED=0', '-buildvcs=false', '-trimpath'])) fail('gosh build drift');

  const taskfile = read(root, 'Taskfile.yml');
  const workflow = read(root, 'workflow.yml');
  const probe = read(root, 'probe.py');
  if (!taskfile.includes('deps: [parallel-a, parallel-b]')) fail('parallel fork missing');
  if (!taskfile.includes('deps: [fail-root]')) fail('failure dependency missing');
  if (!taskfile.includes('task: serial-a') || !taskfile.includes('task: serial-b')) fail('serial reference missing');
  if (/tasks\.jsonl|run-task-graph|\.pkl\b/u.test(taskfile + workflow + probe)) fail('duplicate DAG authority detected');
  if (!workflow.includes('run: ../bin/gosh --root . run ci')) fail('workflow must call the gosh entry');
  if (/\brun:\s*(?:\.\/bin\/)?task\b/u.test(workflow)) fail('workflow must not call go-task directly');
  if (!probe.includes('parallelOverlapAtLeast1s') || !probe.includes('serialParallelSemanticEqual')) fail('parallel proof contract missing');

  const forbidden = ['tasks.jsonl', 'Taskfile.pkl'];
  for (const name of forbidden) if (fs.existsSync(path.join(root, name))) fail(`forbidden file: ${name}`);
  return {
    schema: 'ops.taskRuntimeStaticReceipt/1',
    status: 'PASS',
    authority: source.authority,
    target: source.target,
    dagAuthority: 'Taskfile.yml',
    entryAuthority: '.gosh/events.jsonl generated at materialization',
  };
}

function main() {
  const [command = 'selftest', ...args] = process.argv.slice(2);
  if (command !== 'selftest') fail('usage: ops-task-runtime [selftest] [--root DIR]');
  let root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--root') fail('usage: ops-task-runtime [selftest] [--root DIR]');
    root = path.resolve(args[1]);
  }
  process.stdout.write(`${JSON.stringify(validate(root), null, 2)}\n`);
}

try { main(); } catch (error) {
  process.stderr.write(`ops-task-runtime: ${error.message}\n`);
  process.exit(1);
}
