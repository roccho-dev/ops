import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function gitDir(gitdir, ...argv) {
  return execFileSync('git', ['--git-dir', gitdir, ...argv], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  }).trim();
}

function gitWorktree(worktree, ...argv) {
  return execFileSync('git', ['-C', worktree, ...argv], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  }).trim();
}

export function materializeBareScope(scope, bareRoot) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-health-snapshot-'));
  const refs = [];
  try {
    for (const row of scope) {
      const gitdir = path.resolve(bareRoot, `${row.path}.git`);
      if (!fs.statSync(gitdir, { throwIfNoEntry: false })?.isDirectory()) {
        throw new Error(`bare repository missing: ${gitdir}`);
      }
      const ref = 'refs/remotes/github/proposals';
      let revision;
      try {
        revision = gitDir(gitdir, 'rev-parse', `${ref}^{commit}`);
      } catch {
        throw new Error(`required mirror ref missing: ${row.repository} ${ref}`);
      }
      if (!/^[0-9a-f]{40}$/u.test(revision)) {
        throw new Error(`invalid mirrored revision: ${row.repository}`);
      }
      const tree = gitDir(gitdir, 'rev-parse', `${revision}^{tree}`);
      const target = path.join(root, row.path);
      execFileSync('git', ['init', '--quiet', target], {
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 32 * 1024 * 1024,
      });
      gitWorktree(target, 'remote', 'add', 'origin', gitdir);
      gitWorktree(target, 'fetch', '--quiet', '--depth=1', 'origin', ref);
      if (gitWorktree(target, 'rev-parse', 'FETCH_HEAD') !== revision) {
        throw new Error(`materialized fetch mismatch: ${row.repository}`);
      }
      gitWorktree(target, 'checkout', '--quiet', '--detach', 'FETCH_HEAD');
      if (gitWorktree(target, 'rev-parse', 'HEAD') !== revision) {
        throw new Error(`materialized revision mismatch: ${row.repository}`);
      }
      if (gitWorktree(target, 'rev-parse', 'HEAD^{tree}') !== tree) {
        throw new Error(`materialized tree mismatch: ${row.repository}`);
      }
      if (gitWorktree(target, 'status', '--porcelain=v1') !== '') {
        throw new Error(`materialized repository is dirty: ${row.repository}`);
      }
      refs.push({ repository: row.repository, ref, revision, tree });
    }
    return {
      root,
      refs,
      cleanup() {
        fs.rmSync(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
